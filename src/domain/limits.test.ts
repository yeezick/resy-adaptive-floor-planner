// Guards against client-posted rooms that are oversized or dense enough to stall the planners.
import { describe, expect, it } from "vitest";
import { nextDay, rawDinnerPeak, res, room, table } from "./__fixtures__/build";
import { planBuilds } from "./buildplan";
import { candidateGroups, findTablesForParty, MAX_GROUPS } from "./capacity";
import { checkCombine } from "./combine";
import { neighbours, parseRoom } from "./room";
import { MAX_NEIGHBOURS, MAX_TABLES, type Room } from "./types";

type Raw = {
  id: string;
  name: string;
  tables: (Record<string, unknown> & { id: string })[];
  areas: Record<string, unknown>[];
  joins: [string, string][];
  combos?: string[][];
  reservations?: Record<string, unknown>[];
};

function mutate(fn: (r: Raw) => void): unknown {
  const raw = rawDinnerPeak() as Raw;
  fn(raw);
  return raw;
}

const long = (n: number) => "x".repeat(n);

describe("schema size limits", () => {
  it("labels are 1–48 characters", () => {
    expect(() => parseRoom(mutate((r) => (r.name = long(48))))).not.toThrow();
    expect(() => parseRoom(mutate((r) => (r.name = long(49))))).toThrow();
    expect(() => parseRoom(mutate((r) => (r.id = "")))).toThrow();
    expect(() =>
      parseRoom(
        mutate((r) => {
          const name = long(49);
          (r.areas[0] as { name: string }).name = name;
          for (const t of r.tables) if (t.area === "Dining room") t.area = name;
        }),
      ),
    ).toThrow();
  });

  it("table ids are T plus 1–4 digits", () => {
    const rename = (id: string) =>
      mutate((r) => {
        const t = r.tables.find((x) => x.id === "T1");
        if (t) t.id = id;
      });
    expect(() => parseRoom(rename("T9999"))).not.toThrow();
    expect(() => parseRoom(rename("T10000"))).toThrow();
    expect(() => parseRoom(rename("T"))).toThrow();
  });

  it(`rejects more than ${MAX_TABLES} tables`, () => {
    const withTables = (n: number) =>
      mutate((r) => {
        const t = r.tables[0] as Record<string, unknown>;
        r.tables = Array.from({ length: n }, (_, i) => ({ ...t, id: `T${i + 1}` }));
        r.joins = [];
        r.combos = [];
      });
    expect(() => parseRoom(withTables(MAX_TABLES))).not.toThrow();
    expect(() => parseRoom(withTables(MAX_TABLES + 1))).toThrow();
  });

  it(`rejects more than ${2 * MAX_TABLES} joins, 40 areas, 120 reservations, and combos over 6`, () => {
    expect(() =>
      parseRoom(
        mutate((r) => (r.joins = Array.from({ length: 2 * MAX_TABLES + 1 }, () => ["T4", "T5"]))),
      ),
    ).toThrow();
    expect(() =>
      parseRoom(
        mutate((r) => {
          const a = r.areas[0] as Record<string, unknown>;
          r.areas = [
            ...r.areas,
            ...Array.from({ length: 41 - r.areas.length }, (_, i) => ({
              ...a,
              id: `x${i}`,
              name: `X${i}`,
            })),
          ];
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRoom(
        mutate(
          (r) =>
            (r.reservations = Array.from({ length: 121 }, (_, i) => ({
              id: `R${i}`,
              time: "19:00",
              partySize: 2,
            }))),
        ),
      ),
    ).toThrow();
    expect(() =>
      parseRoom(
        mutate(
          (r) =>
            (r.reservations = Array.from({ length: 120 }, (_, i) => ({
              id: `R${i}`,
              time: "19:00",
              partySize: 2,
            }))),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      parseRoom(mutate((r) => (r.combos = [["T31", "T32", "T33", "T34", "T7", "T8", "T9"]]))),
    ).toThrow();
  });
});

describe("join degree", () => {
  it("rejects a self-join", () => {
    expect(() => parseRoom(mutate((r) => r.joins.push(["T4", "T4"])))).toThrow(
      /joins a table to itself/,
    );
  });

  it(`accepts ${MAX_NEIGHBOURS} neighbours and rejects ${MAX_NEIGHBOURS + 1}`, () => {
    // T4 already joins T5
    const add = (n: number) =>
      mutate((r) =>
        r.joins.push(
          ...["T41", "T44", "T49", "T55"].slice(0, n).map((x) => ["T4", x] as [string, string]),
        ),
      );
    expect(() => parseRoom(add(3))).not.toThrow();
    expect(() => parseRoom(add(4))).toThrow(
      new RegExp(`T4 has more than ${MAX_NEIGHBOURS} joinable neighbours`),
    );
  });

  it("counts both sides of a join toward the degree", () => {
    const raw = mutate((r) =>
      r.joins.push(["T41", "T4"], ["T44", "T4"], ["T49", "T4"], ["T55", "T4"]),
    );
    expect(() => parseRoom(raw)).toThrow(/T4 has more than/);
  });
});

/** N×N grid of joinable 2-tops, each joined right and down (degree ≤ 4). */
function grid(n: number, reservations = 0): Room {
  const id = (r: number, c: number) => `T${r * n + c + 1}`;
  const tables = [];
  const joins: [string, string][] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      tables.push(table(id(r, c), { seats: 2, x: c, y: r }));
      if (c + 1 < n) joins.push([id(r, c), id(r, c + 1)]);
      if (r + 1 < n) joins.push([id(r, c), id(r + 1, c)]);
    }
  const resv = Array.from({ length: reservations }, (_, i) => {
    const minutes = 17 * 60 + (i % 17) * 15;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return res(`R${i + 1}`, time, 7 + (i % 6));
  });
  return parseRoom(
    room({ tables, joins, inventory: { extenders: 6, spareChairs: 30 }, reservations: resv }),
  );
}

// Wall-clock budgets. Shared CI runners are ~3x slower than a laptop (planBuilds: ~1.0 s local, ~3.0 s CI),
// so CI gets 3x the budget. Still catches the regressions these guard (each was 4–30x slower).
const BUDGET_SCALE = process.env.CI ? 3 : 1;

describe("dense-room performance guards (14×14 grid of joinable 2-tops)", () => {
  const dense = grid(14, 40);

  it("is a legal room at the degree limit", () => {
    expect(dense.tables).toHaveLength(196);
    expect(Math.max(...dense.tables.map((t) => neighbours(dense, t.id).length))).toBe(
      MAX_NEIGHBOURS,
    );
  });

  it(`candidateGroups stops at MAX_GROUPS (${MAX_GROUPS}) and stays legal`, () => {
    const groups = candidateGroups(dense, 6);
    expect(groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    for (const g of groups.slice(-50))
      if (g.length > 1) expect(checkCombine(dense, g).ok).toBe(true);
  });

  it("findTablesForParty finishes in under 1 s", () => {
    const t0 = performance.now();
    const fit = findTablesForParty(dense, { partySize: 8 });
    expect(performance.now() - t0).toBeLessThan(1000 * BUDGET_SCALE);
    expect(fit.options.length).toBeGreaterThan(0);
    expect(fit.options[0]?.seats).toBe(8);
  });

  // Regression (fixed): diagnose() used to call buildUnits(room) again for every unplaced party (~0.1 s each here);
  // with 31 of 40 unplaced, planBuilds takes ~4.5 s (was ~0.6 s). Also only 9 of 40 are placed on a
  // 196-table floor because each party's pool is capped at 40 overlapping units.
  it("planBuilds with 40 large parties finishes in under 3 s and stays within storage", () => {
    const t0 = performance.now();
    const plan = planBuilds(dense, "17:00", "21:30");
    expect(performance.now() - t0).toBeLessThan(3000 * BUDGET_SCALE);
    expect(plan.builds.length + plan.unplaced.length).toBe(40);
    expect(plan.builds.length).toBeGreaterThan(0);
    expect(plan.totals.extenders).toBeLessThanOrEqual(6);
    expect(plan.totals.extraChairs).toBeLessThanOrEqual(30);
    // no table double-booked across overlapping builds
    const BUSY = 30 + 90;
    for (let i = 0; i < plan.builds.length; i++)
      for (let j = i + 1; j < plan.builds.length; j++) {
        const a = plan.builds[i];
        const b = plan.builds[j];
        if (!a || !b) continue;
        const gap = Math.abs(
          Number(a.time.slice(0, 2)) * 60 +
            Number(a.time.slice(3)) -
            (Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3))),
        );
        if (gap < BUSY) expect(a.tables.filter((t) => b.tables.includes(t))).toEqual([]);
      }
  }, 10_000);
});

describe("next-day regression after the caps", () => {
  it("still places all 11 large parties using 6 extenders and 30 chairs", () => {
    const plan = planBuilds(nextDay(), "17:00", "21:00");
    expect(plan.builds).toHaveLength(11);
    expect(plan.unplaced).toEqual([]);
    expect(plan.totals.extenders).toBe(6);
    expect(plan.totals.extraChairs).toBe(30);
  });
});
