// AI activity log: one chronological row per AI action (request triage, assistant answer), with the manager's
// decision beside it. Built only from what is already logged (triage results, assistant responses, manager
// actions); read-only. Free text never appears: guest and host text are kept as sha256 + length, and a row
// shows the AI's own summary. A row can show "accepted" only when a manager action says so.
import { z } from "zod";

export const TextHash = z.object({ sha256: z.string().min(8), length: z.number().int() }).strict();
export type TextHash = z.infer<typeof TextHash>;

export type ActivitySource = "guest-form" | "ai-agent" | "host";

export const TriageEvent = z
  .object({
    type: z.literal("triage"),
    refId: z.string(),
    traceId: z.string(),
    /** ISO time the request arrived (the triage runs on arrival). */
    at: z.string(),
    source: z.enum(["guest-form", "ai-agent"]),
    partySize: z.number().int().positive(),
    when: z.string(), // "Thu 19:30"
    verdict: z.enum(["real", "junk", "unsure"]),
    escalated: z.boolean(),
    /** Triage could not run (no key, timeout…): a person must read it. */
    failed: z.string().optional(),
    reason: z.string(),
    summary: z.array(z.string()),
    validatorRejects: z.number().int(),
    model: z.string(),
    costUsd: z.number(),
    latencyMs: z.number(),
    message: TextHash,
    /** The solver's answer for this request, if a fit check ran ("Fits: T57 + … · Garden Room"). */
    solver: z.array(z.string()).default([]),
  })
  .strict();
export type TriageEvent = z.infer<typeof TriageEvent>;

export const AssistantEvent = z
  .object({
    type: z.literal("assistant"),
    refId: z.string(), // the traceId
    traceId: z.string(),
    at: z.string(),
    roomId: z.string(),
    partySize: z.number().int().positive().nullable(),
    input: TextHash,
    answer: z.string(),
    clarifyingQuestion: z.string().nullable(),
    recommendations: z.array(
      z.object({
        rank: z.number(),
        tables: z.array(z.string()),
        seats: z.number(),
        waitMin: z.number(),
      }),
    ),
    validatorRejects: z.number().int(),
    refused: z.boolean(),
    /** The assistant failed (timeout, budget…): the host decides alone. */
    failed: z.string().optional(),
    model: z.string(),
    costUsd: z.number(),
    latencyMs: z.number(),
  })
  .strict();
export type AssistantEvent = z.infer<typeof AssistantEvent>;

export const ManagerAction = z
  .object({
    refId: z.string(),
    at: z.string(),
    kind: z.enum(["accepted", "declined", "replied", "applied"]),
    reason: z.enum(["fit", "policy", "other"]).optional(),
    edited: z.boolean().optional(),
    /** What was applied / booked, e.g. "T57 + T58 … (Garden Room + Library)". */
    applied: z.string().optional(),
  })
  .strict();
export type ManagerAction = z.infer<typeof ManagerAction>;

export const ActivitySeed = z
  .object({
    note: z.string(),
    events: z.array(z.discriminatedUnion("type", [TriageEvent, AssistantEvent])),
    actions: z.array(ManagerAction),
  })
  .strict();
export type ActivitySeed = z.infer<typeof ActivitySeed>;

export type ActivityKind =
  | "request"
  | "escalation"
  | "assistant-question"
  | "recommendation"
  | "assistant-answer"
  | "refusal";

export type RowDecision =
  | { kind: "accepted"; at: string; applied?: string }
  | { kind: "declined"; at: string; reason: "fit" | "policy" | "other" }
  | { kind: "edited"; at: string }
  | { kind: "replied"; at: string }
  | { kind: "pending" }
  | { kind: "none" }; // nothing to decide (a refusal, a question back)

export interface ActivityRow {
  id: string;
  refId: string;
  traceId: string;
  at: string;
  kind: ActivityKind;
  /** Extra filter tags: "validator-reject", "junk". */
  flags: string[];
  source: ActivitySource;
  partySize: number | null;
  when: string | null;
  /** One line: what the AI did (its own words or a template — never the guest's text). */
  what: string;
  decision: RowDecision;
  costUsd: number;
  latencyMs: number;
  model: string;
  record: {
    inputs: [string, string][];
    aiOutput: string[];
    solverOptions: string[];
    applied: string | null;
  };
}

const hashLabel = (h: TextHash) => `sha256 ${h.sha256.slice(0, 12)}… · ${h.length} chars`;

function decisionFor(
  e: TriageEvent | AssistantEvent,
  kind: ActivityKind,
  actions: readonly ManagerAction[],
): RowDecision {
  const mine = actions.filter((a) => a.refId === e.refId && a.at >= e.at);
  const last = mine.sort((a, b) => a.at.localeCompare(b.at))[mine.length - 1];
  if (!last)
    return kind === "refusal" || kind === "assistant-question"
      ? { kind: "none" }
      : { kind: "pending" };
  switch (last.kind) {
    case "accepted":
    case "applied":
      return { kind: "accepted", at: last.at, applied: last.applied };
    case "declined":
      return { kind: "declined", at: last.at, reason: last.reason ?? "other" };
    case "replied":
      return last.edited ? { kind: "edited", at: last.at } : { kind: "replied", at: last.at };
  }
}

