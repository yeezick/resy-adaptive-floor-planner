import { describe, expect, it } from "vitest";
import {
  area,
  chain,
  demoNight,
  dinnerPeak,
  heavySaturday,
  ids,
  nextDay,
  res,
  room,
  table,
} from "./__fixtures__/build";
import { planBuilds, usableFor, type Build } from "./buildplan";
import { findTablesForParty, TURN_MIN } from "./capacity";
import { parseRoom, tableById } from "./room";
import { toHHMM, toMinutes } from "./time";
import { generateTonight, type TonightProposal } from "./tonight";
import { partyName } from "./names";
import { buildMinutes } from "./wording";
import type { Room, Table } from "./types";

const spare4 = (r: Room) =>
  r.inventory.spareTables.filter((t) => t.seats >= 4).reduce((n, t) => n + t.count, 0);

/** Invariants every proposal must satisfy. */
function assertProposal(base: Room, g: TonightProposal, from: string, to: string): void {
  const plan = planBuilds(base, from, to);
  // the variant is a legal room
  expect(() => parseRoom(structuredClone(g.variant))).not.toThrow();
  // every move closes a gap: the table ends up touching the previous table of its row
  for (const m of g.changes.filter((c) => c.kind === "move")) {
    const t = tableById(g.variant, m.tables[0] as string) as Table;
    expect({ x: t.x, y: t.y }).toEqual(m.to);
    expect(
      Math.abs((m.to?.x ?? 0) - (m.from?.x ?? 0)) + Math.abs((m.to?.y ?? 0) - (m.from?.y ?? 0)),
    ).toBeGreaterThan(0.25);
  }
  // joined rows are contiguous along their axis, with no overlap
  for (const j of g.changes.filter((c) => c.kind === "join")) {
    const ts = j.tables.map((id) => tableById(g.variant, id) as Table);
    expect(ts.every(Boolean)).toBe(true);
    const xs = ts.map((t) => t.x);
    const ys = ts.map((t) => t.y);
    const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const sorted = [...ts].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as Table;
      const cur = sorted[i] as Table;
      const gap = horizontal ? cur.x - (prev.x + prev.w) : cur.y - (prev.y + prev.h);
      expect(Math.abs(gap), `${prev.id}→${cur.id} in ${j.text}`).toBeLessThanOrEqual(0.25);
    }
    expect(g.variant.combos).toContainEqual(j.tables);
  }
  // pulled tables exist, are open rects joined into their row, and come out of storage
  const pulled = g.changes.filter((c) => c.kind === "pull-table").flatMap((c) => c.tables);
  for (const id of pulled) {
    expect(tableById(base, id)).toBeUndefined();
    expect(tableById(g.variant, id)).toMatchObject({
      status: "open",
      shape: "rect",
      joinable: true,
    });
    expect(g.variant.joins.some(([a, b]) => a === id || b === id)).toBe(true);
    expect(g.variant.combos.some((c) => c.includes(id))).toBe(true);
  }
  expect(g.variant.tables).toHaveLength(base.tables.length + pulled.length);
  // storage left = stock − used
  expect(g.variant.inventory.extenders).toBe(base.inventory.extenders - plan.totals.extenders);
  expect(g.variant.inventory.spareChairs).toBe(
    base.inventory.spareChairs - plan.totals.extraChairs,
  );
  expect(spare4(g.variant)).toBe(spare4(base) - plan.totals.spareTables);
  expect(g.summary.storageUsed).toEqual({
    extenders: plan.totals.extenders,
    chairs: plan.totals.extraChairs,
    spareTables: plan.totals.spareTables,
  });
  expect(pulled.length).toBeLessThanOrEqual(plan.totals.spareTables);
  // crew: sorted; never starts before the clock or before the earlier party on those tables leaves;
  // ends at build-by, or (tight) runs on past build-by but never past the party's arrival
  const byRes = new Map<string, Build>(plan.builds.map((b) => [b.reservationId, b]));
  const ordered = [...plan.builds].sort((a, b) => toMinutes(a.buildBy) - toMinutes(b.buildBy));
  for (let i = 1; i < g.crew.length; i++)
    expect(toMinutes(g.crew[i]?.start as string)).toBeGreaterThanOrEqual(
      toMinutes(g.crew[i - 1]?.start as string),
    );
  for (const c of g.crew) {
    const b = byRes.get(c.reservationId) as Build;
    const before = ordered.slice(0, ordered.indexOf(b));
    const prior = before.filter((p) => p.tables.some((id) => b.tables.includes(id)));
    const earliest = Math.max(
      toMinutes(base.clock),
      ...prior.map((p) => toMinutes(p.time) + TURN_MIN),
    );
    expect(c.when).toBe(prior.length ? "rebuild" : "set");
    for (const p of prior)
      expect(c.actions).toContain(
        `After ~${toHHMM(toMinutes(p.time) + TURN_MIN)}, split the tables ${partyName(p.reservationId)} used`,
      );
    expect(toMinutes(c.start)).toBeGreaterThanOrEqual(earliest);
    expect(c.tight).toBe(toMinutes(b.buildBy) - buildMinutes(b) < earliest);
    expect(toMinutes(c.end)).toBeGreaterThanOrEqual(toMinutes(c.start));
    if (c.end === b.buildBy)
      expect(c.actions.at(-1)).toBe(`Set for ${b.partySize} by ${b.buildBy}`);
    else {
      expect(c.tight).toBe(true);
      expect(toMinutes(c.end)).toBeGreaterThan(toMinutes(b.buildBy));
      expect(toMinutes(c.end)).toBeLessThanOrEqual(toMinutes(b.time));
      expect(c.actions.at(-1)).toBe(
        `Set for ${b.partySize} by ${c.end} (tight: the party arrives at ${b.time})`,
      );
    }
  }
  expect(g.crew).toHaveLength(plan.builds.length);
  expect(g.reasons.map((r) => r.reservationId).sort()).toEqual(
    plan.builds.map((b) => b.reservationId).sort(),
  );
  expect(g.infeasible).toEqual(plan.unplaced);
  expect(g.summary.placed).toBe(plan.builds.length);
  expect(g.summary.largeParties).toBe(plan.builds.length + plan.unplaced.length);
}

