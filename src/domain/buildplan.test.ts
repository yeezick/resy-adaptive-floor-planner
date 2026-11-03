import { describe, expect, it } from "vitest";
import {
  area,
  chain,
  dinnerPeak,
  ids,
  nextDay,
  res,
  room,
  table,
  type TableOver,
} from "./__fixtures__/build";
import {
  BUILD_LEAD_MIN,
  buildUnits,
  checkTableSet,
  LARGE_PARTY,
  MAX_EXTENDERS_PER_ROW,
  MAX_ROWS,
  planBuilds,
  type Build,
  type BuildPlan,
} from "./buildplan";
import { meetsNeeds, TURN_MIN } from "./capacity";
import { checkCombine, combinedSeats, SEATS_PER_EXTENDER } from "./combine";
import { areaByName, tableById } from "./room";
import { toMinutes } from "./time";
import type { Area, Reservation, Room, Table } from "./types";

const tablesOf = (r: Room, list: readonly string[]) => list.map((id) => tableById(r, id) as Table);
const sortRows = (rows: string[][]) =>
  rows.map((row) => [...row].sort()).sort((a, b) => (a[0] as string).localeCompare(b[0] as string));

/** Invariants every plan must satisfy. */
function assertSound(r: Room, plan: BuildPlan): void {
  const byId = new Map(r.reservations.map((x) => [x.id, x]));
  for (const b of plan.builds) {
    const resv = byId.get(b.reservationId) as Reservation;
    expect(resv, b.reservationId).toBeDefined();
    expect(b.tables).toEqual(b.rows.flat());
    const found = b.tables.map((id) => tableById(r, id));
    expect(found.every(Boolean)).toBe(true);
    const tables = found as Table[];
    expect(tables.some((t) => t.status === "blocked")).toBe(false);
    // physically settable: one long table, or ≤ MAX_ROWS rows in neighbouring suite rooms
    const set = checkTableSet(r, b.tables);
    expect(set.ok, `${b.reservationId}: ${set.ok ? "" : set.reason}`).toBe(true);
    if (set.ok) expect(sortRows(set.rows)).toEqual(sortRows(b.rows));
    expect(b.rows.length).toBeLessThanOrEqual(MAX_ROWS);
    for (const row of b.rows) if (row.length > 1) expect(checkCombine(r, row).ok).toBe(true);
    const areas = [...new Set(tables.map((t) => t.area))];
    expect(b.area).toBe(areas.join(" + "));
    expect(b.dividersOpened).toHaveLength(areas.length - 1);
    // seats and storage
    const base = b.rows.reduce((n, row) => n + combinedSeats(tablesOf(r, row)), 0);
    expect(b.seats).toBe(base + b.extraChairs);
    expect(b.seats).toBeGreaterThanOrEqual(b.partySize);
    const extendable = b.rows.filter((row) => tablesOf(r, row).every((t) => t.joinable)).length;
    expect(b.extenders).toBeLessThanOrEqual(MAX_EXTENDERS_PER_ROW * extendable);
    if (!extendable) expect(b.spareTables).toBe(0);
    const headerChairs = b.extraChairs - b.extenders * SEATS_PER_EXTENDER - b.spareTables * 2;
    expect(headerChairs).toBeGreaterThanOrEqual(0);
    expect(headerChairs).toBeLessThanOrEqual(tables.reduce((n, t) => n + t.maxExtraChairs, 0));
    const slots = areas.reduce((n, a) => n + (areaByName(r, a)?.spareSlots ?? 0), 0);
    expect(b.spareTables).toBeLessThanOrEqual(slots);
    // reservation contract
    expect(b.partySize).toBe(resv.partySize);
    expect(b.time).toBe(resv.time);
    expect(toMinutes(b.time) - toMinutes(b.buildBy)).toBe(BUILD_LEAD_MIN);
    if (resv.area) expect(areas).toContain(resv.area);
    expect(meetsNeeds(tables, resv.needs)).toBe(true);
    expect(b.steps.at(-1)).toMatch(new RegExp(`^Set for ${b.partySize} by ${b.buildBy}`));
  }
  // no table in two overlapping builds (build lead through turn end)
  for (let i = 0; i < plan.builds.length; i++)
    for (let j = i + 1; j < plan.builds.length; j++) {
      const a = plan.builds[i] as Build;
      const b = plan.builds[j] as Build;
      const shared = a.tables.filter((t) => b.tables.includes(t));
      if (!shared.length) continue;
      const overlap =
        toMinutes(a.time) - BUILD_LEAD_MIN < toMinutes(b.time) + TURN_MIN &&
        toMinutes(b.time) - BUILD_LEAD_MIN < toMinutes(a.time) + TURN_MIN;
      expect(overlap, `${a.reservationId}/${b.reservationId} share ${shared.join()}`).toBe(false);
    }
  // totals and inventory
  const sum = (f: (b: Build) => number) => plan.builds.reduce((n, b) => n + f(b), 0);
  expect(plan.totals).toEqual({
    extenders: sum((b) => b.extenders),
    extraChairs: sum((b) => b.extraChairs),
    spareTables: sum((b) => b.spareTables),
    tablesUsed: sum((b) => b.tables.length),
  });
  expect(plan.totals.extenders).toBeLessThanOrEqual(r.inventory.extenders);
  expect(plan.totals.extraChairs).toBeLessThanOrEqual(r.inventory.spareChairs);
  const spare4 = r.inventory.spareTables
    .filter((t) => t.seats >= 4)
    .reduce((n, t) => n + t.count, 0);
  expect(plan.totals.spareTables).toBeLessThanOrEqual(spare4);
  for (const u of plan.unplaced) expect(u.reason).toContain(String(u.partySize));
  expect(plan.shortfalls.length > 0).toBe(plan.unplaced.length > 0);
}

