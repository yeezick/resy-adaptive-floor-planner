// AI triage for large-party requests: real vs junk with a reason, plus a two-line summary. One model call per
// request (one retry when the validator rejects the answer). The model never sees the room and may not name a
// table: the solver and the manager do the seating. Costed and logged like the agent.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GuestRequest } from "../domain/requests";
import type { CallMetrics, TriageResult } from "../shared/api";
import { checkModel } from "./config";
import type { SpendGate } from "./guards/budget";
import { logCall } from "./log";
import { callMetrics } from "./metrics";
import { reservationUsd } from "./pricing";
import { parsePrompt, type LoadedPrompt } from "./agent/prompt";
import type { CreateMessage } from "./agent/loop";
import { toStrictJsonSchema } from "./agent/schemas";

export const TriageOutput = z
  .object({
    verdict: z.enum(["real", "junk", "unsure"]),
    reason: z.string().min(1).max(200),
    summary: z.array(z.string().min(1).max(120)).length(2),
  })
  .strict();
export type TriageOutput = z.infer<typeof TriageOutput>;

let cachedPrompt: LoadedPrompt | undefined;
export function loadTriagePrompt(): LoadedPrompt {
  cachedPrompt ??= parsePrompt(
    readFileSync(
      path.resolve(process.cwd(), process.env.TRIAGE_PROMPT_PATH ?? "prompts/triage.v1.md"),
      "utf8",
    ),
  );
  return cachedPrompt;
}

export interface TriageConfig {
  create: CreateMessage;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  budget?: SpendGate;
}

export function triageConfigFromEnv(create: CreateMessage): TriageConfig {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-5-5";
  checkModel("TRIAGE_MODEL", model);
  return {
    create,
    model,
    maxTokens: Number(process.env.TRIAGE_MAX_TOKENS ?? 600),
    timeoutMs: Number(process.env.TRIAGE_TIMEOUT_MS ?? 15_000),
  };
}

/** Problems that make an answer unusable. Empty = valid. */
export function triageProblems(out: TriageOutput, r: GuestRequest): string[] {
  const problems: string[] = [];
  const text = [out.reason, ...out.summary].join(" \n ");
  if (/\bT\d{1,4}\b/.test(text)) problems.push("names a table — seating is the planner's job");
  if (/\b(confirmed|booked|reserved|accepted|is held|we('| ha)ve held)\b/i.test(text))
    problems.push("says the party is booked or confirmed — nothing is decided yet");
  if (/https?:\/\/|www\.|@\w+\.\w+|\+?\d[\d\s().-]{8,}\d/.test(text))
    problems.push("repeats a link, email or phone number");
  const name = r.contact.trim();
  const lower = text.toLowerCase();
  // Only capitalised words count as name tokens, matched case-sensitively, so a contact like "free dinner"
  // does not reject ordinary prose. A contact with no name-like word is not checked at all.
  const tokens = name.split(/\s+/).filter((t) => /^\p{Lu}\p{L}{2,}$/u.test(t));
  const hasToken = (t: string) => new RegExp(`(^|[^\\p{L}])${t}($|[^\\p{L}])`, "u").test(text);
  if (
    tokens.length > 0 &&
    ((name.length > 2 && lower.includes(name.toLowerCase())) || tokens.some((t) => hasToken(t)))
  )
    problems.push("repeats the guest's name");
  return problems;
}

export class TriageError extends Error {
  calls: CallMetrics[] = [];
  constructor(
    readonly code: "timeout" | "upstream" | "budget",
    message: string,
  ) {
    super(message);
  }
}

function userMessage(r: GuestRequest, cap: number): string {
  const facts = [
    `Source: ${r.source === "ai-agent" ? "an AI agent booking for a guest" : "the venue's web form"}`,
    `Requested: ${r.day} ${r.time}, party of ${r.partySize} (online cap: ${cap})`,
    r.occasion ? `Occasion field: ${r.occasion}` : null,
    r.needs.length ? `Needs ticked: ${r.needs.join(", ")}` : null,
    r.privateRoom ? "Asked for a private room" : null,
  ].filter(Boolean);
  return `${facts.join("\n")}\n\n<request>\n${r.message}\n</request>`;
}

function parseOutput(text: string): TriageOutput | null {
  try {
    const p = TriageOutput.safeParse(JSON.parse(text));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** Triage one request. Throws TriageError on timeout, budget or API failure (calls made so far attached). */
export async function triageRequest(
  r: GuestRequest,
  cap: number,
  traceId: string,
  cfg: TriageConfig,
): Promise<TriageResult> {
  const prompt = loadTriagePrompt();
  const schema = toStrictJsonSchema(TriageOutput);
  const calls: CallMetrics[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userMessage(r, cap) },
  ];
  const started = Date.now();
  let rejects = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (cfg.budget?.exhausted()) {
      const e = new TriageError("budget", "The demo budget reached its limit — try again later.");
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
        ? new TriageError("timeout", `triage did not finish within ${cfg.timeoutMs / 1000} s`)
        : new TriageError(
            "upstream",
            err instanceof Anthropic.APIError
              ? `model API error ${err.status ?? ""}`.trim()
              : "triage failed",
          );
      e.calls = calls;
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const m = callMetrics(msg, {
      traceId,
      role: "triage",
      promptVersion: prompt.version,
      latencyMs: Date.now() - t0,
      requestedModel: cfg.model,
    });
    hold?.settle(m.costUsd);
    calls.push(m);
    logCall(m);

    const done = (out: TriageOutput | null, note: string | null): TriageResult => ({
      requestId: r.id,
      traceId,
      promptVersion: prompt.version,
      model: msg.model,
      verdict: out?.verdict ?? "unsure",
      reason:
        out?.reason ?? note ?? "The AI could not triage this request — a person should read it.",
      summary: out?.summary ?? ["Needs a person to read it.", "AI triage gave no usable answer."],
      escalated: out === null || out.verdict === "unsure",
      validatorRejects: rejects,
      metrics: {
        costUsd: calls.reduce((n, c) => n + c.costUsd, 0),
        latencyMs: Date.now() - started,
        calls,
      },
    });
    if (msg.stop_reason === "refusal")
      return done(null, "The AI declined to triage this request — a person should read it.");
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseOutput(text);
    const problems = parsed ? triageProblems(parsed, r) : ["the answer was not valid JSON"];
    if (parsed && problems.length === 0) return done(parsed, null);
    rejects++;
    if (attempt === 1) return done(null, null);
    messages.push({ role: "assistant", content: msg.content });
    messages.push({
      role: "user",
      content: `Your answer was rejected: ${problems.join("; ")}. Answer again following the rules.`,
    });
  }
  throw new TriageError("upstream", "unreachable");
}
