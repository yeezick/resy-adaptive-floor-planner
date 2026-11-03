import { describe, expect, it } from "vitest";
import { chain, dinnerPeak, nextDay, room, table } from "./__fixtures__/build";
import {
  candidateGroups,
  findTablesForParty,
  MAX_OPTION_TABLES,
  meetsNeeds,
  TURN_MIN,
  WASTE_CAP,
  type FitResult,
} from "./capacity";
import { checkCombine, combinedSeats } from "./combine";
import { tableById } from "./room";
import { toMinutes } from "./time";
import type { Need, Room, Table } from "./types";

const NEEDS: Need[] = ["accessible", "stroller", "quiet", "view", "booth"];
const key = (o: { tables: string[] }) => o.tables.join("+");

/** Invariants every recommendation must satisfy, whatever the ranking. */
function assertSound(r: Room, res: FitResult): void {
  const now = toMinutes(r.clock);
  for (const o of res.options) {
    const found = o.tables.map((id) => tableById(r, id));
    expect(found.every(Boolean), `unknown table in ${key(o)}`).toBe(true);
    const ts = found as Table[];
    expect(new Set(o.tables).size).toBe(o.tables.length);
    expect(o.tables.length).toBeLessThanOrEqual(MAX_OPTION_TABLES);
    if (o.tables.length > 1) expect(checkCombine(r, o.tables).ok).toBe(true);
    // extra chairs: only what the tables allow and what storage holds
    expect(o.extraChairs).toBeGreaterThanOrEqual(0);
    expect(o.extraChairs).toBeLessThanOrEqual(ts.reduce((n, t) => n + t.maxExtraChairs, 0));
    expect(o.extraChairs).toBeLessThanOrEqual(r.inventory.spareChairs);
    expect(o.seats).toBe(combinedSeats(ts) + o.extraChairs);
    if (o.extraChairs > 0) {
      expect(o.seats).toBe(res.partySize); // never squeeze in more chairs than needed
      expect(o.tradeoffs).toContain(`tight: add ${o.extraChairs} chair(s) from storage`);
    }
    expect(o.seats).toBeGreaterThanOrEqual(res.partySize);
    expect(o.waste).toBe(o.seats - res.partySize);
    expect(ts.some((t) => t.status === "blocked")).toBe(false);
    for (const t of ts) {
      if (t.status === "reserved" && t.reservedAt)
        expect(toMinutes(t.reservedAt) - now).toBeGreaterThanOrEqual(o.waitMin + TURN_MIN);
    }
    expect(meetsNeeds(ts, res.needs)).toBe(true);
    expect(o.needsMet).toEqual(res.needs);
    expect(new Set(ts.map((t) => t.area)).size).toBe(1);
    expect(o.area).toBe(ts[0]?.area);
  }
  for (let i = 1; i < res.options.length; i++)
    expect(res.options[i]?.score).toBeGreaterThanOrEqual(res.options[i - 1]?.score as number);
}

describe("meetsNeeds", () => {
  const plain = table("T1");
  const acc = table("T2", { attrs: { accessible: true, quiet: true } });
  const extras = table("T3", { attrs: { view: true, strollerSpace: true } });
  const booth = table("T4", { shape: "booth", joinable: false });

  it("no needs → always met", () => {
    expect(meetsNeeds([plain], [])).toBe(true);
  });

  it("accessible and quiet need every table", () => {
    expect(meetsNeeds([acc], ["accessible", "quiet"])).toBe(true);
    expect(meetsNeeds([acc, plain], ["accessible"])).toBe(false);
    expect(meetsNeeds([acc, plain], ["quiet"])).toBe(false);
  });

  it("view and stroller need any table", () => {
    expect(meetsNeeds([plain, extras], ["view", "stroller"])).toBe(true);
    expect(meetsNeeds([plain, acc], ["view"])).toBe(false);
    expect(meetsNeeds([plain, acc], ["stroller"])).toBe(false);
  });

  it("booth needs exactly one booth", () => {
    expect(meetsNeeds([booth], ["booth"])).toBe(true);
    expect(meetsNeeds([booth, plain], ["booth"])).toBe(false);
    expect(meetsNeeds([plain], ["booth"])).toBe(false);
    expect(meetsNeeds([], ["booth"])).toBe(false);
  });
});