/** Private rooms P1..Pn in one suite, each holding one joinable row of `rowLen` 4-tops. */
function suite(
  n: number,
  rowLen: number,
  opts: {
    areaOver?: (i: number) => Partial<Area>;
    tableOver?: TableOver;
    inventory?: Partial<Room["inventory"]>;
    reservations?: Reservation[];
  } = {},
): Room {
  const areas: Area[] = [];
  const tables: Table[] = [];
  const joins: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    const name = `P${i + 1}`;
    areas.push(area(name, { kind: "private", suite: "S", order: i, ...opts.areaOver?.(i) }));
    const row = ids(i * rowLen + 1, (i + 1) * rowLen);
    for (const id of row) tables.push(table(id, { area: name, ...opts.tableOver }));
    joins.push(...chain(...row));
  }
  return room({
    areas,
    tables,
    joins,
    inventory: { extenders: 0, spareChairs: 0, ...opts.inventory },
    reservations: opts.reservations ?? [],
  });
}

describe("planBuilds on next-day 17:00–21:00", () => {
  const r = nextDay();
  const plan = planBuilds(r, "17:00", "21:00");
  const build = (id: string) => plan.builds.find((b) => b.reservationId === id);

  it("is sound", () => {
    assertSound(r, plan);
  });

  it("places every large party and ignores parties under 7", () => {
    const large = r.reservations
      .filter((x) => x.partySize >= LARGE_PARTY && x.time >= "17:00" && x.time <= "21:00")
      .map((x) => x.id);
    expect(plan.unplaced).toEqual([]);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.builds.map((b) => b.reservationId).sort()).toEqual([...large].sort());
    for (const small of r.reservations.filter((x) => x.partySize < LARGE_PARTY))
      expect(build(small.id)).toBeUndefined();
  });

  it("seats the 32-top R7 across Garden Room + Library with the divider open", () => {
    const r7 = build("R7");
    expect(r7?.area).toBe("Garden Room + Library");
    expect(r7?.rows).toHaveLength(2);
    expect(r7?.dividersOpened).toEqual(["Garden Room | Library"]);
    expect(r7?.steps[0]).toBe("Open the divider Garden Room | Library");
    expect(r7?.seats).toBe(32);
  });

  it("keeps R5 in its requested room", () => {
    const r5 = r.reservations.find((x) => x.id === "R5");
    expect(build("R5")?.area).toBe(r5?.area);
  });

  it("uses all 6 extenders and all 30 spare chairs, and no more", () => {
    expect(plan.totals.extenders).toBe(6);
    expect(plan.totals.extraChairs).toBe(30);
  });

  it("orders builds by time", () => {
    const times = plan.builds.map((b) => toMinutes(b.time));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("returns the window and does not mutate the room", () => {
    expect(plan.window).toEqual({ from: "17:00", to: "21:00" });
    expect(r).toEqual(nextDay());
  });

  it("is deterministic", () => {
    expect(planBuilds(nextDay(), "17:00", "21:00")).toEqual(plan);
  });

  // Regression: an earlier plan seated a second party in a private room another party had opened into.
  it("a private room hosts one party at a time", () => {
    for (const x of plan.builds) {
      for (const y of plan.builds) {
        if (x === y) continue;
        const overlap =
          toMinutes(x.buildBy) < toMinutes(y.time) + TURN_MIN &&
          toMinutes(y.buildBy) < toMinutes(x.time) + TURN_MIN;
        if (!overlap) continue;
        const rooms = (b: typeof x) =>
          b.area.split(" + ").filter((a) => areaByName(r, a)?.kind === "private");
        expect(rooms(x).filter((a) => rooms(y).includes(a))).toEqual([]);
      }
    }
  });
});

describe("planBuilds on dinner-peak", () => {
  it("never builds on blocked rooms", () => {
    const r = dinnerPeak();
    const withParties = {
      ...r,
      reservations: [res("X1", "21:00", 20), res("X2", "21:30", 10, { area: "Garden Room" })],
    };
    const plan = planBuilds(withParties, "20:00", "22:00");
    assertSound(withParties, plan);
    expect(plan.unplaced.map((u) => u.reservationId)).toContain("X2");
  });
});

describe("planBuilds window filtering", () => {
  const r = nextDay();
  const seen = (p: BuildPlan) => [...p.builds, ...p.unplaced].map((x) => x.reservationId).sort();

  it("includes reservations on the window edges", () => {
    expect(seen(planBuilds(r, "18:00", "18:00"))).toEqual(["R4", "R5"]);
    expect(seen(planBuilds(r, "18:01", "18:29"))).toEqual(["R6"]);
    expect(seen(planBuilds(r, "21:00", "23:00"))).toEqual([]);
  });

  it("an empty window yields an empty plan", () => {
    expect(planBuilds(r, "10:00", "11:00")).toEqual({
      window: { from: "10:00", to: "11:00" },
      builds: [],
      totals: { extenders: 0, extraChairs: 0, spareTables: 0, tablesUsed: 0 },
      shortfalls: [],
      unplaced: [],
    });
  });
});

describe("planBuilds multi-row builds across suite rooms", () => {
  it("opens the divider between neighbouring rooms for a party one row cannot hold", () => {
    const r = suite(2, 3, { reservations: [res("R1", "19:00", 16)] });
    const p = planBuilds(r, "18:00", "20:00");
    assertSound(r, p);
    expect(p.builds[0]).toMatchObject({
      area: "P1 + P2",
      rows: [ids(1, 3), ids(4, 6)],
      seats: 16,
      dividersOpened: ["P1 | P2"],
    });
    expect(p.builds[0]?.steps.slice(0, 3)).toEqual([
      "Open the divider P1 | P2",
      "Join T1 + T2 + T3 in P1",
      "Join T4 + T5 + T6 in P2",
    ]);
  });

  it(`uses at most MAX_ROWS (${MAX_ROWS}) rows`, () => {
    const four = suite(5, 3, { reservations: [res("R1", "19:00", 32)] });
    const p4 = planBuilds(four, "18:00", "20:00");
    assertSound(four, p4);
    expect(p4.builds[0]?.rows).toHaveLength(4);
    expect(p4.builds[0]?.dividersOpened).toHaveLength(3);
    const five = suite(5, 3, { reservations: [res("R1", "19:00", 40)] });
    const p5 = planBuilds(five, "18:00", "20:00");
    expect(p5.builds).toEqual([]);
    expect(p5.unplaced).toHaveLength(1);
  });

  it("never combines rooms that are not next to each other", () => {
    // P2 is blocked, so P1 and P3 would have to skip it
    const r = suite(3, 3, { reservations: [res("R1", "19:00", 16)] });
    const blocked = {
      ...r,
      tables: r.tables.map((t) => (t.area === "P2" ? { ...t, status: "blocked" as const } : t)),
    };
    const p = planBuilds(blocked, "18:00", "20:00");
    expect(p.builds).toEqual([]);
    expect(p.unplaced[0]?.reservationId).toBe("R1");
  });

  it("never combines rooms of different suites", () => {
    const r = suite(2, 3, {
      areaOver: (i) => ({ suite: i === 0 ? "S" : "T", order: i }),
      reservations: [res("R1", "19:00", 16)],
    });
    expect(planBuilds(r, "18:00", "20:00").builds).toEqual([]);
  });

  it("never combines separate rows in ordinary dining areas", () => {
    const r = room({
      tables: [
        table("T1"),
        table("T2"),
        table("T3", { area: "Bar" }),
        table("T4", { area: "Bar" }),
      ],
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 0, spareChairs: 0 },
      reservations: [res("R1", "19:00", 12)],
    });
    expect(buildUnits(r).every((u) => u.rows.length === 1)).toBe(true);
    expect(planBuilds(r, "18:00", "20:00").builds).toEqual([]);
  });

  it("a requested room may be one of the opened rooms", () => {
    const r = suite(2, 3, { reservations: [res("R1", "19:00", 16, { area: "P2" })] });
    expect(planBuilds(r, "18:00", "20:00").builds[0]?.area).toBe("P1 + P2");
  });
});

