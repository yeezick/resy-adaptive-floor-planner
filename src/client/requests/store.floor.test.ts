import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRequest, parseRequestBook } from "../../domain/requests";
import { parseRoom } from "../../domain";
import type { LayoutOp, TableRef } from "../../domain/layoutOps";
import type { ChatTurnOutput } from "../../domain/requestChat";
import type { RequestChatResult } from "../../shared/api";
import { turnSentence } from "./chatReply";

// Floor changes by conversation, end to end in the store: the model call is stubbed ($0); the engine is real.
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
const { layoutsStore, resetLayoutsStore } = await import("../layouts/useLayouts");

const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const fri = parseRoom(JSON.parse(readFileSync("fixtures/rooms/book-fri.json", "utf8")) as unknown);
const q2 = book.requests.find((r) => r.id === "Q2");
if (!q2) throw new Error("Q2 missing");
const fit = checkRequest(fri, q2);
const ctx = {
  room: fri,
  planArea: fit.ok ? fit.build.area : null,
  planTables: fit.ok ? fit.build.tables : [],
};

const none: ChatTurnOutput = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
  rooms: [],
  oneRoom: "unchanged",
  ops: [],
};
const ref = (p: Partial<TableRef>): TableRef => ({
  by: "number",
  n: 0,
  from: 0,
  to: 0,
  shape: "any",
  seats: 0,
  room: "",
  ...p,
});
const op = (p: Partial<LayoutOp>): LayoutOp => ({
  op: "move",
  tables: [],
  to: "",
  seats: 0,
  count: 0,
  rows: [],
  ...p,
});
const W9_OPS: LayoutOp[] = [
  op({ tables: [ref({ n: 56 })], to: "Library" }),
  op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" }),
  op({ op: "arrange_rows", to: "Garden Room", rows: [4, 5] }),
];
const W9 = "move 56 into the Library, move 63-66 into the Garden Room, 2 rows of 4 and 5";
const answer = (output: ChatTurnOutput) => ({
  ok: true,
  data: {
    requestId: "Q2",
    traceId: "t",
    promptVersion: "request-chat.v1.2",
    model: "stub",
    output,
    escalated: false,
    note: null,
    validatorRejects: 0,
    input: { sha256: "x", length: 1 },
    metrics: { costUsd: 0, latencyMs: 1, calls: [] },
  } satisfies RequestChatResult,
});
async function say(message: string, out: ChatTurnOutput, opts: Record<string, never> = {}) {
  const p = requestsActions.sendChat(q2 as never, message, ctx, opts);
  const i = pending.findIndex((x) => x.message === message);
  pending.splice(i, 1)[0]?.resolve(answer(out));
  await p;
  const t = getRequestsState().chat.Q2 ?? [];
  return t[t.length - 1];
}

beforeEach(() => {
  resetRequestsStore();
  resetLayoutsStore();
  pending.length = 0;
});

describe("floor changes by conversation (store)", () => {
  it("W9: a proposal (nothing applied), then Apply = a new one-day layout, then Revert = the previous layout, byte-identical", async () => {
    const before = JSON.stringify(layoutsStore.active(fri).room);
    const t = await say(W9, { ...none, ops: W9_OPS });
    expect(turnSentence(t ?? {})).toBe(
      "I'd change the floor (5 changes) — see Proposed changes above. Capacity fit: tables 57–61 and 63–66 · Garden Room · seats 22 for 22 at 18:30.",
    );
    const p = getRequestsState().proposals.Q2;
    expect(p?.floor?.changes).toHaveLength(5);
    // nothing changes until Apply
    expect(JSON.stringify(layoutsStore.active(fri).room)).toBe(before);
    expect(layoutsStore.active(fri).id).toBe("base");

    requestsActions.applyProposal("Q2", fri);
    const l = layoutsStore.active(fri);
    expect(l.kind).toBe("variant");
    expect(l.room.tables.find((x) => x.id === "T63")).toMatchObject({ area: "Garden Room", y: 9 });
    expect(getRequestsState().proposals.Q2).toBeUndefined();
    expect(getRequestsState().floorApplied.Q2?.changes[0]).toBe(
      "Table 56 · Garden Room → Library front (round spot)",
    );
    // the base layout itself is never changed
    expect(layoutsStore.entry(fri).stored.variants.some((v) => v.id === "base")).toBe(false);

    requestsActions.resetConstraints("Q2");
    expect(layoutsStore.active(fri).id).toBe("base");
    expect(JSON.stringify(layoutsStore.active(fri).room)).toBe(before);
    expect(layoutsStore.entry(fri).stored.variants.some((v) => v.id === l.id)).toBe(false);
  });

  it("stacked changes: apply A, apply B, revert A → the layout in use is still B's", async () => {
    await say(W9, { ...none, ops: W9_OPS });
    requestsActions.applyProposal("Q2", fri);
    const la = layoutsStore.active(fri);
    expect(la.kind).toBe("variant");

    // a later change B is applied on top of A (its previous layout is A's)
    const lb = layoutsStore.save(fri, la.room, { name: "B" });
    expect(layoutsStore.active(fri).id).toBe(lb.id);

    requestsActions.resetConstraints("Q2");
    expect(layoutsStore.entry(fri).stored.variants.some((v) => v.id === la.id)).toBe(false);
    expect(layoutsStore.active(fri).id).toBe(lb.id);
  });

  it("an accepted floor change drops a question the model sent alongside it (T10 on prod)", async () => {
    const t = await say(W9, {
      ...none,
      clarify: "Which room should the 2 rows of 4 and 5 go in?",
      ops: W9_OPS,
    });
    expect(t?.clarify).toBeUndefined();
    expect(turnSentence(t ?? {})).toMatch(/^I'd change the floor \(5 changes\)/);
  });

  it("G3: rooms the plan already opens are answered from plan state, with no proposal", async () => {
    const t = await say("open the rooms between Library and Garden Room", {
      ...none,
      rooms: ["Library", "Garden Room"],
    });
    expect(turnSentence(t ?? {})).toBe("Already open in this plan: Garden Room + Library.");
    expect(getRequestsState().proposals.Q2).toBeUndefined();
  });

  it("G4b: 'close the divider' with no single room that fits → the plain closest and the offer", async () => {
    const t = await say("close the divider between the Garden Room and the Library", {
      ...none,
      oneRoom: "yes",
    });
    expect(turnSentence(t ?? {})).toBe(
      "No single room fits 22 as the floor stands (today's Garden Room tables top out at 20). Ask me to move tables to make one room.",
    );
    expect(getRequestsState().proposals.Q2).toBeUndefined();
  });

  it("a rejected floor change lists every reason and proposes nothing (G5)", async () => {
    const t = await say("swap table 56 and table 62", {
      ...none,
      ops: [op({ op: "swap", tables: [ref({ n: 56 }), ref({ n: 62 })] })],
    });
    expect(turnSentence(t ?? {})).toBe(
      "Table 56 (round, 8) doesn't fit where table 62 stands. Table 62 (diamond, 4) doesn't fit where table 56 stands. Nothing changed.",
    );
    expect(getRequestsState().proposals.Q2).toBeUndefined();
  });

  it("G7: a description matching several tables comes back as the engine's question, no note", async () => {
    const t = await say("put the round 8-top in the Library instead", {
      ...none,
      ops: [op({ tables: [ref({ by: "description", shape: "round", seats: 8 })], to: "Library" })],
    });
    expect(turnSentence(t ?? {})).toMatch(
      /^Which round 8-top do you mean: table 56 \(Garden Room\), /,
    );
    expect(getRequestsState().proposals.Q2).toBeUndefined();
  });
});