describe("generateTonight on heavy-saturday 17:00–21:00", () => {
  const base = heavySaturday();
  const snapshot = structuredClone(base);
  const g = generateTonight(base, "17:00", "21:00");

  it("satisfies every proposal invariant", () => {
    assertProposal(base, g, "17:00", "21:00");
  });

  it("is pure: the base room is unchanged", () => {
    expect(base).toEqual(snapshot);
  });

  it("places 7 of 12 and explains the other 5", () => {
    expect(g.summary.largeParties).toBe(12);
    expect(g.summary.placed).toBe(7);
    expect(g.infeasible).toHaveLength(5);
    for (const x of g.infeasible)
      expect(x.reason).toMatch(new RegExp(`^Party of ${x.partySize} at `));
  });

  it("pulls three spare tables (new ids after T95) and takes them out of storage", () => {
    const pulled = g.changes.filter((c) => c.kind === "pull-table").flatMap((c) => c.tables);
    expect(pulled).toEqual(["T96", "T97", "T98"]);
    expect(g.summary.storageInStock).toEqual({ extenders: 2, chairs: 60, spareTables: 8 });
    expect(spare4(g.variant)).toBe(5);
  });

  it("never touches the closed West suite", () => {
    const suiteB = new Set(base.areas.filter((a) => a.suite === "West").map((a) => a.name));
    expect(suiteB.size).toBe(3);
    for (const c of g.changes)
      for (const id of c.tables) {
        const t = tableById(g.variant, id);
        expect(suiteB.has(t?.area ?? "")).toBe(false);
      }
  });

  it("is deterministic", () => {
    expect(generateTonight(heavySaturday(), "17:00", "21:00")).toEqual(g);
  });
});

describe("generateTonight on demo-night 17:00–22:00 (the demo's Saturday)", () => {
  const base = demoNight();
  const g = generateTonight(base, "17:00", "22:00");

  it("is a legal proposal", () => assertProposal(base, g, "17:00", "22:00"));

  it("places every large party but one, and says why the one can't fit", () => {
    expect(g.summary.largeParties).toBe(11);
    expect(g.summary.placed).toBe(10);
    expect(g.infeasible.map((x) => x.reservationId)).toEqual(["D11"]);
    // the best the room can still do at that time
    expect(g.infeasible[0]?.partial).toMatch(/^.+ seats \d+ of 36 at 19:30$/);
    expect(g.infeasible[0]?.reason).toMatch(
      /^Party of 36 at 19:30: every table set that seats them is built for /,
    );
  });

  it("stays inside storage", () => {
    const s = g.summary;
    expect(s.storageUsed.extenders).toBeLessThanOrEqual(s.storageInStock.extenders);
    expect(s.storageUsed.chairs).toBeLessThanOrEqual(s.storageInStock.chairs);
    expect(s.storageUsed.spareTables).toBeLessThanOrEqual(s.storageInStock.spareTables);
  });
});

