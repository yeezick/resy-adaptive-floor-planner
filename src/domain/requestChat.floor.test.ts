import { describe, expect, it } from "vitest";
import friJson from "../../fixtures/rooms/book-fri.json";
import requestsJson from "../../fixtures/requests/requests.json";
import type { LayoutOp, TableRef } from "./layoutOps";
import {
  baseConstraints,
  changeList,
  chatTurnProblems,
  checkAdjusted,
  mergeTurn,
  ChatTurnRecorded,
  type ChatTurnOutput,
} from "./requestChat";
import type { GuestRequest } from "./requests";
import { parseRoom } from "./room";

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
const ROOMS = [
  "Dining room",
  "Terrace",
  "Garden Room",
  "Library",
  "Cellar",
  "Loft",
  "Atrium",
  "Gallery",
];
const whitaker = (requestsJson as { requests: GuestRequest[] }).requests.find(
  (r) => r.id === "Q2",
) as GuestRequest;

describe("chatTurnProblems: floor changes", () => {
  it("accepts W9's three operations, with every number typed and rooms from tonight's floor", () => {
    const out: ChatTurnOutput = {
      ...none,
      ops: [
        op({ tables: [ref({ n: 56 })], to: "Library" }),
        op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" }),
        op({ op: "arrange_rows", to: "Garden Room", rows: [4, 5] }),
      ],
    };
    const msg = "move 56 into the Library, move 63-66 into the Garden Room, 2 rows of 4 and 5";
    expect(chatTurnProblems(out, msg, { rooms: ROOMS })).toEqual([]);
  });
  it("rejects a table number or a row size the manager didn't type", () => {
    const out = { ...none, ops: [op({ tables: [ref({ n: 57 })], to: "Garden Room" })] };
    expect(chatTurnProblems(out, "move 56 into the garden room", { rooms: ROOMS })).toContain(
      "a floor change uses a number the manager didn't type",
    );
  });
  it("a storage count is exempt from the typed-digit rule (1–6 only)", () => {
    const two = { ...none, ops: [op({ op: "from_storage", seats: 4, count: 2, to: "Library" })] };
    expect(
      chatTurnProblems(two, "bring two 4-tops from the back into the Library", { rooms: ROOMS }),
    ).toEqual([]);
    const lots = { ...none, ops: [op({ op: "from_storage", seats: 4, count: 9, to: "Library" })] };
    expect(chatTurnProblems(lots, "bring 4-tops", { rooms: ROOMS })).toContain(
      "bring between 1 and 6 tables from storage",
    );
  });
  it("rejects a room that isn't one of tonight's seating rooms", () => {
    const out = { ...none, rooms: ["Ballroom"] };
    expect(chatTurnProblems(out, "put them in the ballroom", { rooms: ROOMS })).toEqual([
      "not a seating room tonight: Ballroom",
    ]);
    const bar = { ...none, ops: [op({ tables: [ref({ n: 56 })], to: "Bar" })] };
    expect(chatTurnProblems(bar, "move 56 to the bar", { rooms: ROOMS })[0]).toMatch(
      /not a seating room/,
    );
  });
  it("T13: a crew note that is a room or a table is not a note", () => {
    const room = { ...none, notes: ["library room"] };
    expect(
      chatTurnProblems(room, "put the round 8-top in the Library instead", { rooms: ROOMS }),
    ).toContain("a note names a room — use rooms or a floor change instead");
    const table = { ...none, notes: ["round eight-top"] };
    expect(chatTurnProblems(table, "use the round eight-top", { rooms: ROOMS })).toContain(
      "a note describes a table — use a floor change instead",
    );
    expect(
      chatTurnProblems({ ...none, notes: ["high chair"] }, "a high chair", { rooms: ROOMS }),
    ).toEqual([]);
  });
  it("counts rooms, oneRoom and ops as a change", () => {
    expect(
      chatTurnProblems({ ...none, oneRoom: "yes" }, "close the divider", { rooms: ROOMS }),
    ).toEqual([]);
    expect(
      chatTurnProblems({ ...none, rooms: ["Library"] }, "in the library", { rooms: ROOMS }),
    ).toEqual([]);
    expect(chatTurnProblems(none, "hi", { rooms: ROOMS })).toEqual(["no change and no question"]);
  });
  it("Shift setup allows floor changes only", () => {
    const out = {
      ...none,
      partySize: 26,
      ops: [op({ op: "to_storage", tables: [ref({ n: 62 })] })],
    };
    expect(
      chatTurnProblems(out, "take 62 out, 26 people", { rooms: ROOMS, floorOnly: true }),
    ).toContain("Shift setup has no request: return floor changes only");
  });
});

describe("rooms and oneRoom constraints", () => {
  it("a turn that doesn't touch them leaves the constraints byte-identical", () => {
    const c = baseConstraints(whitaker);
    expect(JSON.stringify(mergeTurn(c, { ...none, partySize: 26 }))).toBe(
      JSON.stringify({ ...c, partySize: 26 }),
    );
  });
  it("merge and list them", () => {
    const c = mergeTurn(baseConstraints(whitaker), { ...none, rooms: ["Library"], oneRoom: "yes" });
    expect(c.rooms).toEqual(["Library"]);
    expect(c.oneRoom).toBe(true);
    expect(changeList(whitaker, c)).toEqual(["only the Library", "one room"]);
    expect(mergeTurn(c, { ...none, oneRoom: "no" }).oneRoom).toBeUndefined();
  });
  it("oneRoom on today's floor: no single room fits 22; closest is the Garden Room at 20 seats", () => {
    const a = checkAdjusted(parseRoom(friJson), whitaker, {
      ...baseConstraints(whitaker),
      oneRoom: true,
    });
    expect(a.fit.ok).toBe(false);
    expect(a.line).toBe(
      "No capacity fit in one room for 22 at 18:30. Closest: Garden Room, 20 seats.",
    );
  });
  it("rooms limits the plan to those rooms", () => {
    const a = checkAdjusted(parseRoom(friJson), whitaker, {
      ...baseConstraints(whitaker),
      rooms: ["Garden Room", "Library"],
    });
    expect(a.fit.ok && a.fit.build.area).toBe("Garden Room + Library");
  });
  it("a recorded answer without the floor fields still reads (they default to none)", () => {
    const { rooms: _r, oneRoom: _o, ops: _p, ...old } = none;
    expect(ChatTurnRecorded.parse(old)).toEqual(none);
  });
});
