import { describe, expect, it } from "vitest";
import friJson from "../../fixtures/rooms/book-fri.json";
import requestsJson from "../../fixtures/requests/requests.json";
import { editImpact, planSummary, sectionsOf } from "./floorEdit";
import { canJoin, setJoin } from "./joins";
import { proposeLayoutEdit, sideBySide, type LayoutOp, type TableRef } from "./layoutOps";
import { baseConstraints, checkAdjusted } from "./requestChat";
import type { GuestRequest } from "./requests";
import { parseRoom, tableById } from "./room";
import type { Room, Table } from "./types";

const fri = () => parseRoom(friJson);
const whitaker = (requestsJson as { requests: GuestRequest[] }).requests.find(
  (r) => r.id === "Q2",
) as GuestRequest;
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
const texts = (e: { rejects: { text: string }[] }) => e.rejects.map((r) => r.text);

describe("joinability edits", () => {
  it("canJoin names why two tables can't be made joinable", () => {
    const room = fri();
    expect(canJoin(room, "T63", "T63")).toBe("pick another table");
    expect(canJoin(room, "T62", "T63")).toBe("only rectangular tables can join");
    expect(canJoin(room, "T63", "T57")).toBe("tables are in different areas");
    expect(canJoin(room, "T63", "T64")).toBe("already joinable");
    expect(canJoin(room, "T63", "T67")).toBeNull();
  });
  it("setJoin adds an edge, and removing it drops a combo that relied on it", () => {
    const room: Room = { ...fri(), combos: [["T63", "T64"]] };
    const on = setJoin(room, "T63", "T67", true);
    expect(on.joins).toContainEqual(["T63", "T67"]);
    expect(setJoin(room, "T63", "T64", true)).toBe(room);
    const off = setJoin(room, "T64", "T63", false);
    expect(off.joins.some(([a, b]) => a === "T63" && b === "T64")).toBe(false);
    expect(off.combos).toEqual([]);
  });
  it("sideBySide: same row and close, either axis", () => {
    const room = fri();
    const t = (id: string) => tableById(room, id) as Table;
    expect(sideBySide(t("T63"), t("T64"))).toBe(true);
    expect(sideBySide(t("T63"), t("T67"))).toBe(false);
    expect(sideBySide({ ...t("T63"), x: 0, y: 0 }, { ...t("T63"), id: "T999", x: 0, y: 5 })).toBe(
      true,
    );
    expect(sideBySide(t("T63"), t("T57"))).toBe(false);
  });
});