describe("candidateGroups", () => {
  it("includes every non-blocked single and only legal joinable groups up to the limit", () => {
    const r = dinnerPeak();
    const groups = candidateGroups(r);
    const keys = new Set(groups.map((g) => g.join("+")));
    expect(keys.size).toBe(groups.length);
    for (const t of r.tables) expect(keys.has(t.id)).toBe(t.status !== "blocked");
    for (const g of groups) {
      expect(g.length).toBeLessThanOrEqual(MAX_OPTION_TABLES);
      if (g.length > 1) expect(checkCombine(r, g).ok).toBe(true);
    }
    expect(keys.has("T7+T8+T9+T10")).toBe(true);
    // blocked private rooms (Garden Room, Cellar, Loft, Gallery) never appear
    for (const id of ["T57", "T71", "T77", "T92"])
      expect(groups.some((g) => g.includes(id))).toBe(false);
    // the 5-table run in the Atrium is beyond the default limit
    expect(keys.has("T82+T83+T84+T85+T86")).toBe(false);
  });

  it("maxTables widens or narrows the search", () => {
    const r = nextDay();
    expect(candidateGroups(r, 1).every((g) => g.length === 1)).toBe(true);
    const six = new Set(candidateGroups(r, 6).map((g) => g.join("+")));
    expect(six.has("T57+T58+T59+T60+T61")).toBe(true);
    expect(six.has("T82+T83+T84+T85+T86")).toBe(true);
    // runs in one room that are not joined stay separate
    expect([...six].some((k) => k.includes("T66") && k.includes("T67"))).toBe(false);
    // non-joinable tables (diamonds, rounds, booths, long rects) stay single
    for (const g of candidateGroups(r, 6))
      if (g.length > 1) for (const id of g) expect(tableById(r, id)?.joinable).toBe(true);
  });
});

