// In-request chat: one model call turns the manager's message into constraints for ONE request (one retry when
// the validator rejects the answer). The model never sees the room or names a table; the client re-runs the
// planner with the constraints. Costed and logged like triage; the message is logged as sha256 + length only.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ChatTurnOutput, chatTurnProblems } from "../domain/requestChat";
import type { CallMetrics, RequestChatBody, RequestChatResult } from "../shared/api";
import { checkModel } from "./config";
import type { SpendGate } from "./guards/budget";
import { hashText, logCall } from "./log";
import { callMetrics } from "./metrics";
import { reservationUsd } from "./pricing";
import { parsePrompt, type LoadedPrompt } from "./agent/prompt";
import type { CreateMessage } from "./agent/loop";
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
    maxTokens: Number(process.env.REQUEST_CHAT_MAX_TOKENS ?? 500),
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

function userMessage(b: RequestChatBody): string {
  const c = b.constraints;
  const facts = [
    `Request: party of ${b.request.partySize} on ${b.request.day} at ${b.request.time}`,
    b.request.needs.length ? `Needs on file: ${b.request.needs.join(", ")}` : "Needs on file: none",
    c.tableRange ? `Current table range: ${c.tableRange.from}–${c.tableRange.to}` : null,
    c.partySize !== null ? `Current headcount: ${c.partySize}` : null,
    c.time !== null ? `Current time: ${c.time}` : null,
    c.notes.length ? `Crew notes so far: ${c.notes.join(", ")}` : null,
  ].filter(Boolean);
  // Every fact above comes from the client, so it sits inside data tags like the message itself.
  return `<request>\n${facts.join("\n")}\n</request>\n\n<message>\n${b.message}\n</message>`;
}

function parseOutput(text: string): ChatTurnOutput | null {
  try {
    const p = ChatTurnOutput.safeParse(JSON.parse(text));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** One chat turn. Throws RequestChatError on timeout, budget or API failure (calls made so far attached). */
export async function requestChatTurn(
  requestId: string,
  body: RequestChatBody,
  traceId: string,
  cfg: RequestChatConfig,
): Promise<RequestChatResult> {
  const prompt = loadRequestChatPrompt();
  const schema = toStrictJsonSchema(ChatTurnOutput);
  const calls: CallMetrics[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userMessage(body) },
  ];
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

    const done = (out: ChatTurnOutput | null, note: string | null): RequestChatResult => ({
      requestId,
      traceId,
      promptVersion: prompt.version,
      model: msg.model,
      output: out,
      escalated: out === null,
      note,
      validatorRejects: rejects,
      input: hashText(body.message),
      metrics: {
        costUsd: calls.reduce((n, c) => n + c.costUsd, 0),
        latencyMs: Date.now() - started,
        calls,
      },
    });
    if (msg.stop_reason === "refusal")
      return done(null, "The AI declined that message — use the controls on the card instead.");
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseOutput(text);
    const problems = parsed
      ? chatTurnProblems(parsed, body.message)
      : ["the answer was not valid JSON"];
    if (parsed && problems.length === 0) return done(parsed, null);
    rejects++;
    if (attempt === 1)
      return done(null, "The AI couldn't turn that into a change — use the controls on the card.");
    messages.push({ role: "assistant", content: msg.content });
    messages.push({
      role: "user",
      content: `Your answer was rejected: ${problems.join("; ")}. Answer again following the rules.`,
    });
  }
  throw new RequestChatError("upstream", "unreachable");
}