describe("generateTonight on dinner-peak 19:10–21:30 (live state)", () => {
  const base = dinnerPeak();
  const g = generateTonight(base, "19:10", "21:30");

  it("satisfies every proposal invariant", () => {
    assertProposal(base, g, "19:10", "21:30");
  });

  it("places all three large parties", () => {
    expect(g.summary.largeParties).toBe(3);
    expect(g.infeasible).toEqual([]);
  });

  it("P6 (24) uses both runs of the held Atrium, never the Library where an event is seated", () => {
    const plan = planBuilds(base, "19:10", "21:30");
    const p6 = plan.builds.find((b) => b.reservationId === "P6");
    expect(p6?.area).toBe("Atrium");
    expect(p6?.rows).toHaveLength(2);
    expect(p6?.dividersOpened).toEqual([]);
    expect(p6?.seats).toBe(24);
    expect(g.reasons.find((r) => r.reservationId === "P6")?.text).toMatch(
      new RegExp(`^${partyName("P6")} \\(24\\) → Atrium · `),
    );
    expect(plan.builds.map((b) => b.reservationId).sort()).toEqual(["P11", "P6", "P8"]);
    for (const b of plan.builds)
      for (const id of b.tables) expect(tableById(base, id)?.area).not.toBe("Library");
  });

  // Regression (fixed): the reason used to claim neighbouring rooms whenever a build had two rows.
  it("a two-run build inside one room does not claim neighbouring rooms or open dividers", () => {
    expect(g.reasons.find((r) => r.reservationId === "P6")?.text).not.toMatch(/neighbouring rooms/);
  });
});

describe("generateTonight on next-day", () => {
  it("satisfies every proposal invariant and keeps all 11 placed", () => {
    const base = nextDay();
    const g = generateTonight(base, "17:00", "21:00");
    assertProposal(base, g, "17:00", "21:00");
    expect(g.summary.placed).toBe(11);
    expect(g.changes.some((c) => c.kind === "open-divider")).toBe(true);
  });
});

