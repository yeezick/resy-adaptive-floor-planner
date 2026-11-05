import { describe, expect, it } from "vitest";
import friJson from "../../fixtures/rooms/book-fri.json";
import peakJson from "../../fixtures/rooms/dinner-peak.json";
import requestsJson from "../../fixtures/requests/requests.json";
import { planBuilds } from "./buildplan";
import { VENUE_CLEARANCE } from "./clearance";
import { editImpact } from "./floorEdit";
import { MAX_OPS, proposeLayoutEdit, rowSizes, type LayoutOp, type TableRef } from "./layoutOps";
import { baseConstraints } from "./requestChat";
import { SERVICE, type GuestRequest } from "./requests";
import { parseRoom } from "./room";
import { clearanceForLayout, VENUE_SPOTS } from "./spots";
import { generateTonight } from "./tonight";
import type { Room } from "./types";

const fri = () => parseRoom(friJson);
const peak = () => parseRoom(peakJson);
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
const n = (k: number) => ref({ n: k });
const range = (from: number, to: number) => ref({ by: "range", from, to });

const W9: LayoutOp[] = [
  op({ tables: [n(56)], to: "Library" }),
  op({ tables: [range(63, 66)], to: "Garden Room" }),
  op({ op: "arrange_rows", to: "Garden Room", rows: [4, 5] }),
];
const texts = (e: { rejects: { text: string }[] }) => e.rejects.map((r) => r.text);
const rules = (e: { rejects: { rule: string }[] }) => e.rejects.map((r) => r.rule);

