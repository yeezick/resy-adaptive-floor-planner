import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRequestBook } from "../../domain/requests";
import type { RequestChatResult } from "../../shared/api";
import type { ChatTurnOutput } from "../../domain/requestChat";
import { turnSentence } from "./chatReply";

// Each chat turn keeps its own answer: the model call is stubbed, answers can arrive in any order or late.
const pending: { message: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../api", () => ({
  postRequestChat: (_id: string, body: { message: string }) =>
    new Promise((resolve) => pending.push({ message: body.message, resolve })),
  postDecision: () => Promise.resolve({ ok: true, data: { ok: true } }),
  postTriage: () => new Promise(() => {}),
  fetchRequests: () => new Promise(() => {}),
  fetchRoom: () => new Promise(() => {}),
}));

const { requestsActions, getRequestsState, resetRequestsStore } = await import("./store");

const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const q2 = book.requests.find((r) => r.id === "Q2");
if (!q2) throw new Error("Q2 missing");

const none: ChatTurnOutput = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
  // the floor-edit fields (spread, so this reads under older and newer output types alike)
  ...{ rooms: [] as string[], oneRoom: "unchanged" as const, ops: [] },
};
const answer = (output: ChatTurnOutput | null, note: string | null = null) => ({
  ok: true,
  data: {
    requestId: "Q2",
    traceId: "t",
    promptVersion: "request-chat.v1.1",
    model: "stub",
    output,
    escalated: output === null,
    note,
    validatorRejects: 0,
    input: { sha256: "x", length: 1 },
    metrics: { costUsd: 0, latencyMs: 1, calls: [] },
  } satisfies RequestChatResult,
});
const reply = (message: string, v: unknown) => {
  const i = pending.findIndex((p) => p.message === message);
  const [p] = pending.splice(i, 1);
  p?.resolve(v);
};
const turns = () => getRequestsState().chat.Q2 ?? [];
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetRequestsStore();
  pending.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("request chat: every reply is bound to its own turn", () => {
  it("clarify → change → change: three different replies", async () => {
    const q = "Which arrival time should I test against the Library, for example 19:30?";
    const a = requestsActions.sendChat(q2, "latest we could seat them in the Library?");
    reply("latest we could seat them in the Library?", answer({ ...none, clarify: q }));
    await a;
    const b = requestsActions.sendChat(q2, "Headcount is now 26");
    reply("Headcount is now 26", answer({ ...none, partySize: 26 }));
    await b;
    const c = requestsActions.sendChat(q2, "push it to 19:00");
    reply("push it to 19:00", answer({ ...none, time: "19:00" }));
    await c;
    const t = turns();
    expect(t.map((x) => x.status)).toEqual(["ok", "ok", "ok"]);
    expect(turnSentence(t[0] as never)).toBe(q);
    expect(t[1]?.changed).toEqual(["party of 26"]);
    expect(t[2]?.changed).toEqual(["at 19:00"]);
    // turn 1 still reads its own question after the later turns
    expect(t[0]?.clarify).toBe(q);
    expect(t[0]?.changed).toEqual([]);
  });

  it("two sends before the first returns: each answer lands on its own turn", async () => {
    const a = requestsActions.sendChat(q2, "Headcount is now 26");
    const b = requestsActions.sendChat(q2, "what was the response?");
    // the second answer comes back first
    reply("what was the response?", answer({ ...none, clarify: "Which change do you mean?" }));
    await b;
    expect(turns()[0]?.status).toBe("loading");
    expect(turns()[1]?.clarify).toBe("Which change do you mean?");
    reply("Headcount is now 26", answer({ ...none, partySize: 26 }));
    await a;
    expect(turns()[0]?.changed).toEqual(["party of 26"]);
    expect(turns()[1]?.changed).toEqual([]);
    expect(turns()[1]?.clarify).toBe("Which change do you mean?");
  });

  it("no usable answer: the escalation line, nothing proposed", async () => {
    const a = requestsActions.sendChat(q2, "do the thing");
    reply("do the thing", answer(null));
    await a;
    expect(turnSentence(turns()[0] as never)).toBe(
      "I couldn't turn that into a change. Nothing changed. You can set party, time, tables and needs on the review screen after Accept.",
    );
    expect(getRequestsState().proposals.Q2).toBeUndefined();
  });

  it("a late answer replaces the timeout line instead of being dropped", async () => {
    vi.useFakeTimers();
    const a = requestsActions.sendChat(q2, "Headcount is now 26");
    vi.advanceTimersByTime(40_000);
    expect(turns()[0]).toMatchObject({
      status: "error",
      outcome: "That took too long. Nothing changed. Try again.",
    });
    vi.useRealTimers();
    reply("Headcount is now 26", answer({ ...none, partySize: 26 }));
    await a;
    await tick();
    expect(turns()[0]).toMatchObject({ status: "ok", changed: ["party of 26"] });
    expect(getRequestsState().proposals.Q2?.constraints.partySize).toBe(26);
  });
});