describe("generateTonight on hand-built rooms", () => {
  const rowRoom = (over: Partial<Room> = {}) =>
    room({
      clock: "15:00",
      areas: [area("Main", { spareSlots: 1 })],
      // spread out: 2 units apart, so the row must be pushed together
      tables: ids(1, 3).map((id, i) => table(id, { x: i * 6, y: 0, w: 4, h: 4 })),
      joins: chain(...ids(1, 3)),
      inventory: { extenders: 0, spareChairs: 10, spareTables: [{ seats: 4, count: 2 }] },
      reservations: [res("R1", "19:00", 10)],
      ...over,
    });

  it("pushes a spread row together and puts the spare table at its end", () => {
    const base = rowRoom();
    const g = generateTonight(base, "17:00", "21:00");
    assertProposal(base, g, "17:00", "21:00");
    const moves = g.changes.filter((c) => c.kind === "move");
    expect(moves.map((m) => m.tables[0])).toEqual(["T2", "T3"]);
    expect(moves[0]).toMatchObject({ from: { x: 6, y: 0 }, to: { x: 4, y: 0 } });
    expect(tableById(g.variant, "T4")).toMatchObject({ x: 12, y: 0 });
    expect(g.variant.joins).toContainEqual(["T3", "T4"]);
    expect(g.variant.combos).toEqual([["T1", "T2", "T3", "T4"]]);
    expect(g.crew[0]?.actions).toContain("Bring a spare 4-top from storage to the end of table 3");
    expect(g.reasons[0]?.text).toBe(
      `${partyName("R1")} (10) → Main · one long table of 3 · storage: 1 spare table(s), 2 chair(s) · seats 10 for 10, build by 18:30`,
    );
  });

  it("vertical rows close along y", () => {
    const base = rowRoom({
      tables: ids(1, 3).map((id, i) => table(id, { x: 0, y: i * 6, w: 4, h: 4 })),
      reservations: [res("R1", "19:00", 8)],
    });
    const g = generateTonight(base, "17:00", "21:00");
    assertProposal(base, g, "17:00", "21:00");
    expect(g.changes.filter((c) => c.kind === "move").map((m) => m.to)).toEqual([
      { x: 0, y: 4 },
      { x: 0, y: 8 },
    ]);
  });

  it("an already tight row makes no moves", () => {
    const base = rowRoom({
      tables: ids(1, 3).map((id, i) => table(id, { x: i * 4, y: 0, w: 4, h: 4 })),
      reservations: [res("R1", "19:00", 8)],
    });
    const g = generateTonight(base, "17:00", "21:00");
    expect(g.changes.filter((c) => c.kind === "move")).toEqual([]);
    expect(g.reasons[0]?.text).toContain("no storage needed");
  });

  // Regression (fixed): the spare table used to go after the numerically last id (T3), not the row's physical end. Row laid
  // out T3(x0)–T1(x4)–T2(x8): the spare T4 lands at x=4 on top of T1 and is joined to T3.
  it("a spare table goes at the physical end of the row, never on top of another table", () => {
    const base = rowRoom({
      tables: [
        table("T3", { x: 0, y: 0, w: 4, h: 4 }),
        table("T1", { x: 4, y: 0, w: 4, h: 4 }),
        table("T2", { x: 8, y: 0, w: 4, h: 4 }),
      ],
      joins: [
        ["T3", "T1"],
        ["T1", "T2"],
      ],
    });
    const g = generateTonight(base, "17:00", "21:00");
    const spare = tableById(g.variant, "T4") as Table;
    for (const t of g.variant.tables.filter((x) => x.id !== "T4"))
      expect(spare.x < t.x + t.w && t.x < spare.x + spare.w, `T4 overlaps ${t.id}`).toBe(false);
  });

  it("a second party on the same tables is a mid-shift rebuild that splits the first", () => {
    const base = rowRoom({
      inventory: { extenders: 0, spareChairs: 10, spareTables: [] },
      tables: ids(1, 3).map((id, i) =>
        table(id, { x: i * 4, y: 0, w: 4, h: 4, maxExtraChairs: 1 }),
      ),
      reservations: [res("R1", "17:30", 8), res("R2", "19:30", 9)],
    });
    const g = generateTonight(base, "17:00", "21:00");
    assertProposal(base, g, "17:00", "21:00");
    expect(g.crew.map((c) => [c.reservationId, c.when])).toEqual([
      ["R1", "set"],
      ["R2", "rebuild"],
    ]);
    expect(g.crew[1]?.actions[0]).toBe(`After ~19:00, split the tables ${partyName("R1")} used`);
    // R2 builds by 19:00 but R1 only leaves at 19:00: the rebuild waits and is tight
    expect(g.crew[1]).toMatchObject({ start: "19:00", tight: true });
    expect(g.crew[1]?.actions.at(-1)).toMatch(/\(tight: the party arrives at 19:30\)$/);
    expect(g.crew[0]).toMatchObject({ end: "17:00", tight: false });
    // the variant holds only the first build
    expect(g.changes.filter((c) => c.reservationId === "R2" && c.kind === "join")).toEqual([]);
    expect(g.variant.combos).toHaveLength(1);
  });

  it("a rebuild that needs spare tables says so in its actions", () => {
    const base = rowRoom({
      tables: ids(1, 3).map((id, i) => table(id, { x: i * 4, y: 0, w: 4, h: 4 })),
      inventory: { extenders: 0, spareChairs: 10, spareTables: [{ seats: 4, count: 2 }] },
      reservations: [res("R1", "17:30", 8), res("R2", "19:30", 10)],
    });
    const g = generateTonight(base, "17:00", "21:00");
    expect(g.crew[1]?.actions).toContain("Bring 1 spare 4-top(s) from storage to the row end");
  });

  it("reports extenders, rooms requested, needs and peak covers", () => {
    const base = rowRoom({
      tables: ids(1, 2).map((id, i) => table(id, { x: i * 4, w: 4, h: 4, attrs: { quiet: true } })),
      joins: chain("T1", "T2"),
      inventory: { extenders: 2, spareChairs: 10, spareTables: [] },
      reservations: [
        res("R1", "19:00", 8, { area: "Main", needs: ["quiet"] }),
        res("R2", "19:15", 2),
        res("R3", "23:00", 4),
      ],
    });
    const g = generateTonight(base, "17:00", "21:00");
    expect(g.reasons[0]?.text).toBe(
      `${partyName("R1")} (8) → Main · one long table of 2 · room requested · meets quiet · storage: 1 extender(s), 2 chair(s) · seats 8 for 8, build by 18:30`,
    );
    expect(g.changes.find((c) => c.kind === "pull-extenders")).toMatchObject({ count: 1 });
    expect(g.crew[0]?.actions).toContain("Add 1 extender(s)");
    expect(g.summary.coversBooked).toBe(10); // R3 is outside the window
    expect(g.summary.peakCovers).toEqual({ at: "19:15", covers: 10 });
    expect(g.summary.seatsOnFloor).toBe(8);
  });

  it("an empty night is an unchanged variant", () => {
    const base = rowRoom({ reservations: [res("R1", "19:00", 2)] });
    const g = generateTonight(base, "17:00", "21:00");
    expect(g.changes).toEqual([]);
    expect(g.crew).toEqual([]);
    expect(g.variant).toEqual(base);
    expect(g.summary.peakCovers).toEqual({ at: "19:00", covers: 2 });
  });

  // Regression: buildBy 18:30 is before the 18:45 clock; the window once ran 18:45 → 18:30.
  it("a late build starts at the clock, runs past build-by up to arrival, and is flagged tight", () => {
    const base = rowRoom({
      clock: "18:45",
      tables: ids(1, 2).map((id, i) => table(id, { x: i * 4, w: 4, h: 4 })),
      joins: chain("T1", "T2"),
      inventory: { extenders: 2, spareChairs: 10, spareTables: [] },
      reservations: [res("R1", "19:00", 7)],
    });
    const g = generateTonight(base, "17:00", "21:00");
    assertProposal(base, g, "17:00", "21:00");
    const [c] = g.crew;
    expect(c).toMatchObject({ start: "18:45", tight: true, when: "set" });
    expect(toMinutes(c?.end as string)).toBeGreaterThan(toMinutes("18:30"));
    expect(toMinutes(c?.end as string)).toBeLessThanOrEqual(toMinutes("19:00"));
    expect(c?.actions.at(-1)).toBe(`Set for 7 by ${c?.end} (tight: the party arrives at 19:00)`);
  });
});

