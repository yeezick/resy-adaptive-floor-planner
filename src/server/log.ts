// JSON log lines. Never log IP addresses. User free text is logged only as a sha256 hash + length.
import { createHash } from "node:crypto";
import type { CallMetrics } from "../shared/api";

export function hashText(text: string): { sha256: string; length: number } {
  return { sha256: createHash("sha256").update(text).digest("hex"), length: text.length };
}

const silent = () => process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS;

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  if (silent()) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

export function logCall(m: CallMetrics): void {
  logEvent("anthropic_call", { ...m });
}