describe("findTablesForParty on dinner-peak", () => {
  const r = dinnerPeak();

  it("is sound for every party size and need", () => {
    for (let size = 1; size <= 14; size++) {
      assertSound(r, findTablesForParty(r, { partySize: size, maxOptions: 500 }));
      for (const need of NEEDS)
        assertSound(r, findTablesForParty(r, { partySize: size, needs: [need], maxOptions: 500 }));
    }
  });

  it("party of 8: the T41 round first (11 min, section 7 slammed), then deuces T7–T10 at 20 min", () => {
    const res = findTablesForParty(r, { partySize: 8 });
    const [first, second] = res.options;
    expect(first).toMatchObject({ tables: ["T41"], seats: 8, extraChairs: 0, waitMin: 11 });
    expect(first?.sections).toEqual([7]);
    expect(first?.tradeoffs).toContain("section 7 is already slammed");
    expect(second).toMatchObject({ tables: ["T7", "T8", "T9", "T10"], seats: 8, waitMin: 20 });
    expect(second?.freeAt).toBe("19:30");
    expect(second?.reasons[1]?.match(/dessert/g)).toHaveLength(3);
    expect(second?.tradeoffs).toContain("needs a build: combine tables 7–10");
    expect(res.note).toBeUndefined();
  });

  it("party of 12: only the Library run T63–T66, after its seated event (45 min), with 2 chairs", () => {
    const res = findTablesForParty(r, { partySize: 12, maxOptions: 10 });
    expect(res.options).toHaveLength(1);
    expect(res.options[0]).toMatchObject({
      tables: ["T63", "T64", "T65", "T66"],
      area: "Library",
      waitMin: 45,
      seats: 12,
      extraChairs: 2,
    });
  });

  it("party of 40: nothing fits", () => {
    expect(findTablesForParty(r, { partySize: 40 }).note).toMatch(/no table/);
  });

  it("party of 11 needs a chair squeezed in from storage", () => {
    const res = findTablesForParty(r, { partySize: 11, maxOptions: 10 });
    expect(res.options.length).toBeGreaterThan(0);
    for (const o of res.options) expect(o.extraChairs).toBeGreaterThan(0);
    expect(res.options[0]?.reasons[0]).toBe("11 seats for 11");
  });

  it("party of 2: free open tables first", () => {
    const res = findTablesForParty(r, { partySize: 2 });
    expect(res.options[0]?.waitMin).toBe(0);
    expect(res.options[0]?.reasons).toContain("free now");
  });

  it("never offers held tables and explains single-table exclusions", () => {
    const res = findTablesForParty(r, { partySize: 2, maxOptions: 1000 });
    const offered = new Set(res.options.flatMap((o) => o.tables));
    expect(offered.has("T37")).toBe(false); // held 19:30
    for (let n = 81; n <= 90; n++) expect(offered.has(`T${n}`)).toBe(false); // Atrium held 20:15
    expect(res.excluded).toContainEqual({
      tables: ["T37"],
      reason: "held for a 19:30 reservation",
    });
    expect(res.excluded).toContainEqual({
      tables: ["T82"],
      reason: "held for a 20:15 reservation",
    });
  });

  it("never offers the blocked Garden Room, Cellar, Loft or Gallery", () => {
    const closed = ["Garden Room", "Cellar", "Loft", "Gallery"];
    for (const t of r.tables.filter((x) => closed.includes(x.area)))
      expect(t.status, t.id).toBe("blocked");
    const res = findTablesForParty(r, { partySize: 4, maxOptions: 1000 });
    expect(res.options.some((o) => closed.includes(o.area))).toBe(false);
  });

  it("the Library (seated event, entrees) is offered only with its wait", () => {
    const res = findTablesForParty(r, { partySize: 8, maxOptions: 1000 });
    const library = res.options.filter((x) => x.area === "Library");
    expect(library.length).toBeGreaterThan(0);
    for (const o of library) expect(o.waitMin).toBe(45);
  });

  it("booth need → only single booths T1–T3", () => {
    const res = findTablesForParty(r, { partySize: 4, needs: ["booth"], maxOptions: 10 });
    expect(res.options.map((o) => [o.tables[0], o.waitMin])).toEqual([
      ["T1", 20],
      ["T2", 45],
      ["T3", 90],
    ]);
    expect(res.options[0]?.reasons).toContain("meets: booth");
  });

  it("booth for 9 → no options with a note", () => {
    const res = findTablesForParty(r, { partySize: 9, needs: ["booth"] });
    expect(res.options).toEqual([]);
    expect(res.note).toMatch(/no table or legal combination/);
  });

  it("view and stroller need only one table in the group; quiet/accessible need all", () => {
    const stroller = findTablesForParty(r, { partySize: 6, needs: ["stroller"], maxOptions: 500 });
    expect(stroller.options.map(key)).toContain("T11+T12"); // only T12 has stroller space
    const quiet = findTablesForParty(r, { partySize: 6, needs: ["quiet"], maxOptions: 500 });
    expect(quiet.options.map(key)).toContain("T27+T28");
    expect(quiet.options.some((o) => o.tables.includes("T42"))).toBe(false);
    const both = findTablesForParty(r, {
      partySize: 6,
      needs: ["accessible", "quiet"],
      maxOptions: 5,
    });
    expect(both.needs).toEqual(["accessible", "quiet"]);
    expect(both.options[0]?.reasons).toContain("meets: accessible, quiet");
  });

  it("honours maxOptions (default 3)", () => {
    expect(findTablesForParty(r, { partySize: 2 }).options).toHaveLength(3);
    expect(findTablesForParty(r, { partySize: 2, maxOptions: 1 }).options).toHaveLength(1);
    expect(findTablesForParty(r, { partySize: 2, maxOptions: 0 }).options).toHaveLength(0);
  });

  it("is deterministic and does not mutate the room", () => {
    const snapshot = structuredClone(r);
    const a = findTablesForParty(r, { partySize: 6, maxOptions: 20 });
    expect(findTablesForParty(r, { partySize: 6, maxOptions: 20 })).toEqual(a);
    expect(r).toEqual(snapshot);
    expect(a.clock).toBe("19:10");
  });

  it("flags slammed sections", () => {
    const res = findTablesForParty(r, { partySize: 4, maxOptions: 1000 });
    const slammed = res.options.find((o) => o.sectionLoad >= 2);
    expect(slammed?.tradeoffs.join(" ")).toMatch(/already slammed/);
  });
});

describe("findTablesForParty extra chairs (hand-built)", () => {
  it("squeezes chairs only up to the tables' maxExtraChairs", () => {
    const r = room({ tables: [table("T1", { maxExtraChairs: 2, joinable: false })] });
    const five = findTablesForParty(r, { partySize: 5 });
    expect(five.options[0]).toMatchObject({ seats: 5, extraChairs: 1, waste: 0 });
    expect(five.options[0]?.tradeoffs).toContain("tight: add 1 chair(s) from storage");
    expect(findTablesForParty(r, { partySize: 6 }).options[0]?.extraChairs).toBe(2);
    expect(findTablesForParty(r, { partySize: 7 }).options).toEqual([]);
  });

  it("sums maxExtraChairs across a joined group", () => {
    const r = room({
      tables: [table("T1", { maxExtraChairs: 1 }), table("T2", { maxExtraChairs: 1 })],
      joins: chain("T1", "T2"),
    });
    expect(findTablesForParty(r, { partySize: 8 }).options[0]).toMatchObject({
      tables: ["T1", "T2"],
      seats: 8,
      extraChairs: 2,
    });
    expect(findTablesForParty(r, { partySize: 9 }).options).toEqual([]);
  });

  it("is limited by spare chairs in storage", () => {
    const tables = [table("T1", { maxExtraChairs: 2, joinable: false })];
    expect(
      findTablesForParty(room({ tables, inventory: { spareChairs: 1 } }), { partySize: 6 }).options,
    ).toEqual([]);
    expect(
      findTablesForParty(room({ tables, inventory: { spareChairs: 0 } }), { partySize: 5 }).options,
    ).toEqual([]);
  });

  it("tables that cannot take extra chairs never get them", () => {
    const r = room({ tables: [table("T1", { shape: "booth", joinable: false })] });
    expect(findTablesForParty(r, { partySize: 5 }).options).toEqual([]);
  });

  it("prefers a table that fits over squeezing chairs at the same wait", () => {
    const r = room({
      tables: [
        table("T1", { maxExtraChairs: 1, joinable: false }),
        table("T2", { seats: 6, joinable: false }),
      ],
    });
    const res = findTablesForParty(r, { partySize: 5 });
    expect(res.options.map(key)).toEqual(["T2", "T1"]);
  });
});

