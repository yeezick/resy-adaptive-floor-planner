import { describe, expect, it } from "vitest";
import friJson from "../../fixtures/rooms/book-fri.json";
import requestsJson from "../../fixtures/requests/requests.json";
import { resolveTurn } from "./floorTurn";
import { proposeLayoutEdit, type LayoutOp, type TableRef } from "./layoutOps";
import { baseConstraints, type ChatTurnOutput } from "./requestChat";
import { checkRequest, type GuestRequest } from "./requests";
import { parseRoom } from "./room";

const room = parseRoom(friJson);
const q2 = (requestsJson as { requests: GuestRequest[] }).requests.find(
  (r) => r.id === "Q2",
) as GuestRequest;
const fit = checkRequest(room, q2);
const ctx = {
  room,
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

describe("resolveTurn", () => {
  it("G3: rooms the plan already opens (oneRoom unchanged or 'no') are answered from plan state", () => {
    for (const oneRoom of ["unchanged", "no"] as const)
      expect(
        resolveTurn(
          q2,
          baseConstraints(q2),
          { ...none, rooms: ["Library", "the Garden Room"], oneRoom },
          ctx,
        ),
      ).toEqual({ kind: "answer", text: "Already open in this plan: Garden Room + Library." });
  });
  it("other rooms are a proposal of that constraint", () => {
    const r = resolveTurn(q2, baseConstraints(q2), { ...none, rooms: ["Atrium"] }, ctx);
    expect(r.kind).toBe("proposal");
    if (r.kind === "proposal") expect(r.changed).toEqual(["only the Atrium"]);
  });
  it("a floor change is a proposal carrying the engine's edit; the count leads the change list", () => {
    const r = resolveTurn(
      q2,
      baseConstraints(q2),
      {
        ...none,
        ops: [op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" })],
      },
      ctx,
    );
    expect(r.kind === "proposal" && r.floor?.changes.length).toBe(4);
    expect(r.kind === "proposal" && r.changed).toEqual(["the floor (4 changes)"]);
  });
});

describe("arrange_rows with no room named", () => {
  it("means the room the same message moves tables into", () => {
    const e = proposeLayoutEdit(room, [
      op({ tables: [ref({ n: 56 })], to: "Library" }),
      op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" }),
      op({ op: "arrange_rows", rows: [4, 5] }),
    ]);
    expect(e.ok).toBe(true);
  });
  it("with no move to infer from, asks which room", () => {
    const e = proposeLayoutEdit(room, [op({ op: "arrange_rows", rows: [4, 5] })]);
    expect(e.rejects.map((r) => r.text)).toEqual(["Which room should they go to?"]);
  });
});

describe("T14: a party under 7", () => {
  it("needs no large-party plan (not 'no capacity fit')", async () => {
    const { checkAdjusted, UNDER_LARGE } = await import("./requestChat");
    const a = checkAdjusted(room, q2, { ...baseConstraints(q2), partySize: 6 });
    expect(a.line).toBe(UNDER_LARGE);
    expect(a.line).toBe(
      "Parties under 7 don't need a large-party plan — the host seats them like any booking.",
    );
  });
});