function triageRow(e: TriageEvent, actions: readonly ManagerAction[]): ActivityRow {
  const kind: ActivityKind = e.escalated || e.failed ? "escalation" : "request";
  const verdict = e.failed
    ? `Triage failed (${e.failed}) — needs a person`
    : e.escalated
      ? "Triage unsure — escalated to a person"
      : e.verdict === "junk"
        ? "Triaged as junk"
        : "Triaged as real";
  const decision = decisionFor(e, kind, actions);
  return {
    id: `row-${e.traceId}`,
    refId: e.refId,
    traceId: e.traceId,
    at: e.at,
    kind,
    flags: [
      ...(e.validatorRejects ? ["validator-reject"] : []),
      ...(e.verdict === "junk" && !e.escalated ? ["junk"] : []),
    ],
    source: e.source,
    partySize: e.partySize,
    when: e.when,
    what: `${verdict}${e.summary[0] ? `: ${e.summary[0]}` : ""}`,
    decision,
    costUsd: e.costUsd,
    latencyMs: e.latencyMs,
    model: e.model,
    record: {
      inputs: [
        ["Request", e.refId],
        ["Source", e.source === "ai-agent" ? "AI agent" : "Guest web form"],
        ["Party", `${e.partySize} · ${e.when}`],
        ["Guest text", hashLabel(e.message)],
      ],
      aiOutput: [
        `Verdict: ${e.failed ? "none (failed)" : e.verdict}${e.escalated ? " · escalated" : ""}`,
        `Why: ${e.reason}`,
        ...e.summary.map((s, i) => `Summary ${i + 1}: ${s}`),
        ...(e.validatorRejects ? [`Validator rejected ${e.validatorRejects} answer(s) first`] : []),
      ],
      solverOptions: e.solver,
      applied: decision.kind === "accepted" ? (decision.applied ?? "Accepted") : null,
    },
  };
}

function assistantRow(e: AssistantEvent, actions: readonly ManagerAction[]): ActivityRow {
  const kind: ActivityKind = e.failed
    ? "escalation"
    : e.refused
      ? "refusal"
      : e.clarifyingQuestion
        ? "assistant-question"
        : e.recommendations.length
          ? "recommendation"
          : "assistant-answer";
  const top = e.recommendations[0];
  const what =
    kind === "escalation"
      ? `Assistant failed (${e.failed}) — host decides`
      : kind === "refusal"
        ? "Refused a request outside its job (recommend-only)"
        : kind === "assistant-question"
          ? `Asked back: ${e.clarifyingQuestion}`
          : kind === "recommendation" && top
            ? `Recommended ${top.tables.join(" + ")} (~${top.waitMin} min)${
                e.recommendations.length > 1 ? ` + ${e.recommendations.length - 1} more` : ""
              }`
            : "Answered: nothing fits";
  const decision = decisionFor(e, kind, actions);
  return {
    id: `row-${e.traceId}`,
    refId: e.refId,
    traceId: e.traceId,
    at: e.at,
    kind,
    flags: e.validatorRejects ? ["validator-reject"] : [],
    source: "host",
    partySize: e.partySize,
    when: null,
    what,
    decision,
    costUsd: e.costUsd,
    latencyMs: e.latencyMs,
    model: e.model,
    record: {
      inputs: [
        ["Room", e.roomId],
        ["Host's message", hashLabel(e.input)],
      ],
      aiOutput: [e.answer, ...(e.clarifyingQuestion ? [`Question: ${e.clarifyingQuestion}`] : [])],
      solverOptions: e.recommendations.map(
        (r) => `#${r.rank} ${r.tables.join(" + ")} · seats ${r.seats} · ~${r.waitMin} min`,
      ),
      applied: decision.kind === "accepted" ? (decision.applied ?? "Applied") : null,
    },
  };
}

/** Newest first. Exactly one row per AI action (keyed by trace id). */
export function buildActivity(
  events: readonly (TriageEvent | AssistantEvent)[],
  actions: readonly ManagerAction[],
): ActivityRow[] {
  const seen = new Set<string>();
  const rows: ActivityRow[] = [];
  for (const e of events) {
    if (seen.has(e.traceId)) continue;
    seen.add(e.traceId);
    rows.push(e.type === "triage" ? triageRow(e, actions) : assistantRow(e, actions));
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export interface ActivityCounts {
  requests: number;
  accepted: number;
  declined: { fit: number; policy: number; other: number };
  pending: number;
}

/** Header counts over request rows (triage rows, escalated or not). */
export function activityCounts(rows: readonly ActivityRow[]): ActivityCounts {
  const req = rows.filter((r) => r.source !== "host");
  const declined = { fit: 0, policy: 0, other: 0 };
  for (const r of req) if (r.decision.kind === "declined") declined[r.decision.reason]++;
  return {
    requests: req.length,
    accepted: req.filter((r) => r.decision.kind === "accepted").length,
    declined,
    pending: req.filter((r) => r.decision.kind === "pending").length,
  };
}

export interface ActivityFilter {
  type?: ActivityKind | "validator-reject" | "junk";
  decision?: RowDecision["kind"];
  reason?: "fit" | "policy" | "other";
}

export function filterActivity(rows: readonly ActivityRow[], f: ActivityFilter): ActivityRow[] {
  return rows.filter(
    (r) =>
      (!f.type || r.kind === f.type || r.flags.includes(f.type)) &&
      (!f.decision || r.decision.kind === f.decision) &&
      (!f.reason || (r.decision.kind === "declined" && r.decision.reason === f.reason)),
  );
}