describe("buildMinutes", () => {
  const b = (over: Partial<Build>): Build => ({
    reservationId: "R1",
    time: "19:00",
    buildBy: "18:30",
    partySize: 8,
    area: "Main",
    rows: [],
    tables: [],
    seats: 8,
    extenders: 0,
    extraChairs: 0,
    spareTables: 0,
    dividersOpened: [],
    steps: [],
    ...over,
  });

  it("is at least 10 minutes", () => {
    expect(buildMinutes(b({ tables: ["T1"] }))).toBe(10);
  });

  it("adds per table, extender, spare table, 4 chairs and divider", () => {
    expect(
      buildMinutes(
        b({
          tables: ids(1, 5),
          extenders: 2,
          spareTables: 1,
          extraChairs: 9,
          dividersOpened: ["A | B"],
        }),
      ),
    ).toBe(15 + 6 + 4 + 3 + 5);
  });
});

describe("usableFor (live state at the room clock)", () => {
  const r = room({ clock: "18:00", tables: [table("T1")] });
  const party = res("R1", "20:00", 8); // build starts 19:30

  it("open tables are usable, blocked never", () => {
    expect(usableFor(r, table("T1"), party)).toBe(true);
    expect(usableFor(r, table("T1", { status: "blocked" }), party)).toBe(false);
  });

  it("occupied tables only if free by the build start", () => {
    // seated: 85 + 5 = 90 min → free 19:30
    const seated = table("T1", { status: "occupied", phase: "seated" });
    expect(usableFor(r, seated, party)).toBe(true);
    expect(usableFor(r, seated, res("R1", "19:59", 8))).toBe(false);
    expect(
      usableFor(r, table("T1", { status: "occupied", phase: "check" }), res("R1", "18:41", 8)),
    ).toBe(true);
    expect(
      usableFor(r, table("T1", { status: "occupied", phase: "check" }), res("R1", "18:40", 8)),
    ).toBe(false);
  });

  it("held tables only for this party's time or a hold after it leaves", () => {
    const held = (at: string) => table("T1", { status: "reserved", reservedAt: at });
    expect(usableFor(r, held("20:00"), party)).toBe(true);
    expect(usableFor(r, held("21:30"), party)).toBe(true); // 20:00 + 90
    expect(usableFor(r, held("21:29"), party)).toBe(false);
    expect(usableFor(r, held("19:00"), party)).toBe(false);
    expect(usableFor(r, table("T1", { status: "reserved" }), party)).toBe(false);
  });

  it("planBuilds never builds on a table that will still be occupied", () => {
    const live = room({
      clock: "18:00",
      tables: [
        table("T1", { status: "occupied", phase: "seated" }),
        table("T2"),
        table("T3", { status: "occupied", phase: "dessert" }),
        table("T4"),
      ],
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 2, spareChairs: 10 },
      reservations: [res("R1", "19:00", 7)],
    });
    expect(planBuilds(live, "18:00", "20:00").builds[0]?.tables).toEqual(["T3", "T4"]);
  });
});

