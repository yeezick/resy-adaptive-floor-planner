// In-request chat: one model call turns the manager's message into constraints for ONE request (one retry when
// the validator rejects the answer). The model never sees the room or names a table; the client re-runs the
// planner with the constraints. Costed and logged like triage; the message is logged as sha256 + length only.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ChatTurnOutput,
  ChatTurnRecorded,
  chatTurnProblems,
  ESCALATED_NOTE,
  type TurnContext,
} from "../domain/requestChat";
import type { CallMetrics, FloorChatBody, RequestChatBody, RequestChatResult } from "../shared/api";
import { checkModel } from "./config";
import type { SpendGate } from "./guards/budget";
import { hashText, logCall, logEvent } from "./log";
import { callMetrics } from "./metrics";
import { reservationUsd } from "./pricing";
import { parsePrompt, type LoadedPrompt } from "./agent/prompt";
import { asData, type CreateMessage } from "./agent/loop";
import { toStrictJsonSchema } from "./agent/schemas";

let cachedPrompt: LoadedPrompt | undefined;
export function loadRequestChatPrompt(): LoadedPrompt {
  cachedPrompt ??= parsePrompt(
    readFileSync(
      path.resolve(
        process.cwd(),
        process.env.REQUEST_CHAT_PROMPT_PATH ?? "prompts/request-chat.v1.md",
      ),
      "utf8",
    ),
  );
  return cachedPrompt;
}

export interface RequestChatConfig {
  create: CreateMessage;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  budget?: SpendGate;
}

export function requestChatConfigFromEnv(create: CreateMessage): RequestChatConfig {
  const model = process.env.REQUEST_CHAT_MODEL ?? "claude-haiku-5-5";
  checkModel("REQUEST_CHAT_MODEL", model);
  return {
    create,
    model,
    maxTokens: Number(process.env.REQUEST_CHAT_MAX_TOKENS ?? 1000),
    timeoutMs: Number(process.env.REQUEST_CHAT_TIMEOUT_MS ?? 15_000),
  };
}

export class RequestChatError extends Error {
  calls: CallMetrics[] = [];
  constructor(
    readonly code: "timeout" | "upstream" | "budget",
    message: string,
  ) {
    super(message);
  }
}

function roomsLine(ctx: TurnContext): string | null {
  return ctx.rooms?.length ? `Seating rooms tonight: ${ctx.rooms.join(", ")}` : null;
}

function userMessage(b: RequestChatBody, ctx: TurnContext): string {
  const c = b.constraints;
  const facts = [
    `Request: party of ${b.request.partySize} on ${b.request.day} at ${b.request.time}`,
    b.request.needs.length ? `Needs on file: ${b.request.needs.join(", ")}` : "Needs on file: none",
    b.planRooms?.length ? `Current plan uses: ${b.planRooms.join(" + ")}` : null,
    roomsLine(ctx),
    c.tableRange ? `Current table range: ${c.tableRange.from}–${c.tableRange.to}` : null,
    c.partySize !== null ? `Current headcount: ${c.partySize}` : null,
    c.time !== null ? `Current time: ${c.time}` : null,
    c.rooms?.length ? `Current rooms: ${c.rooms.join(", ")}` : null,
    c.oneRoom ? "Currently kept in one room" : null,
    c.notes.length ? `Crew notes so far: ${c.notes.join(", ")}` : null,
  ].filter(Boolean);
  // Every fact above comes from the client, so it sits inside data tags like the message itself.
  return `<request>\n${asData(facts.join("\n"))}\n</request>\n\n<message>\n${asData(b.message)}\n</message>`;
}

/** Shift setup's "Tell the AI": no request is open, so only floor changes apply. */
function floorMessage(b: FloorChatBody, ctx: TurnContext): string {
  const facts = [
    "Shift setup: no request is open. Return floor changes (ops) only; leave every request field unchanged.",
    roomsLine(ctx),
  ].filter(Boolean);
  return `<request>\n${asData(facts.join("\n"))}\n</request>\n\n<message>\n${asData(b.message)}\n</message>`;
}

