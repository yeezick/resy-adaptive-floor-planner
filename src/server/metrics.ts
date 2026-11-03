// One CallMetrics record per Anthropic call (agent and judge), costed from the model that actually served it.
// Never throws: a model missing from the price table is charged at the highest rate in it, with a warning.
import type Anthropic from "@anthropic-ai/sdk";
import type { CallMetrics } from "../shared/api";
import { logEvent } from "./log";
import { costUsdSafe } from "./pricing";

interface IterationLike {
  type: string;
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * With a server-side fallback, `usage.iterations` is the per-attempt source of truth and each attempt bills at
 * the rates of the model that ran it; top-level `usage` covers only the attempt that produced the message.
 * An iteration without a model ran on the model the request asked for.
 */
export function callMetrics(
  msg: Pick<Anthropic.Beta.BetaMessage, "model" | "usage" | "stop_reason">,
  meta: {
    traceId: string;
    role: CallMetrics["role"];
    promptVersion: string;
    latencyMs: number;
    requestedModel: string;
  },
): CallMetrics {
  const iterations = (msg.usage.iterations ?? []) as IterationLike[];
  const attempts: IterationLike[] = iterations.length
    ? iterations.filter((i) => typeof i.input_tokens === "number")
    : [{ type: "message", model: msg.model, ...msg.usage }];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let cost = 0;
  for (const a of attempts) {
    const usage = {
      input_tokens: a.input_tokens ?? 0,
      output_tokens: a.output_tokens ?? 0,
      cache_creation_input_tokens: a.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: a.cache_read_input_tokens ?? 0,
    };
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    cacheReadTokens += usage.cache_read_input_tokens;
    cacheWriteTokens += usage.cache_creation_input_tokens;
    const model = a.model ?? meta.requestedModel;
    const c = costUsdSafe(model, usage);
    if (c.priced === "max-rate")
      logEvent("pricing_unknown_model", {
        traceId: meta.traceId,
        model,
        note: "charged at the highest rate in pricing.ts; add this model's price",
      });
    cost += c.usd;
  }
  return {
    traceId: meta.traceId,
    role: meta.role,
    model: msg.model,
    promptVersion: meta.promptVersion,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: cost,
    latencyMs: meta.latencyMs,
    stopReason: msg.stop_reason ?? null,
  };
}