describe("unplaced diagnosis", () => {
  const plan = (r: Room) => planBuilds(r, "17:00", "21:00").unplaced.map((u) => u.reason);

  it("no tables meet the needs or room", () => {
    const r = room({
      tables: [table("T1", { seats: 8, joinable: false })],
      reservations: [res("R1", "19:00", 8, { needs: ["view", "quiet"] })],
    });
    expect(plan(r)).toEqual(["Party of 8 at 19:00: no open tables (view, quiet) tonight."]);
  });

  it("the largest set is too small even with storage", () => {
    const r = room({
      tables: ids(1, 2).map((id) => table(id)),
      joins: chain("T1", "T2"),
      inventory: { extenders: 4, spareChairs: 20 },
      reservations: [res("R1", "19:00", 20, { area: "Main" })],
    });
    expect(plan(r)).toEqual([
      "Party of 20 at 19:00: the largest table set in Main seats 10, even with storage.",
    ]);
  });

  it("every fitting set is already built for another party", () => {
    const r = room({
      tables: ids(1, 2).map((id) => table(id)),
      joins: chain("T1", "T2"),
      inventory: { extenders: 4, spareChairs: 20 },
      reservations: [res("R1", "19:00", 8), res("R2", "19:00", 7)],
    });
    expect(plan(r)).toEqual([
      "Party of 7 at 19:00: every table set that seats them is built for R1 — earliest free 21:00.",
    ]);
  });

  it("tables are free but storage runs out", () => {
    const r = room({
      tables: ids(1, 4).map((id) => table(id)),
      joins: [
        ["T1", "T2"],
        ["T3", "T4"],
      ],
      inventory: { extenders: 1, spareChairs: 20, spareTables: [{ seats: 4, count: 0 }] },
      reservations: [res("R1", "19:00", 8), res("R2", "19:00", 8)],
    });
    expect(plan(r)).toEqual([
      "Party of 8 at 19:00: storage runs out (1/1 extenders, 2/20 chairs already in use; storage is held all night).",
    ]);
  });

  // Regression (fixed): when the only fitting tables are still occupied (or held), the reason blames other builds with an
  // empty list: "already built for  at that time." It should say the tables are occupied/held.
  it("never blames an empty list of builds", () => {
    const r = room({
      clock: "18:30",
      tables: [table("T1", { status: "occupied", phase: "seated" }), table("T2")],
      joins: chain("T1", "T2"),
      inventory: { extenders: 2, spareChairs: 10 },
      reservations: [res("R1", "19:00", 7)],
    });
    expect(plan(r)[0]).not.toMatch(/already built for {2}/);
  });
});

describe("minSeats and shape rules", () => {
  it("findTablesForParty skips a single table whose minSeats exceeds the party", () => {
    const r = room({
      tables: [
        table("T1", { seats: 8, joinable: false, minSeats: 5 }),
        table("T2", { seats: 4, joinable: false }),
      ],
    });
    expect(
      findTablesForParty(r, { partySize: 4, maxOptions: 5 }).options.map((o) => o.tables),
    ).toEqual([["T2"]]);
    expect(
      findTablesForParty(r, { partySize: 5, maxOptions: 5 }).options.map((o) => o.tables),
    ).toEqual([["T1"]]);
  });

  it("minSeats defaults to 1 when parsing", () => {
    const parsed = nextDay();
    expect(parsed.tables.every((t) => t.minSeats >= 1)).toBe(true);
  });

  it.each(["diamond", "round", "booth"] as const)("parseRoom rejects a joinable %s", (shape) => {
    const raw = structuredClone(nextDay()) as Room;
    const t = raw.tables.find((x) => x.id === "T6") as Table;
    t.shape = shape;
    t.joinable = true;
    expect(() => parseRoom(raw)).toThrow(`T6 is a ${shape}; only rectangles join`);
  });
});