describe("floor edits: goldens on book-fri", () => {
  it("G1 (W9 verbatim): 56 to the Library, 63–66 to the Garden Room back row; Whitaker in one room", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, W9);
    expect(e.ok).toBe(true);
    expect(e.changes.map((c) => c.text)).toEqual([
      "Table 56 · Garden Room → Library front (round spot)",
      "Table 63 · Library → Garden Room back row",
      "Table 64 · Library → Garden Room back row",
      "Table 65 · Library → Garden Room back row",
      "Table 66 · Library → Garden Room back row",
    ]);
    expect(e.crew[1]).toBe("Move table 63 from the Library to the Garden Room back row");
    expect(e.crewMinutes).toBe(15);
    const ed = e.edited as Room;
    expect(rowSizes(ed, "Garden Room").sort()).toEqual([4, 5]);
    const im = editImpact(room, ed, whitaker, baseConstraints(whitaker));
    expect(im.after.fit.ok).toBe(true);
    if (!im.after.fit.ok) return;
    expect(im.after.fit.build.area).toBe("Garden Room");
    expect(im.after.fit.build.seats).toBe(22);
    expect(im.after.fit.build.dividersOpened).toEqual([]);
    expect([...im.after.fit.build.tables].sort()).toEqual(
      ["T57", "T58", "T59", "T60", "T61", "T63", "T64", "T65", "T66"].sort(),
    );
    expect(im.planBefore).toBe(
      "tables 57–61 and 63–66 · Garden Room + Library (divider open) · two servers (sections 10 + 11)",
    );
    expect(im.planAfter).toBe(
      "tables 57–61 and 63–66 · Garden Room only · one server (section 10)",
    );
    expect(im.bookingsMoved).toEqual([]);
  });

  it("G2 (T9): 63–66 go to the Garden Room back row; 56 stays; Whitaker in the Garden Room only", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, [op({ tables: [range(63, 66)], to: "garden room" })]);
    expect(e.ok).toBe(true);
    const ed = e.edited as Room;
    expect(ed.tables.find((t) => t.id === "T56")?.area).toBe("Garden Room");
    expect(ed.tables.filter((t) => t.area === "Garden Room" && t.y === 9).map((t) => t.id)).toEqual(
      ["T63", "T64", "T65", "T66"],
    );
    const im = editImpact(room, ed, whitaker, baseConstraints(whitaker));
    expect(im.planAfter).toBe(
      "tables 57–61 and 63–66 · Garden Room only · one server (section 10)",
    );
  });

  it("moved tables take the spot's attributes, the room's section, and join their new row", () => {
    const ed = proposeLayoutEdit(fri(), W9).edited as Room;
    const t63 = ed.tables.find((t) => t.id === "T63");
    expect(t63).toMatchObject({
      area: "Garden Room",
      section: 10,
      x: 106,
      y: 9,
      maxExtraChairs: 1,
    });
    expect(t63?.attrs).toMatchObject({ accessible: true, quiet: true, strollerSpace: false });
    expect(ed.tables.find((t) => t.id === "T64")?.maxExtraChairs).toBe(0);
    expect(ed.joins).toEqual(
      expect.arrayContaining([
        ["T63", "T64"],
        ["T64", "T65"],
        ["T65", "T66"],
      ]),
    );
    expect(ed.tables.find((t) => t.id === "T56")).toMatchObject({ area: "Library", x: 106, y: 17 });
  });

  it("G5 (T12): swapping a round 8-top and a diamond gives two R5 lines", () => {
    const e = proposeLayoutEdit(fri(), [op({ op: "swap", tables: [n(56), n(62)] })]);
    expect(e.ok).toBe(false);
    expect(texts(e)).toEqual([
      "Table 56 (round, 8) doesn't fit where table 62 stands.",
      "Table 62 (diamond, 4) doesn't fit where table 56 stands.",
    ]);
  });

  it("G6 (T17): 62 out, two 4-tops in: one on 62's spot, one on the spare spot; spareSlots drops", () => {
    const room = fri();
    const e = proposeLayoutEdit(room, [
      op({ op: "to_storage", tables: [n(62)] }),
      op({ op: "from_storage", seats: 4, count: 2, to: "Library" }),
    ]);
    expect(e.ok).toBe(true);
    const ed = e.edited as Room;
    const added = ed.tables.filter((t) => !room.tables.some((x) => x.id === t.id));
    expect(added.map((t) => [t.id, t.x, t.y])).toEqual([
      ["T96", 98, 21],
      ["T97", 131, 24],
    ]);
    expect(ed.tables.some((t) => t.id === "T62")).toBe(false);
    expect(ed.areas.find((a) => a.name === "Library")?.spareSlots).toBe(0);
    // the diamond is set aside (not a joinable rectangle): storage gives two 4-tops and takes none back
    expect(ed.inventory.spareTables.find((x) => x.seats === 4)?.count).toBe(4);
    expect(e.changes[0]?.text).toBe("Table 62 · Library → set aside for tonight");
  });

  it("G7 (T13): a description matching five tables asks which, nearest the plan first; never guesses", () => {
    const e = proposeLayoutEdit(
      fri(),
      [op({ tables: [ref({ by: "description", shape: "round", seats: 8 })], to: "Library" })],
      { near: ["T57", "T63"] },
    );
    expect(rules(e)).toEqual(["R1"]);
    expect(texts(e)[0]).toMatch(/^Which round 8-top do you mean: table 56 \(Garden Room\), /);
    for (const k of ["18", "41", "70", "81"]) expect(texts(e)[0]).toContain(`table ${k} (`);
  });

  it("G8: two tables not side by side in a row can't be joined (R9)", () => {
    const e = proposeLayoutEdit(fri(), [op({ op: "join", tables: [n(66), n(67)] })]);
    expect(texts(e)).toEqual(["Tables 66 and 67 aren't side by side in a row."]);
  });

  it("G9: two 4-tops into the Library with nothing vacated → R4, one free spot", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ op: "from_storage", seats: 4, count: 2, to: "Library" }),
    ]);
    expect(texts(e)).toEqual(["Only 1 free spot in the Library for 2 tables."]);
  });

  it("join of tables already joinable answers from plan state, no change", () => {
    const e = proposeLayoutEdit(fri(), [op({ op: "join", tables: [range(67, 69)] })]);
    expect(e.ok).toBe(false);
    expect(e.rejects).toEqual([]);
    expect(e.notes).toEqual([
      "Already joinable; the planner pushes them together when a party needs it.",
    ]);
  });

  it("split removes joinability for tonight", () => {
    const e = proposeLayoutEdit(fri(), [op({ op: "split", tables: [range(63, 66)] })]);
    expect(e.ok).toBe(true);
    expect((e.edited as Room).joins.some(([a]) => a === "T63" || a === "T64")).toBe(false);
    expect(e.changes[0]?.text).toBe("Tables 63–64, 64–65 and 65–66 · not pushed together tonight");
  });
});