describe("more floor edits", () => {
  it("a swap of two 4-tops in one room: each takes the other's place, attributes and joins", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, [
      op({ op: "swap", tables: [ref({ n: 63 }), ref({ n: 67 })] }),
    ]);
    expect(e.ok).toBe(true);
    const ed = e.edited as Room;
    expect(tableById(ed, "T67")).toMatchObject({ x: 106, y: 18, attrs: { accessible: true } });
    expect(tableById(ed, "T63")).toMatchObject({ x: 106, y: 24, attrs: { accessible: false } });
    expect(ed.joins).toContainEqual(["T67", "T64"]);
    expect(e.changes.map((c) => c.kind)).toEqual(["swap", "swap"]);
  });
  it("a joinable 4-top taken out goes back to storage; the party on it is re-planned elsewhere", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, [op({ op: "to_storage", tables: [ref({ n: 77 })] })]);
    expect(e.ok).toBe(true);
    const ed = e.edited as Room;
    expect(ed.inventory.spareTables.find((x) => x.seats === 4)?.count).toBe(7);
    expect(e.changes[0]?.text).toBe("Table 77 · Loft → storage");
    expect(e.crew[0]).toBe("Take table 77 out of the Loft to storage");
    const im = editImpact(room, ed, whitaker, baseConstraints(whitaker), (id) =>
      id === "F1" ? "Oduya, C." : id,
    );
    expect(im.bookingsMoved).toEqual(["Oduya, C. (12): Loft → Gallery · guest not told"]);
  });
  it("a swap within a row names the other bookings whose tables change", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, [
      op({ op: "swap", tables: [ref({ n: 63 }), ref({ n: 67 })] }),
    ]);
    const im = editImpact(room, e.edited as Room, whitaker, baseConstraints(whitaker));
    expect(im.bookingsMoved[0]).toMatch(/^F4 \(24\): tables .+ → tables .+$/);
  });
  it("2-tops from storage fill the Dining room's spare spots", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ op: "from_storage", seats: 2, count: 2, to: "Dining room" }),
    ]);
    expect(e.changes.map((c) => c.text)).toEqual([
      "New table 96 (2-top from storage) · → Dining room spare spot (west)",
      "New table 97 (2-top from storage) · → Dining room spare spot (east)",
    ]);
    expect(e.edited?.areas.find((a) => a.name === "Dining room")?.spareSlots).toBe(0);
  });
  it("a move within a room never lands back on the table's own home", () => {
    const e = proposeLayoutEdit(fri(), [op({ tables: [ref({ n: 67 })], to: "Library" })]);
    expect(e.ok).toBe(true);
    expect(e.changes[0]?.text).toBe("Table 67 · Library → Library spare spot");
    expect(e.crew[0]).toBe("Move table 67 within the Library to the Library spare spot");
  });
  it("plain reasons for references that resolve to nothing", () => {
    const room = fri();
    const one = (o: LayoutOp) => texts(proposeLayoutEdit(room, [o]));
    expect(
      one(op({ tables: [ref({ by: "description", shape: "booth", seats: 9 })], to: "Library" })),
    ).toEqual(["No booth 9-top on this floor."]);
    expect(one(op({ tables: [ref({ by: "range", from: 900, to: 910 })], to: "Library" }))).toEqual([
      "No tables numbered 900–910 on this floor.",
    ]);
    expect(one(op({ tables: [ref({ by: "room", room: "Ballroom" })], to: "Library" }))).toEqual([
      "There's no Ballroom on this floor.",
    ]);
    expect(one(op({ op: "swap", tables: [ref({ n: 63 })] }))).toEqual([
      "Which two tables should swap places?",
    ]);
    expect(one(op({ op: "from_storage", seats: 4, count: 0, to: "Library" }))).toEqual([
      "Bring between 1 and 6 tables from storage at a time.",
    ]);
    expect(one(op({ tables: [ref({ n: 63 })], to: "" }))).toEqual([
      "Which room should they go to?",
    ]);
    expect(one(op({ op: "join", tables: [ref({ n: 1 }), ref({ n: 2 })] }))).toEqual([
      "Table 1 is a booth — booths are fixed, so it stays where it is.",
      "Table 2 is a booth — booths are fixed, so it stays where it is.",
    ]);
    expect(one(op({ op: "join", tables: [ref({ n: 62 }), ref({ n: 63 })] }))).toEqual([
      "Tables 63 and 62 can't join: only rectangular tables can join.",
    ]);
  });
  it("split of tables that aren't joinable is a plain note, no change", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ op: "split", tables: [ref({ n: 62 }), ref({ n: 67 })] }),
    ]);
    expect(e.ok).toBe(false);
    expect(e.notes).toEqual(["Those two tables aren't joinable now, so there's nothing to split."]);
  });
  it("R3: a table that won't be free by service start, and a blocked one", () => {
    const room = fri();
    room.tables = room.tables.map((t) =>
      t.id === "T63"
        ? { ...t, status: "occupied", phase: "seated", partySize: 4 }
        : t.id === "T64"
          ? { ...t, status: "blocked" }
          : t,
    );
    room.clock = "16:50";
    const e = proposeLayoutEdit(room, [
      op({ tables: [ref({ by: "range", from: 63, to: 64 })], to: "Garden Room" }),
    ]);
    expect(texts(e)).toEqual([
      "Table 63 won't be free by 5:00 PM.",
      "Table 64 is blocked tonight.",
    ]);
  });
});

describe("plan summary", () => {
  it("one line per side; no fit says so with the closest", () => {
    const room = fri();
    const a = checkAdjusted(room, whitaker, {
      ...baseConstraints(whitaker),
      tableRange: { from: 1, to: 10 },
    });
    expect(planSummary(room, a)).toMatch(/^no capacity fit/);
    expect(sectionsOf(room, ["T57", "T63", "T99"])).toEqual([10, 11]);
  });
});
