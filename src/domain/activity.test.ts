import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ActivitySeed,
  activityCounts,
  buildActivity,
  filterActivity,
  type AssistantEvent,
  type TriageEvent,
} from "./activity";

const seed = ActivitySeed.parse(
  JSON.parse(readFileSync("fixtures/activity/week.json", "utf8")) as unknown,
);
const rows = buildActivity(seed.events, seed.actions);

const triage = (over: Partial<TriageEvent> = {}): TriageEvent => ({
  type: "triage",
  refId: "Q1",
  traceId: "t1",
  at: "2026-11-03T15:00:00.000Z",
  source: "app",
  partySize: 14,
  when: "Sat 19:00",
  verdict: "real",
  escalated: false,
  reason: "r",
  summary: ["Birthday for 14.", "Long table."],
  validatorRejects: 0,
  model: "m",
  costUsd: 0.0001,
  latencyMs: 1000,
  message: { sha256: "abcdef0123456789", length: 120 },
  solver: [],
  ...over,
});

describe("buildActivity", () => {
  it("makes one row per AI action, newest first", () => {
    expect(rows).toHaveLength(seed.events.length);
    const at = rows.map((r) => r.at);
    expect([...at].sort().reverse()).toEqual(at);
  });

  it("seeds a mix: accepted, declined for fit, declined for policy, junk, a refusal, an escalation", () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toEqual(
      new Set(["request", "escalation", "recommendation", "refusal", "assistant-question"]),
    );
    expect(rows.some((r) => r.flags.includes("junk"))).toBe(true);
    expect(rows.some((r) => r.flags.includes("validator-reject"))).toBe(true);
    const c = activityCounts(rows);
    expect(c).toMatchObject({
      requests: 5,
      accepted: 1,
      declined: { fit: 1, policy: 2, other: 0 },
    });
  });

  it("shows a decision only from a manager action at or after the AI action", () => {
    const e = triage();
    expect(buildActivity([e], [])[0]?.decision).toEqual({ kind: "pending" });
    const early = { refId: "Q1", at: "2026-11-03T14:00:00.000Z", kind: "accepted" as const };
    expect(buildActivity([e], [early])[0]?.decision.kind).toBe("pending");
    const late = { ...early, at: "2026-11-03T16:00:00.000Z", applied: "T1 + T2" };
    const row = buildActivity([e], [late])[0];
    expect(row?.decision).toMatchObject({ kind: "accepted", applied: "T1 + T2" });
    expect(row?.record.applied).toBe("T1 + T2");
  });

  it("maps declines with reasons, edited replies, and refusals/questions to nothing to decide", () => {
    const e = triage();
    const at = "2026-11-03T16:00:00.000Z";
    expect(
      buildActivity([e], [{ refId: "Q1", at, kind: "declined", reason: "policy" }])[0]?.decision,
    ).toMatchObject({ kind: "declined", reason: "policy" });
    expect(
      buildActivity([e], [{ refId: "Q1", at, kind: "replied", edited: true }])[0]?.decision.kind,
    ).toBe("edited");
    const refusal = rows.find((r) => r.kind === "refusal");
    expect(refusal?.decision.kind).toBe("none");
  });

  it("dedupes a response delivered twice, and flags failed AI actions as escalations", () => {
    const a = seed.events.find((x) => x.type === "assistant") as AssistantEvent;
    expect(buildActivity([a, { ...a }], [])).toHaveLength(1);
    const failed = buildActivity([triage({ failed: "no_key", escalated: true })], [])[0];
    expect(failed?.kind).toBe("escalation");
    expect(failed?.what).toMatch(/Triage failed \(no_key\) — needs a person/);
  });

  it("keeps guest text out: inputs show only the hash and length", () => {
    const r = buildActivity([triage()], [])[0];
    expect(r?.record.inputs).toContainEqual(["Guest text", "sha256 abcdef012345… · 120 chars"]);
  });
});

describe("filterActivity", () => {
  it("filters by type (incl. flags), decision and decline reason", () => {
    expect(filterActivity(rows, { type: "refusal" }).every((r) => r.kind === "refusal")).toBe(true);
    expect(filterActivity(rows, { type: "validator-reject" }).length).toBe(2);
    expect(filterActivity(rows, { decision: "declined", reason: "policy" })).toHaveLength(2);
    expect(filterActivity(rows, {})).toHaveLength(rows.length);
  });
});

describe("request-chat rows", () => {
  it("logs one row per chat turn with the manager's text as a hash and the planner's answer", () => {
    const rows = buildActivity(
      [
        {
          type: "request-chat",
          refId: "Q2",
          traceId: "c-1",
          at: "2026-11-03T15:12:00.000Z",
          partySize: 22,
          when: "Fri 18:30",
          input: { sha256: "abcdef0123456789", length: 38 },
          changed: ["tables 30–50"],
          outcome: "No capacity fit in tables 30–50 for 22 at 18:30.",
          clarify: null,
          validatorRejects: 0,
          model: "claude-haiku-5-5",
          costUsd: 0.0002,
          latencyMs: 1500,
        },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "request-chat",
      source: "host",
      what: "Request chat: tables 30–50 → No capacity fit in tables 30–50 for 22 at 18:30.",
      decision: { kind: "pending" },
    });
    expect(rows[0]?.record.inputs).toContainEqual([
      "Manager's message",
      "sha256 abcdef012345… · 38 chars",
    ]);
    expect(activityCounts(rows).requests).toBe(0);
  });
});