describe("floor edits: adversarial", () => {
  it("A3: the Library's 8 tables into the Garden Room → R4 with the real free count", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ tables: [ref({ by: "room", room: "Library" })], to: "Garden Room" }),
    ]);
    expect(texts(e)).toEqual(["5 free spots in the Garden Room for 8 tables."]);
  });
  it("A4: an unknown table → R1", () => {
    const e = proposeLayoutEdit(fri(), [op({ tables: [n(999)], to: "Garden Room" })]);
    expect(texts(e)).toEqual(["Table 999 isn't on this floor."]);
  });
  it("A5 (live 7:10 PM): table 41 occupied now AND round → R3 and R5, both listed", () => {
    const e = proposeLayoutEdit(peak(), [op({ tables: [n(41)], to: "Garden Room" })]);
    expect(rules(e)).toEqual(["R3", "R5"]);
    expect(texts(e)).toEqual([
      "Table 41 is occupied now.",
      "Table 41 (round, 8) doesn't fit the free spots in the Garden Room.",
    ]);
  });
  it("A6b: a booth is fixed (R11), terminal for that table", () => {
    const e = proposeLayoutEdit(fri(), [op({ tables: [n(1)], to: "Terrace" })]);
    expect(texts(e)).toEqual(["Table 1 is a booth — booths are fixed, so it stays where it is."]);
  });
  it("A9: taking the Atrium's rows out leaves the 16 with no table (R8), named", () => {
    const e = proposeLayoutEdit(
      fri(),
      [op({ op: "to_storage", tables: [range(82, 86), range(87, 90)] })],
      { nameOf: (id) => (id === "F2" ? "Petrov, J." : id) },
    );
    expect(texts(e)).toEqual(["Petrov, J. (16) would have no table at 6:30 PM."]);
  });
});

describe("floor edits: every rule", () => {
  it("R2: a room not on the floor, or not a seating room", () => {
    expect(texts(proposeLayoutEdit(fri(), [op({ tables: [n(57)], to: "Bar" })]))).toEqual([
      "The Bar isn't a seating room.",
    ]);
    expect(texts(proposeLayoutEdit(fri(), [op({ tables: [n(57)], to: "Ballroom" })]))).toEqual([
      "There's no Ballroom on this floor.",
    ]);
  });
  it("R3 (planning night): a table held for a party can't move", () => {
    const room = fri();
    room.tables = room.tables.map((t) =>
      t.id === "T63" ? { ...t, status: "reserved", reservedAt: "18:00" } : t,
    );
    const e = proposeLayoutEdit(room, [op({ tables: [n(63)], to: "Garden Room" })]);
    expect(texts(e)).toEqual(["Table 63 is held for 6:00 PM."]);
  });
  it("R6: a measured aisle below the minimum rejects the join (short-aisle variant)", () => {
    const keep = { ...VENUE_SPOTS.pairs };
    VENUE_SPOTS.pairs["GR-B1|GR-B2"] = 30;
    try {
      const e = proposeLayoutEdit(fri(), [op({ tables: [range(63, 64)], to: "Garden Room" })]);
      expect(rules(e)).toEqual(["R6"]);
      expect(texts(e)[0]).toBe("Joining tables 63 and 64 leaves 30 in of aisle (needs 36 in).");
    } finally {
      VENUE_SPOTS.pairs = keep;
    }
  });
  it("R7: more spare tables than storage holds tonight", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ op: "from_storage", seats: 2, count: 5, to: "Dining room" }),
    ]);
    expect(rules(e)).toContain("R7");
    expect(texts(e)[0]).toBe("Only 4 spare 2-tops in storage tonight, not 5.");
  });
  it("R9: rows that don't come out as asked", () => {
    const e = proposeLayoutEdit(fri(), [
      op({ tables: [range(63, 66)], to: "Garden Room" }),
      op({ op: "arrange_rows", to: "Garden Room", rows: [3, 6] }),
    ]);
    expect(texts(e)).toEqual(["The Garden Room would end with rows of 5 and 4, not 3 and 6."]);
  });
  it("R10: more than six operations, or the base layout", () => {
    const many = Array.from({ length: MAX_OPS + 1 }, () =>
      op({ tables: [n(57)], to: "Garden Room" }),
    );
    expect(rules(proposeLayoutEdit(fri(), many))).toEqual(["R10"]);
    expect(rules(proposeLayoutEdit(fri(), W9, { onBase: true }))).toEqual(["R10"]);
  });
});