describe("findTablesForParty on hand-built rooms", () => {
  it("relaxes the waste cap only when nothing tighter fits, with a note", () => {
    const r = room({ tables: [table("T1", { seats: 10, joinable: false })] });
    const res = findTablesForParty(r, { partySize: 2 });
    expect(res.options).toHaveLength(1);
    expect(res.options[0]?.waste).toBe(8);
    expect(res.options[0]?.tradeoffs).toContain("8 empty seats");
    expect(res.note).toBe(`every option wastes more than ${WASTE_CAP} seats`);
  });

  it("prefers within-cap options over a quicker wasteful one", () => {
    const r = room({
      tables: [
        table("T1", { seats: 10, joinable: false }),
        table("T2", { seats: 2, joinable: false, status: "occupied", phase: "dessert" }),
      ],
    });
    const res = findTablesForParty(r, { partySize: 2, maxOptions: 5 });
    expect(res.options.map((o) => o.tables)).toEqual([["T2"]]);
    expect(res.note).toBeUndefined();
  });

  it("allows a reserved table whose hold is far enough away", () => {
    const r = room({
      clock: "17:00",
      tables: [table("T1", { status: "reserved", reservedAt: "21:00" })],
    });
    const res = findTablesForParty(r, { partySize: 4 });
    expect(res.options[0]?.tables).toEqual(["T1"]);
    expect(res.excluded).toEqual([]);
  });

  it("a hold exactly one turn away is allowed; one minute less is not", () => {
    const at = (clock: string) =>
      findTablesForParty(
        room({ clock, tables: [table("T1", { status: "reserved", reservedAt: "20:30" })] }),
        { partySize: 2 },
      ).options.length;
    expect(at("19:00")).toBe(1); // 90 min = TURN_MIN
    expect(at("19:01")).toBe(0);
  });

  it("drops a group touching a held table; only single tables are listed as excluded", () => {
    const r = room({
      tables: [table("T1"), table("T2", { status: "reserved", reservedAt: "19:15" })],
      joins: chain("T1", "T2"),
    });
    const six = findTablesForParty(r, { partySize: 6 });
    expect(six.options).toEqual([]);
    expect(six.excluded).toEqual([]);
    const four = findTablesForParty(r, { partySize: 4, maxOptions: 10 });
    expect(four.options.map((o) => o.tables)).toEqual([["T1"]]);
    expect(four.excluded).toEqual([{ tables: ["T2"], reason: "held for a 19:15 reservation" }]);
  });

  it("group wait is the slowest member and the reason lists each basis", () => {
    const r = room({
      tables: [
        table("T1", { status: "occupied", phase: "entrees" }),
        table("T2", { status: "occupied", phase: "check" }),
      ],
      joins: chain("T1", "T2"),
    });
    const res = findTablesForParty(r, { partySize: 6 });
    expect(res.options[0]?.waitMin).toBe(45);
    expect(res.options[0]?.freeAt).toBe("19:45");
    expect(res.options[0]?.reasons[1]).toMatch(/entrees.*; check/);
  });

  it("ties break by table ids", () => {
    const r = room({ tables: [table("T2"), table("T1")] });
    const res = findTablesForParty(r, { partySize: 4 });
    expect(res.options.map((o) => o.tables[0])).toEqual(["T1", "T2"]);
  });

  it("freeAt wraps past midnight", () => {
    const r = room({
      clock: "23:50",
      tables: [table("T1", { status: "occupied", phase: "dessert" })],
    });
    expect(findTablesForParty(r, { partySize: 2 }).options[0]?.freeAt).toBe("00:10");
  });
});