function parseOutput(text: string): ChatTurnOutput | null {
  try {
    const p = ChatTurnRecorded.safeParse(JSON.parse(text));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** One chat turn. Throws RequestChatError on timeout, budget or API failure (calls made so far attached). */
export function requestChatTurn(
  requestId: string,
  body: RequestChatBody,
  traceId: string,
  cfg: RequestChatConfig,
  ctx: TurnContext = {},
): Promise<RequestChatResult> {
  return chatTurn(requestId, userMessage(body, ctx), body.message, traceId, cfg, ctx);
}

/** One Shift setup turn: floor changes only (no request facts, no constraint fields). */
export function floorChatTurn(
  roomId: string,
  body: FloorChatBody,
  traceId: string,
  cfg: RequestChatConfig,
  ctx: TurnContext = {},
): Promise<RequestChatResult> {
  return chatTurn(roomId, floorMessage(body, ctx), body.message, traceId, cfg, {
    ...ctx,
    floorOnly: true,
  });
}

async function chatTurn(
  requestId: string,
  user: string,
  message: string,
  traceId: string,
  cfg: RequestChatConfig,
  ctx: TurnContext,
): Promise<RequestChatResult> {
  const prompt = loadRequestChatPrompt();
  const schema = toStrictJsonSchema(ChatTurnOutput);
  const calls: CallMetrics[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  const started = Date.now();
  let rejects = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (cfg.budget?.exhausted()) {
      const e = new RequestChatError(
        "budget",
        "The demo budget reached its limit — try again later.",
      );
      e.calls = calls;
      throw e;
    }
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: prompt.text,
      output_config: { format: { type: "json_schema", schema } },
      messages,
    };
    const reserved = cfg.budget
      ? reservationUsd(cfg.model, cfg.maxTokens, JSON.stringify(params).length)
      : 0;
    const hold = cfg.budget?.reserve(reserved);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const t0 = Date.now();
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await cfg.create(params, { signal: controller.signal, maxRetries: 1 });
    } catch (err) {
      const aborted = controller.signal.aborted || err instanceof Anthropic.APIUserAbortError;
      hold?.settle(aborted ? reserved : 0);
      const e = aborted
        ? new RequestChatError(
            "timeout",
            `the chat did not answer within ${cfg.timeoutMs / 1000} s`,
          )
        : new RequestChatError(
            "upstream",
            err instanceof Anthropic.APIError
              ? `model API error ${err.status ?? ""}`.trim()
              : "the chat failed",
          );
      e.calls = calls;
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const m = callMetrics(msg, {
      traceId,
      role: "request-chat",
      promptVersion: prompt.version,
      latencyMs: Date.now() - t0,
      requestedModel: cfg.model,
    });
    hold?.settle(m.costUsd);
    calls.push(m);
    logCall(m);
    // a cut-off answer is rejected as invalid JSON: say so in the log, so max_tokens hits can be counted
    if (msg.stop_reason === "max_tokens")
      logEvent("request_chat_max_tokens", { traceId, attempt, maxTokens: cfg.maxTokens });

    const done = (out: ChatTurnOutput | null, note: string | null): RequestChatResult => ({
      requestId,
      traceId,
      promptVersion: prompt.version,
      model: msg.model,
      output: out,
      escalated: out === null,
      note,
      validatorRejects: rejects,
      input: hashText(message),
      metrics: {
        costUsd: calls.reduce((n, c) => n + c.costUsd, 0),
        latencyMs: Date.now() - started,
        calls,
      },
    });
    if (msg.stop_reason === "refusal") return done(null, ESCALATED_NOTE);
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseOutput(text);
    const problems = parsed
      ? chatTurnProblems(parsed, message, ctx)
      : ["the answer was not valid JSON"];
    if (parsed && problems.length === 0) return done(parsed, null);
    rejects++;
    if (attempt === 1) return done(null, ESCALATED_NOTE);
    messages.push({ role: "assistant", content: msg.content });
    messages.push({
      role: "user",
      content: `Your answer was rejected: ${problems.join("; ")}. Answer again following the rules.`,
    });
  }
  throw new RequestChatError("upstream", "unreachable");
}