describe("planBuilds storage: header chairs → extenders → spare tables", () => {
  const row2 = (inventory: Partial<Room["inventory"]>, party: number, spareSlots = 0) =>
    room({
      areas: [area("Main", { spareSlots })],
      tables: [table("T1", { maxExtraChairs: 1 }), table("T2", { maxExtraChairs: 1 })],
      joins: chain("T1", "T2"),
      inventory,
      reservations: [res("R1", "19:00", party)],
    });

  it("uses header chairs before extenders", () => {
    const p = planBuilds(row2({ extenders: 4, spareChairs: 20 }, 8), "18:00", "20:00");
    expect(p.builds[0]).toMatchObject({ seats: 8, extraChairs: 2, extenders: 0, spareTables: 0 });
    expect(p.builds[0]?.steps).toContain("Bring 2 chair(s) from storage");
  });

  it("then extenders, at most two per joinable row", () => {
    const ten = planBuilds(row2({ extenders: 4, spareChairs: 20 }, 10), "18:00", "20:00");
    expect(ten.builds[0]).toMatchObject({ seats: 10, extraChairs: 4, extenders: 1 });
    expect(ten.builds[0]?.steps).toContain("Add 1 extender(s)");
    const twelve = planBuilds(row2({ extenders: 4, spareChairs: 20 }, 12), "18:00", "20:00");
    expect(twelve.builds[0]).toMatchObject({ seats: 12, extenders: MAX_EXTENDERS_PER_ROW });
    const fourteen = planBuilds(row2({ extenders: 4, spareChairs: 20 }, 14), "18:00", "20:00");
    expect(fourteen.builds).toEqual([]);
    expect(fourteen.unplaced[0]?.reason).toBe(
      "Party of 14 at 19:00: the largest table set seats 12, even with storage.",
    );
  });

  it("brings a spare 4-top when extenders run out", () => {
    const r = room({
      areas: [area("Main", { spareSlots: 1 })],
      tables: [table("T1"), table("T2")],
      joins: chain("T1", "T2"),
      inventory: { extenders: 0, spareChairs: 4, spareTables: [{ seats: 4, count: 1 }] },
      reservations: [res("R1", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    assertSound(r, p);
    expect(p.builds[0]).toMatchObject({ seats: 8, extenders: 0, spareTables: 1, extraChairs: 2 });
    expect(p.builds[0]?.steps).toContain("Bring 1 spare 4-top(s) from storage to the end of a row");
    expect(p.totals.spareTables).toBe(1);
  });

  it("spare tables need a free floor slot, a 4-top in storage and the chairs", () => {
    const base = {
      tables: [table("T1"), table("T2")],
      joins: chain("T1", "T2"),
      reservations: [res("R1", "19:00", 8)],
    };
    const noSlot = room({
      ...base,
      areas: [area("Main", { spareSlots: 0 })],
      inventory: { extenders: 0, spareChairs: 4, spareTables: [{ seats: 4, count: 1 }] },
    });
    expect(planBuilds(noSlot, "18:00", "20:00").builds).toEqual([]);
    const onlyDeuces = room({
      ...base,
      areas: [area("Main", { spareSlots: 1 })],
      inventory: { extenders: 0, spareChairs: 4, spareTables: [{ seats: 2, count: 5 }] },
    });
    expect(planBuilds(onlyDeuces, "18:00", "20:00").builds).toEqual([]);
    const noChairs = room({
      ...base,
      areas: [area("Main", { spareSlots: 1 })],
      inventory: { extenders: 0, spareChairs: 1, spareTables: [{ seats: 4, count: 1 }] },
    });
    expect(planBuilds(noChairs, "18:00", "20:00").builds).toEqual([]);
  });

  it("never puts extenders or spare tables on non-joinable rounds or diamonds", () => {
    for (const shape of ["round", "diamond"] as const) {
      const r = room({
        areas: [area("Main", { spareSlots: 2 })],
        tables: [table("T1", { seats: 8, shape, joinable: false })],
        inventory: { extenders: 4, spareChairs: 20, spareTables: [{ seats: 4, count: 2 }] },
        reservations: [res("R1", "19:00", 10)],
      });
      const p = planBuilds(r, "18:00", "20:00");
      expect(p.builds, shape).toEqual([]);
      expect(p.unplaced).toHaveLength(1);
    }
  });

  it("a non-joinable round can still take its header chairs", () => {
    const r = room({
      tables: [table("T1", { seats: 8, shape: "round", joinable: false, maxExtraChairs: 2 })],
      inventory: { extenders: 4, spareChairs: 20 },
      reservations: [res("R1", "19:00", 10)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    expect(p.builds[0]).toMatchObject({ tables: ["T1"], seats: 10, extenders: 0, extraChairs: 2 });
    expect(p.builds[0]?.steps[0]).toBe("Use T1 in Main");
  });

  it("storage is shared across builds: extenders", () => {
    const r = room({
      tables: ids(1, 4).map((id) => table(id)),
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 2, spareChairs: 20 },
      reservations: [res("R1", "19:00", 10), res("R2", "19:00", 10)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    assertSound(r, p);
    expect(p.builds).toHaveLength(1);
    expect(p.unplaced).toHaveLength(1);
    expect(p.shortfalls).toEqual(["1 large party could not be placed"]);
  });

  it("storage is shared across builds: chairs", () => {
    const r = room({
      tables: ids(1, 4).map((id) => table(id)),
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 4, spareChairs: 3 },
      reservations: [res("R1", "19:00", 8), res("R2", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    assertSound(r, p);
    expect(p.builds).toHaveLength(1);
  });

  it("storage is shared across builds: spare tables", () => {
    const r = room({
      areas: [area("Main", { spareSlots: 2 })],
      tables: ids(1, 4).map((id) => table(id)),
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 0, spareChairs: 20, spareTables: [{ seats: 4, count: 1 }] },
      reservations: [res("R1", "19:00", 8), res("R2", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    assertSound(r, p);
    expect(p.totals.spareTables).toBe(1);
    expect(p.unplaced).toHaveLength(1);
  });

  // Regression: spareSlots is floor space per area, shared by every build that overlaps in time.
  it("spare tables in one area at once never exceed its spareSlots", () => {
    const r = room({
      areas: [area("Main", { spareSlots: 1 })],
      tables: ids(1, 4).map((id) => table(id)),
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 0, spareChairs: 20, spareTables: [{ seats: 4, count: 4 }] },
      reservations: [res("R1", "19:00", 8), res("R2", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    expect(p.totals.spareTables).toBeLessThanOrEqual(1);
  });
});

describe("planBuilds scheduling", () => {
  it("uses a single large table without a join step", () => {
    const r = room({
      tables: [table("T1", { seats: 8, joinable: false })],
      reservations: [res("R1", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    expect(p.builds[0]?.tables).toEqual(["T1"]);
    expect(p.builds[0]?.steps).toEqual([
      "Use T1 in Main",
      "Set for 8 by 18:30; split after ~20:30",
    ]);
  });

  it("frees tables for the next build only after the turn ends (build lead included)", () => {
    // 2×4-top with header room seats 8. R1 holds T1+T2 until 19:00 + 90 = 20:30.
    const plan = (second: string) => {
      const r = room({
        tables: ids(1, 2).map((id) => table(id, { maxExtraChairs: 1 })),
        joins: chain("T1", "T2"),
        inventory: { extenders: 0, spareChairs: 10 },
        reservations: [res("R1", "19:00", 7), res("R2", second, 7)],
      });
      const p = planBuilds(r, "18:00", "22:00");
      assertSound(r, p);
      return p;
    };
    expect(plan("21:00").builds).toHaveLength(2); // R2 starts building at 20:30
    const clash = plan("20:59"); // R2 would start building at 20:29
    expect(clash.builds.map((b) => b.reservationId)).toEqual(["R1"]);
    expect(clash.unplaced.map((u) => u.reservationId)).toEqual(["R2"]);
  });

  it("at equal times the larger party wins a single table set", () => {
    const r = room({
      tables: ids(1, 3).map((id) => table(id)),
      joins: chain("T1", "T2", "T3"),
      inventory: { extenders: 0, spareChairs: 0 },
      reservations: [res("R1", "19:00", 7), res("R2", "19:00", 8)],
    });
    const p = planBuilds(r, "18:00", "20:00");
    expect(p.builds.map((b) => b.reservationId)).toEqual(["R2"]);
    expect(p.unplaced.map((u) => u.reservationId)).toEqual(["R1"]);
  });

  it("searches instead of grabbing greedily: an earlier party leaves the quiet row for a later one", () => {
    const aq = { accessible: true, quiet: true };
    const a = { accessible: true };
    const r = room({
      tables: [
        ...ids(1, 3).map((id) => table(id, { attrs: aq })),
        ...ids(4, 6).map((id) => table(id, { attrs: a })),
      ],
      joins: [...chain("T1", "T2", "T3"), ...chain("T4", "T5", "T6")],
      inventory: { extenders: 4, spareChairs: 12 },
      reservations: [
        res("R1", "18:15", 7, { needs: ["accessible"] }),
        res("R2", "19:00", 9, { needs: ["quiet"] }),
      ],
    });
    const p = planBuilds(r, "17:00", "20:00");
    assertSound(r, p);
    expect(p.unplaced).toEqual([]);
    expect(p.builds.find((b) => b.reservationId === "R2")?.tables).toEqual(ids(1, 3));
  });

  it("honours area and needs, and names them when unplaced", () => {
    const r = room({
      tables: [
        table("T1"),
        table("T2"),
        table("T3", { area: "Patio" }),
        table("T4", { area: "Patio" }),
      ],
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      reservations: [
        res("R1", "19:00", 7, { area: "Patio" }),
        res("R2", "19:00", 7, { area: "Back room", needs: ["quiet"] }),
        res("R3", "21:00", 7, { needs: ["accessible"] }),
      ],
    });
    const p = planBuilds(r, "18:00", "22:00");
    assertSound(r, p);
    expect(p.builds.map((b) => [b.reservationId, b.area])).toEqual([["R1", "Patio"]]);
    const r2 = p.unplaced.find((u) => u.reservationId === "R2");
    expect(r2?.reason).toBe("Party of 7 at 19:00: no open tables in Back room (quiet) tonight.");
    expect(p.unplaced.find((u) => u.reservationId === "R3")?.reason).toContain("(accessible)");
    expect(p.shortfalls).toEqual(["2 large parties could not be placed"]);
  });

  it("honours view / stroller / booth / quiet and skips blocked tables", () => {
    const r = room({
      tables: [
        table("T1", { attrs: { view: true, quiet: true }, maxExtraChairs: 1 }),
        table("T2", { attrs: { strollerSpace: true, quiet: true } }),
        table("T3", { seats: 8, shape: "booth", joinable: false }),
        table("T4", { status: "blocked" }),
        table("T5"),
      ],
      joins: [
        ["T1", "T2"],
        ["T4", "T5"],
      ],
      reservations: [
        res("R1", "17:00", 7, { needs: ["view", "stroller", "quiet"] }),
        res("R2", "17:00", 8, { needs: ["booth"] }),
        res("R3", "17:00", 7),
      ],
    });
    const p = planBuilds(r, "16:00", "18:00");
    assertSound(r, p);
    expect(p.builds.find((b) => b.reservationId === "R1")?.tables).toEqual(["T1", "T2"]);
    expect(p.builds.find((b) => b.reservationId === "R2")?.tables).toEqual(["T3"]);
    expect(p.unplaced.map((u) => u.reservationId)).toEqual(["R3"]);
  });

  it("skips tables far too big for the party", () => {
    const r = room({
      tables: [table("T1", { seats: 20, joinable: false })],
      reservations: [res("R1", "19:00", 8)],
    });
    expect(planBuilds(r, "18:00", "20:00").builds).toEqual([]);
  });
});

describe("checkTableSet", () => {
  const r = nextDay();

  it("rejects empty, duplicate, unknown and blocked sets", () => {
    expect(checkTableSet(r, [])).toEqual({ ok: false, reason: "no tables" });
    expect(checkTableSet(r, ["T1", "T1"])).toEqual({
      ok: false,
      reason: "a table is listed twice",
    });
    expect(checkTableSet(r, ["T999"])).toEqual({ ok: false, reason: "table T999 does not exist" });
    expect(checkTableSet(dinnerPeak(), ["T57"])).toEqual({ ok: false, reason: "T57 is blocked" });
  });

  it("accepts a single table; a non-joinable table can take only its header chairs", () => {
    expect(checkTableSet(r, ["T41"])).toEqual({
      ok: true,
      rows: [["T41"]],
      baseSeats: 8,
      maxSeats: 9,
    });
    expect(checkTableSet(r, ["T6"])).toMatchObject({ ok: true, baseSeats: 4, maxSeats: 4 }); // diamond
  });

  it("accepts a legal long table and counts the most storage could add", () => {
    // 3×4-top = 8; header 3; 2 extenders = 4; Dining room has 2 spare slots = 4
    expect(checkTableSet(r, ["T29", "T27", "T28"])).toMatchObject({
      ok: true,
      baseSeats: 8,
      maxSeats: 19,
    });
  });

  it("accepts up to four runs in neighbouring rooms of one suite", () => {
    const garden = ids(57, 61);
    const library = [ids(63, 66), ids(67, 69)];
    const two = checkTableSet(r, [...garden, ...ids(63, 66)]);
    // 12 + 10 base; header 4; extenders 2×2×2 = 8; spare slots 2×2 = 4
    expect(two).toMatchObject({ ok: true, baseSeats: 22, maxSeats: 38 });
    if (two.ok) expect(sortRows(two.rows)).toEqual(sortRows([garden, ids(63, 66)]));
    expect(checkTableSet(r, [...garden, ...library.flat()])).toMatchObject({
      ok: true,
      baseSeats: 30,
      maxSeats: 52,
    });
    expect(checkTableSet(r, [...garden, ...library.flat(), ...ids(71, 75)])).toMatchObject({
      ok: true,
    });
    // both runs of one room on their own
    expect(checkTableSet(r, library.flat())).toMatchObject({ ok: true });
  });

  it(`rejects more than ${MAX_ROWS} runs`, () => {
    expect(checkTableSet(r, [...ids(57, 61), ...ids(63, 69), ...ids(71, 75), "T27"])).toEqual({
      ok: false,
      reason: `more than ${MAX_ROWS} separate tables for one party`,
    });
  });

  it("rejects rooms that are not next to each other", () => {
    expect(checkTableSet(r, [...ids(57, 61), ...ids(71, 75)])).toEqual({
      ok: false,
      reason: "the rooms are not next to each other",
    });
  });

  it("rejects rooms of different suites and separate tables outside a suite", () => {
    const suiteReason = {
      ok: false,
      reason: "separate tables for one party must be in private rooms of one suite",
    };
    // Cellar is the last East room, Loft the first West room
    expect(checkTableSet(r, [...ids(71, 75), ...ids(77, 80)])).toEqual(suiteReason);
    expect(checkTableSet(r, [...ids(27, 29), ...ids(42, 44)])).toEqual(suiteReason);
    expect(checkTableSet(r, ["T27", ...ids(77, 80)])).toEqual(suiteReason);
  });

  it("rejects an illegal row", () => {
    const h = room({
      tables: ids(1, 7).map((id) => table(id)),
      joins: chain(...ids(1, 7)),
    });
    expect(checkTableSet(h, ids(1, 7))).toEqual({
      ok: false,
      reason: "at most 6 tables can be joined",
    });
    const mixed = room({
      tables: [table("T1"), table("T2", { joinable: false })],
      joins: chain("T1", "T2"),
    });
    expect(checkTableSet(mixed, ["T1", "T2"])).toMatchObject({ ok: false });
  });

  it("rejects a join that fails the venue aisle check", () => {
    expect(checkTableSet(r, ["T43", "T44"])).toEqual({
      ok: false,
      reason:
        "T43 + T44 leaves 32 in of aisle (needs 36 in) — the joined run reaches into the aisle to the service station",
    });
    expect(checkTableSet(r, ["T42", "T43"])).toMatchObject({ ok: true });
  });

  it("rejects suite rooms with no order", () => {
    const h = suite(2, 2, { areaOver: () => ({ order: undefined }) });
    expect(checkTableSet(h, ids(1, 4))).toEqual({
      ok: false,
      reason: "the rooms are not next to each other",
    });
  });
});

describe("buildUnits", () => {
  it("contains single long tables and suite chains of up to MAX_ROWS rows, grown one way", () => {
    const r = suite(5, 2);
    const units = buildUnits(r);
    const multi = units.filter((u) => u.rows.length > 1).map((u) => u.areas.join("+"));
    expect(multi.sort()).toEqual([
      "P1+P2",
      "P1+P2+P3",
      "P1+P2+P3+P4",
      "P2+P3",
      "P2+P3+P4",
      "P2+P3+P4+P5",
      "P3+P4",
      "P3+P4+P5",
      "P4+P5",
    ]);
    for (const u of units) expect(u.rows.length).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("a room with two runs offers each run alone or both together, also when chained", () => {
    const r = room({
      areas: [
        area("A", { kind: "private", suite: "S", order: 0 }),
        area("B", { kind: "private", suite: "S", order: 1 }),
      ],
      tables: [
        ...ids(1, 2).map((id) => table(id, { area: "A" })),
        ...ids(3, 4).map((id) => table(id, { area: "A" })),
        ...ids(5, 6).map((id) => table(id, { area: "B" })),
      ],
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
        ["T5", "T6"],
      ],
    });
    const keys = buildUnits(r)
      .map((u) => u.rows.map((row) => row.join("+")).join(" | "))
      .sort();
    expect(keys).toEqual(
      [
        "T1+T2",
        "T3+T4",
        "T5+T6",
        "T1+T2 | T3+T4",
        "T1+T2 | T5+T6",
        "T3+T4 | T5+T6",
        "T1+T2 | T3+T4 | T5+T6",
      ].sort(),
    );
  });

  it("leaves out single tables too small for a large party", () => {
    const r = room({
      tables: [
        table("T1", { seats: 6, joinable: false }),
        table("T2", { seats: 7, joinable: false }),
      ],
    });
    expect(buildUnits(r).map((u) => u.rows)).toEqual([[["T2"]]]);
  });
});