describe("floor edits: determinism and the input floor", () => {
  it("same input → byte-identical output, and the input floor is never changed", () => {
    const room = fri();
    const snapshot = JSON.stringify(room);
    const a = JSON.stringify(proposeLayoutEdit(room, W9));
    const b = JSON.stringify(proposeLayoutEdit(room, W9));
    expect(a).toBe(b);
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});

describe("clearance by position", () => {
  it("an untouched floor uses today's values", () => {
    expect(clearanceForLayout(fri())).toBe(VENUE_CLEARANCE);
  });
  it("moved tables use the spot pair; untouched pairs keep today's ids", () => {
    const c = clearanceForLayout(proposeLayoutEdit(fri(), W9).edited as Room);
    expect(c?.joins["T63|T64"]).toBe(VENUE_SPOTS.pairs["GR-B1|GR-B2"]);
    expect(c?.joins["T57|T58"]).toBe(VENUE_CLEARANCE.joins["T57|T58"]);
  });
  it("a table on another table's vacated home inherits that table's pair values", () => {
    const room = fri();
    // 67 takes 64's place in the front row once 64 has gone to storage
    room.tables = room.tables
      .filter((t) => t.id !== "T64")
      .map((t) => (t.id === "T67" ? { ...t, x: 111, y: 18 } : t));
    room.joins = [
      ...room.joins.filter(([a, b]) => ![a, b].includes("T64") && ![a, b].includes("T67")),
      ["T63", "T67"],
      ["T67", "T65"],
    ];
    const c = clearanceForLayout(room);
    expect(c?.joins["T63|T67"]).toBe(VENUE_CLEARANCE.joins["T63|T64"]);
    expect(c?.joins["T67|T65"]).toBe(VENUE_CLEARANCE.joins["T64|T65"]);
  });
  it("a crew-plan layout plans exactly as today (tables slid along their rows)", () => {
    const room = fri();
    const variant = generateTonight(room, SERVICE.from, SERVICE.to).variant;
    const now = planBuilds(variant, SERVICE.from, SERVICE.to);
    const today = planBuilds(variant, SERVICE.from, SERVICE.to, { clearance: VENUE_CLEARANCE });
    expect(JSON.stringify(now)).toBe(JSON.stringify(today));
    expect(clearanceForLayout(variant)?.joins).toEqual(VENUE_CLEARANCE.joins);
  });
  it("an editor-edited layout (a table nudged) plans exactly as today", () => {
    const room = fri();
    room.tables = room.tables.map((t) => (t.id === "T58" ? { ...t, x: 110.5 } : t));
    const now = planBuilds(room, SERVICE.from, SERVICE.to);
    const today = planBuilds(room, SERVICE.from, SERVICE.to, { clearance: VENUE_CLEARANCE });
    expect(JSON.stringify(now)).toBe(JSON.stringify(today));
  });
});

describe("spots fixture", () => {
  it("every listed spot sits inside its room and clear of every table except the homes it replaces", () => {
    const room = fri();
    for (const s of VENUE_SPOTS.spots) {
      const a = room.areas.find((x) => x.name === s.room);
      expect(a, s.id).toBeTruthy();
      if (!a) continue;
      expect(
        s.x >= a.x && s.y >= a.y && s.x + s.w <= a.x + a.w && s.y + s.h <= a.y + a.h,
        s.id,
      ).toBe(true);
      const hits = room.tables
        .filter(
          (t) =>
            t.x - 0.99 < s.x + s.w &&
            s.x - 0.99 < t.x + t.w &&
            t.y - 0.99 < s.y + s.h &&
            s.y - 0.99 < t.y + t.h,
        )
        .map((t) => t.id);
      expect(hits, s.id).toEqual(s.id === "LIB-R1" ? ["T63", "T64"] : []);
    }
  });
  it("home positions match every night's fixture", () => {
    for (const t of fri().tables) {
      const h = VENUE_SPOTS.homes[t.id];
      expect(h).toEqual([t.area, t.x, t.y, t.w, t.h, t.shape]);
    }
    for (const t of peak().tables) expect(VENUE_SPOTS.homes[t.id]?.slice(1, 3)).toEqual([t.x, t.y]);
  });
  it("one spare spot per spare slot in each seating room; none in the station or bar", () => {
    for (const a of fri().areas) {
      const spare = VENUE_SPOTS.spots.filter((s) => s.room === a.name && s.spare).length;
      expect(spare, a.name).toBe(a.spareSlots);
    }
  });
});
