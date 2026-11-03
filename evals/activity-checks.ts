// Deterministic activity-log checks (no model): every AI action (triage, assistant answer, in-request chat turn)
// produces exactly one log row; no row shows a booking (accepted) without a manager action at or after it; no
// row carries the guest's or the manager's own words.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ActivitySeed,
  buildActivity,
  type ActivityEvent,
  type AssistantEvent,
  type ManagerAction,
  type RequestBook,
} from "../src/domain";

export interface ActivityCheck {
  check: "one-row-per-action" | "no-booking-without-manager" | "no-guest-text";
  case: string;
  ok: boolean;
  detail?: string;
}

const hash = (t: string) => ({
  sha256: createHash("sha256").update(t).digest("hex"),
  length: t.length,
});

/** A scripted session over the fixture requests: triage each, one duplicate event, one stray early action. */
export function scriptedSession(book: RequestBook): {
  events: ActivityEvent[];
  actions: ManagerAction[];
  texts: string[];
} {
  const events: ActivityEvent[] = book.requests.map((r, i) => ({
    type: "triage",
    refId: r.id,
    traceId: `t-${r.id}`,
    at: `2026-11-03T15:0${i}:00.000Z`,
    source: r.source,
    partySize: r.partySize,
    when: `${r.day} ${r.time}`,
    verdict: r.partySize > 100 ? "junk" : "real",
    escalated: false,
    reason: "scripted",
    summary: [`Party of ${r.partySize}.`, "Scripted line."],
    validatorRejects: 0,
    model: "scripted",
    costUsd: 0.0001,
    latencyMs: 1000,
    message: hash(r.message),
    solver: [],
  }));
  const host = "Party of 8 just walked in — where?";
  events.push({
    type: "assistant",
    refId: "a-1",
    traceId: "a-1",
    at: "2026-11-03T15:10:00.000Z",
    roomId: "dinner-peak",
    partySize: 8,
    input: hash(host),
    answer: "T41 frees in about 11 minutes.",
    clarifyingQuestion: null,
    recommendations: [{ rank: 1, tables: ["T41"], seats: 8, waitMin: 11 }],
    validatorRejects: 0,
    refused: false,
    model: "scripted",
    costUsd: 0.02,
    latencyMs: 6000,
  });
  // the same response delivered twice must still be one row
  events.push({ ...(events[events.length - 1] as AssistantEvent) });
  // two in-request chat turns on Q2 (the manager's words must never reach the log)
  const chat = ["find another space between tables 30–50", "headcount is now 26"];
  chat.forEach((m, i) =>
    events.push({
      type: "request-chat",
      refId: "Q2",
      traceId: `c-${i + 1}`,
      at: `2026-11-03T15:1${i + 2}:00.000Z`,
      partySize: 22,
      when: "Fri 18:30",
      input: hash(m),
      changed: i === 0 ? ["tables 30–50"] : ["party of 26"],
      outcome: i === 0 ? "No capacity fit in tables 30–50 for 22 at 18:30." : "Capacity fit.",
      clarify: null,
      validatorRejects: 0,
      model: "scripted",
      costUsd: 0.0002,
      latencyMs: 1500,
    }),
  );
  const actions: ManagerAction[] = [
    {
      refId: "Q2",
      at: "2026-11-03T15:20:00.000Z",
      kind: "accepted",
      applied: "T57 + … (East suite)",
    },
    { refId: "Q3", at: "2026-11-03T15:21:00.000Z", kind: "declined", reason: "fit" },
    // an "accept" stamped before the request arrived is not a manager decision on it
    { refId: "Q1", at: "2026-11-03T14:00:00.000Z", kind: "accepted", applied: "stale" },
  ];
  return { events, actions, texts: [...book.requests.map((r) => r.message), host, ...chat] };
}

function checkRun(
  label: string,
  events: ActivityEvent[],
  actions: ManagerAction[],
  texts: string[],
): ActivityCheck[] {
  const rows = buildActivity(events, actions);
  const traces = [...new Set(events.map((e) => e.traceId))];
  const perTrace = traces.map((t) => rows.filter((r) => r.traceId === t).length);
  const oneEach = rows.length === traces.length && perTrace.every((n) => n === 1);
  const bad = rows.filter(
    (r) =>
      r.decision.kind === "accepted" &&
      !actions.some(
        (a) =>
          a.refId === r.refId && (a.kind === "accepted" || a.kind === "applied") && a.at >= r.at,
      ),
  );
  const blob = JSON.stringify(rows);
  const leaked = texts.filter((t) => t.length > 12 && blob.includes(t));
  return [
    {
      check: "one-row-per-action",
      case: label,
      ok: oneEach,
      detail: oneEach ? undefined : `${rows.length} rows for ${traces.length} actions`,
    },
    {
      check: "no-booking-without-manager",
      case: label,
      ok: bad.length === 0,
      detail: bad.length ? bad.map((r) => r.refId).join(", ") : undefined,
    },
    {
      check: "no-guest-text",
      case: label,
      ok: leaked.length === 0,
      detail: leaked.length ? `${leaked.length} text(s) leaked` : undefined,
    },
  ];
}

export function runActivityChecks(book: RequestBook, seedPath = "fixtures/activity/week.json") {
  const seed = ActivitySeed.parse(JSON.parse(readFileSync(seedPath, "utf8")));
  const s = scriptedSession(book);
  const out = [
    ...checkRun("seed-week", seed.events, seed.actions, []),
    ...checkRun("scripted-session", s.events, s.actions, s.texts),
    ...checkRun(
      "seed+session",
      [...seed.events, ...s.events],
      [...seed.actions, ...s.actions],
      s.texts,
    ),
  ];
  // the stale early "accept" on Q1 must not show as a booking
  const rows = buildActivity(s.events, s.actions);
  const q1 = rows.find((r) => r.refId === "Q1" && r.kind !== "request-chat");
  out.push({
    check: "no-booking-without-manager",
    case: "stale-action-ignored",
    ok: q1?.decision.kind === "pending",
    detail: q1?.decision.kind,
  });
  return out;
}
