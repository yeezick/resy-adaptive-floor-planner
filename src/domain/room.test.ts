import { describe, expect, it } from "vitest";
import { area, dinnerPeak, nextDay, rawDinnerPeak, room, table } from "./__fixtures__/build";
import { adjacentRooms, areaByName, neighbours, parseRoom, tableById } from "./room";
import { MAX_NEIGHBOURS, MAX_TABLES } from "./types";

type RawTable = Record<string, unknown> & { id: string };
type RawArea = Record<string, unknown>;
type RawRoom = {
  tables: RawTable[];
  areas: RawArea[];
  joins: [string, string][];
  combos?: string[][];
  inventory: Record<string, unknown>;
};

function mutate(fn: (r: RawRoom) => void): unknown {
  const raw = rawDinnerPeak() as RawRoom;
  fn(raw);
  return raw;
}

function rawTable(r: RawRoom, id: string): RawTable {
  const t = r.tables.find((x) => x.id === id);
  if (!t) throw new Error(`fixture lost ${id}`);
  return t;
}

describe("parseRoom", () => {
  it("accepts both fixtures (full-scale room)", () => {
    expect(dinnerPeak().tables).toHaveLength(95);
    expect(dinnerPeak().tables.reduce((n, t) => n + t.seats, 0)).toBe(376);
    expect(nextDay().tables).toHaveLength(95);
    expect(nextDay().reservations.length).toBeGreaterThan(0);
  });

  it("defaults combos, reservations, maxExtraChairs, area kind/spareSlots and spareTables", () => {
    const raw = mutate((r) => {
      delete r.combos;
      delete (r as { reservations?: unknown }).reservations;
      delete rawTable(r, "T1").maxExtraChairs;
      delete r.areas[0]?.kind;
      delete r.areas[0]?.spareSlots;
      delete r.inventory.spareTables;
    });
    const parsed = parseRoom(raw);
    expect(parsed.combos).toEqual([]);
    expect(parsed.reservations).toEqual([]);
    expect(parsed.tables[0]?.maxExtraChairs).toBe(0);
    expect(parsed.areas[0]).toMatchObject({ kind: "dining", spareSlots: 0 });
    expect(parsed.inventory.spareTables).toEqual([]);
  });

  it("rejects a table in an area that does not exist", () => {
    const raw = mutate((r) => {
      rawTable(r, "T7").area = "Basement";
    });
    expect(() => parseRoom(raw)).toThrow(/T7 is in unknown area Basement/);
  });

  it("rejects duplicate table ids", () => {
    const raw = mutate((r) => {
      rawTable(r, "T2").id = "T1";
    });
    expect(() => parseRoom(raw)).toThrow(/duplicate table id T1/);
  });

  it("rejects an occupied table without a phase", () => {
    const raw = mutate((r) => {
      delete rawTable(r, "T1").phase;
    });
    expect(() => parseRoom(raw)).toThrow(/T1 is occupied but has no phase/);
  });

  it("rejects a reserved table without a time", () => {
    const raw = mutate((r) => {
      delete rawTable(r, "T37").reservedAt;
    });
    expect(() => parseRoom(raw)).toThrow(/T37 is reserved but has no time/);
  });

  it("rejects joins naming an unknown table on either side", () => {
    expect(() => parseRoom(mutate((r) => r.joins.push(["T1", "T999"])))).toThrow(
      /join T1-T999 names an unknown table/,
    );
    expect(() => parseRoom(mutate((r) => r.joins.push(["T999", "T1"])))).toThrow(
      /join T999-T1 names an unknown table/,
    );
  });

  it("rejects a table joined to itself", () => {
    expect(() => parseRoom(mutate((r) => r.joins.push(["T1", "T1"])))).toThrow(
      /join T1-T1 joins a table to itself/,
    );
  });

  it(`rejects a table with more than MAX_NEIGHBOURS (${MAX_NEIGHBOURS}) joins`, () => {
    // T8 already joins T7 and T9
    const ok = mutate((r) => r.joins.push(["T8", "T41"], ["T8", "T44"]));
    expect(() => parseRoom(ok)).not.toThrow();
    const tooMany = mutate((r) => r.joins.push(["T8", "T41"], ["T8", "T44"], ["T8", "T49"]));
    expect(() => parseRoom(tooMany)).toThrow(
      new RegExp(`T8 has more than ${MAX_NEIGHBOURS} joinable neighbours`),
    );
  });

  it(`rejects more than MAX_TABLES (${MAX_TABLES}) tables and empty labels`, () => {
    const big = mutate((r) => {
      const t = rawTable(r, "T1");
      r.tables = Array.from({ length: MAX_TABLES + 1 }, (_, i) => ({ ...t, id: `T${i + 1}` }));
      r.joins = [];
    });
    expect(() => parseRoom(big)).toThrow();
    expect(() =>
      parseRoom(mutate((r) => ((r as unknown as { name: string }).name = ""))),
    ).toThrow();
  });

  it("rejects combos naming an unknown table", () => {
    expect(() => parseRoom(mutate((r) => (r.combos = [["T4", "T999"]])))).toThrow(
      /combo names unknown table T999/,
    );
  });

  it("rejects a table in two combos", () => {
    const raw = mutate((r) => {
      r.combos = [
        ["T7", "T8"],
        ["T8", "T9"],
      ];
    });
    expect(() => parseRoom(raw)).toThrow(/table T8 is in two combos/);
  });

  it("accepts disjoint combos", () => {
    const parsed = parseRoom(
      mutate((r) => {
        r.combos = [
          ["T4", "T5"],
          ["T7", "T8"],
        ];
      }),
    );
    expect(parsed.combos).toHaveLength(2);
  });

  it("rejects schema violations", () => {
    expect(() => parseRoom(mutate((r) => (rawTable(r, "T37").reservedAt = "24:00")))).toThrow();
    expect(() => parseRoom(mutate((r) => (rawTable(r, "T5").id = "table5")))).toThrow();
    expect(() => parseRoom(mutate((r) => (rawTable(r, "T5").colour = "red")))).toThrow();
    expect(() => parseRoom(mutate((r) => (rawTable(r, "T5").maxExtraChairs = 3)))).toThrow();
    expect(() => parseRoom(mutate((r) => (rawTable(r, "T5").shape = "hexagon")))).toThrow();
    expect(() => parseRoom(mutate((r) => ((r.areas[0] as RawArea).kind = "attic")))).toThrow();
    expect(() => parseRoom(mutate((r) => (r.tables = [])))).toThrow();
  });

  it("accepts the diamond shape", () => {
    expect(dinnerPeak().tables.find((t) => t.id === "T6")?.shape).toBe("diamond");
  });
});

