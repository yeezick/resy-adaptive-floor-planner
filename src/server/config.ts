// Startup checks for environment configuration: fail fast with a clear message instead of failing per request.
import { isKnownModel, knownModels } from "./pricing";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function checkModel(name: string, value: string): void {
  if (!isKnownModel(value))
    throw new Error(
      `${name}="${value}" has no price in src/server/pricing.ts. Known: ${knownModels().join(", ")}`,
    );
}

export function checkEffort(name: string, value: string): Effort {
  if (!(EFFORTS as readonly string[]).includes(value))
    throw new Error(`${name} must be one of ${EFFORTS.join("|")}, got "${value}"`);
  return value as Effort;
}

function checkPositive(name: string): void {
  const raw = process.env[name];
  if (raw === undefined) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number, got "${raw}"`);
}

/** Validates every model/effort/limit env var this process will use. Throws on the first problem. */
export function validateEnv(opts: { judge?: boolean } = {}): void {
  checkModel("ANTHROPIC_MODEL", process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5");
  checkEffort("AGENT_EFFORT", process.env.AGENT_EFFORT ?? "low");
  if (opts.judge || process.env.JUDGE_MODEL)
    checkModel("JUDGE_MODEL", process.env.JUDGE_MODEL ?? "claude-sonnet-5-5");
  if (process.env.JUDGE_EFFORT) checkEffort("JUDGE_EFFORT", process.env.JUDGE_EFFORT);
  checkModel("TRIAGE_MODEL", process.env.TRIAGE_MODEL ?? "claude-haiku-5-5");
  checkModel("REQUEST_CHAT_MODEL", process.env.REQUEST_CHAT_MODEL ?? "claude-haiku-5-5");
  for (const n of [
    "AGENT_MAX_TOKENS",
    "AGENT_TIMEOUT_MS",
    "TRIAGE_MAX_TOKENS",
    "TRIAGE_TIMEOUT_MS",
    "REQUEST_CHAT_MAX_TOKENS",
    "REQUEST_CHAT_TIMEOUT_MS",
    "RATE_LIMIT_PER_MIN",
    "DAILY_BUDGET_USD",
    "MAX_CONCURRENT_RUNS",
    "EVAL_RUN_BUDGET_USD",
  ])
    checkPositive(n);
}

/** TRUST_PROXY: a hop count, or "true"/"false". Default 1 (one proxy in front, as on Railway). */
export function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined || raw.trim() === "") return 1;
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0) return n;
  throw new Error(`TRUST_PROXY must be a hop count or true/false, got "${raw}"`);
}

/**
 * How many entries the X-Forwarded-For header holds: the count only, never the addresses. With no entries
 * sent by the client, this is the number of proxies that appended one, i.e. the TRUST_PROXY hop count.
 */
export function forwardedForCount(header: string | string[] | undefined): number {
  if (header === undefined) return 0;
  const joined = Array.isArray(header) ? header.join(",") : header;
  return joined.split(",").filter((e) => e.trim() !== "").length;
}