describe("tableById / neighbours", () => {
  const r = dinnerPeak();

  it("finds tables by id and returns undefined for unknown ids", () => {
    expect(tableById(r, "T7")?.seats).toBe(2);
    expect(tableById(r, "T999")).toBeUndefined();
  });

  it("lists neighbours from both sides of a join", () => {
    expect(neighbours(r, "T8").sort()).toEqual(["T7", "T9"]);
    expect(neighbours(r, "T4")).toEqual(["T5"]);
    expect(neighbours(r, "T5")).toEqual(["T4"]);
    expect(neighbours(r, "T1")).toEqual([]);
  });
});

describe("areaByName / adjacentRooms", () => {
  const r = dinnerPeak();

  it("looks up areas by name", () => {
    expect(areaByName(r, "Garden Room")).toMatchObject({
      suite: "East",
      order: 0,
      kind: "private",
    });
    expect(areaByName(r, "Nowhere")).toBeUndefined();
  });

  it("is true only for consecutive rooms of one suite, in either direction", () => {
    expect(adjacentRooms(r, "Garden Room", "Library")).toBe(true);
    expect(adjacentRooms(r, "Library", "Garden Room")).toBe(true);
    expect(adjacentRooms(r, "Library", "Cellar")).toBe(true);
    expect(adjacentRooms(r, "Garden Room", "Cellar")).toBe(false);
    expect(adjacentRooms(r, "Garden Room", "Garden Room")).toBe(false);
    // Cellar (East, order 2) and Loft (West, order 0); Library (East 1) and Atrium (West 1)
    expect(adjacentRooms(r, "Cellar", "Loft")).toBe(false);
    expect(adjacentRooms(r, "Library", "Atrium")).toBe(false);
    expect(adjacentRooms(r, "Loft", "Atrium")).toBe(true);
    expect(adjacentRooms(r, "Dining room", "Terrace")).toBe(false);
    expect(adjacentRooms(r, "Garden Room", "Nowhere")).toBe(false);
    expect(adjacentRooms(r, "Nowhere", "Garden Room")).toBe(false);
  });

  it("needs an order on both rooms", () => {
    const h = room({
      tables: [table("T1")],
      areas: [
        area("P1", { suite: "S", order: 0 }),
        area("P2", { suite: "S" }),
        area("P3", { suite: "T", order: 1 }),
      ],
    });
    expect(adjacentRooms(h, "P1", "P2")).toBe(false);
    expect(adjacentRooms(h, "P2", "P1")).toBe(false);
    expect(adjacentRooms(h, "P1", "P3")).toBe(false);
  });
});
