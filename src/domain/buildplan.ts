import { checkRows, clearanceFor, type Clearance } from "./clearance";
import { checkCombine, combinedSeats, MAX_COMBO, SEATS_PER_EXTENDER } from "./combine";
import { candidateGroups, meetsNeeds, TURN_MIN } from "./capacity";
import { estimateFreeTime } from "./phases";
import { adjacentRooms, areaByName, neighbours, tableById } from "./room";
import { toHHMM, toMinutes } from "./time";
import type { Reservation, Room, Table } from "./types";
import { tableNo, tablesPhrase } from "./wording";

export const LARGE_PARTY = 7;
/** Start each build this many minutes before the party arrives. */
export const BUILD_LEAD_MIN = 30;
export const MAX_EXTENDERS_PER_ROW = 2;
/** A party can span up to this many parallel rows in neighbouring rooms once the dividers are open. */
export const MAX_ROWS = 4;
/** Candidate builds kept per party; a small search keeps the plan instant for a night's large parties. */
export const OPTIONS_PER_PARTY = 4;
const SEARCH_NODE_CAP = 20_000;

export interface Build {
  reservationId: string;
  time: string;
  buildBy: string;
  partySize: number;
  area: string;
  /** One entry per long table; more than one means neighbouring rooms opened into one space. */
  rows: string[][];
  tables: string[];
  seats: number;
  extenders: number;
  extraChairs: number;
  spareTables: number;
  dividersOpened: string[];
  steps: string[];
}

export interface BuildPlan {
  window: { from: string; to: string };
  builds: Build[];
  totals: { extenders: number; extraChairs: number; spareTables: number; tablesUsed: number };
  shortfalls: string[];
  unplaced: {
    reservationId: string;
    partySize: number;
    reason: string;
    /** The best the room can still do at that time: the largest free set, e.g. "Atrium seats 30 of 36". */
    partial?: string;
  }[];
}

interface Stock {
  extenders: number;
  chairs: number;
  spare4: number; // spare joinable tables (any size ≥ 4 counts as a 4-top here)
}

interface Unit {
  rows: string[][];
  /** Rows that can take extenders or a spare table at the end (joinable rectangles). */
  extendableRows: number;
  tables: Table[];
  areas: string[];
  base: number;
  headerRoom: number;
  spareSlots: number;
}

interface Choice {
  unit: Unit;
  /** Spare tables placed per area (floor space is per area and shared over time). */
  spareByArea: Record<string, number>;
  extenders: number;
  extraChairs: number;
  spareTables: number;
  seats: number;
  cost: number;
}

interface Busy {
  ids: string[];
  from: number;
  to: number;
  /** Private rooms a build claims whole: one party per room at a time. */
  rooms: string[];
  spareByArea: Record<string, number>;
}

/** Whole runs of joinable tables in private-suite rooms — the units that combine across rooms. */
function suiteRows(room: Room): string[][] {
  const inSuite = (t: Table) =>
    !!areaByName(room, t.area)?.suite && t.joinable && t.status !== "blocked";
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const t of room.tables) {
    if (seen.has(t.id) || !inSuite(t)) continue;
    const row = [t.id];
    seen.add(t.id);
    for (let i = 0; i < row.length; i++) {
      for (const n of neighbours(room, row[i] as string)) {
        const o = tableById(room, n);
        if (o && !seen.has(n) && inSuite(o) && o.area === t.area) {
          seen.add(n);
          row.push(n);
        }
      }
    }
    if (row.length > 1 && row.length <= MAX_COMBO && checkCombine(room, row).ok) rows.push(row);
  }
  return rows;
}

function makeUnit(room: Room, rows: string[][]): Unit {
  const tables = rows.flat().map((id) => tableById(room, id) as Table);
  const areas = [...new Set(tables.map((t) => t.area))];
  return {
    rows,
    extendableRows: rows.filter((r) => r.every((id) => tableById(room, id)?.joinable)).length,
    tables,
    areas,
    base: rows.reduce((n, r) => n + combinedSeats(r.map((id) => tableById(room, id) as Table)), 0),
    headerRoom: tables.reduce((n, t) => n + t.maxExtraChairs, 0),
    spareSlots: areas.reduce((n, a) => n + (areaByName(room, a)?.spareSlots ?? 0), 0),
  };
}

/** Single groups (one long table) plus 2..MAX_ROWS full rows in neighbouring rooms of one suite. */
export function buildUnits(room: Room): Unit[] {
  const singles = candidateGroups(room, MAX_COMBO).filter(
    (g) => g.length > 1 || (tableById(room, g[0] as string)?.seats ?? 0) >= LARGE_PARTY,
  );
  const units = singles.map((g) => makeUnit(room, [g]));
  // per private room: each long run on its own, and all of the room's runs together
  const areaOf = (r: string[]) => tableById(room, r[0] as string)?.area ?? "";
  const byRoom = new Map<string, string[][]>();
  for (const r of suiteRows(room)) byRoom.set(areaOf(r), [...(byRoom.get(areaOf(r)) ?? []), r]);
  const options = new Map<string, string[][][]>();
  for (const [a, rs] of byRoom) options.set(a, rs.length > 1 ? [...rs.map((r) => [r]), rs] : [rs]);
  const extend = (rooms: string[], rows: string[][]) => {
    if (rooms.length >= 2 || rows.length >= 2) units.push(makeUnit(room, rows));
    const last = rooms[rooms.length - 1] as string;
    const lo = areaByName(room, last)?.order ?? 0;
    for (const [a, opts] of options) {
      // grow towards higher order only, so each set of rooms is produced once
      if ((areaByName(room, a)?.order ?? 0) !== lo + 1 || !adjacentRooms(room, last, a)) continue;
      for (const o of opts)
        if (rows.length + o.length <= MAX_ROWS) extend([...rooms, a], [...rows, ...o]);
    }
  };
  for (const [a, opts] of options) for (const o of opts) extend([a], o);
  return units;
}

/** Cheapest way to reach the party size with storage: header chairs, then extenders, then spare tables. */
function augment(
  unit: Unit,
  party: number,
  stock: Stock,
  slotsFree: number,
): Omit<Choice, "unit" | "cost" | "spareByArea"> | null {
  let short = Math.max(0, party - unit.base);
  let chairs = stock.chairs;
  const extraChairsHeader = Math.min(short, unit.headerRoom, chairs);
  short -= extraChairsHeader;
  chairs -= extraChairsHeader;
  const extLimit = Math.min(
    stock.extenders,
    MAX_EXTENDERS_PER_ROW * unit.extendableRows,
    Math.floor(chairs / SEATS_PER_EXTENDER),
  );
  const extenders = Math.min(extLimit, Math.ceil(short / SEATS_PER_EXTENDER));
  short = Math.max(0, short - extenders * SEATS_PER_EXTENDER);
  chairs -= extenders * SEATS_PER_EXTENDER;
  // a spare 4-top added to the end of a row adds 2 seats net
  const spareLimit = unit.extendableRows
    ? Math.min(stock.spare4, slotsFree, Math.floor(chairs / 2))
    : 0;
  const spareTables = Math.min(spareLimit, Math.ceil(short / 2));
  short = Math.max(0, short - spareTables * 2);
  chairs -= spareTables * 2;
  if (short > 0) return null;
  const extraChairs = stock.chairs - chairs;
  return {
    extenders,
    extraChairs,
    spareTables,
    seats: unit.base + extraChairsHeader + extenders * SEATS_PER_EXTENDER + spareTables * 2,
  };
}

function privateRooms(room: Room, unit: Unit): string[] {
  return unit.areas.filter((a) => areaByName(room, a)?.kind === "private");
}

/** Most seats storage could ever add to a unit (ignores what other builds use). */
function maxSeats(u: Unit): number {
  return (
    u.base +
    u.headerRoom +
    MAX_EXTENDERS_PER_ROW * SEATS_PER_EXTENDER * u.extendableRows +
    (u.extendableRows ? u.spareSlots * 2 : 0)
  );
}

/** Units that could ever suit this party, best first, capped so the search stays bounded. */
export const UNITS_PER_PARTY = 40;
/**
 * Can this table be built for this party, given live state at the room clock? Open tables can; seated tables
 * only if they free up before the build starts; held tables only when held for this party's time or for a
 * later party that arrives after this one leaves.
 */
export function usableFor(room: Room, t: Table, r: Reservation): boolean {
  const t0 = toMinutes(r.time);
  const start = t0 - BUILD_LEAD_MIN;
  const now = toMinutes(room.clock);
  switch (t.status) {
    case "open":
      return true;
    case "blocked":
      return false;
    case "occupied":
      return now + (estimateFreeTime(t).minutes ?? Infinity) <= start;
    case "reserved": {
      const held = toMinutes(t.reservedAt ?? "00:00");
      return held === t0 || held >= t0 + TURN_MIN;
    }
  }
}

function poolFor(room: Room, units: readonly Unit[], r: Reservation): Unit[] {
  return units
    .filter(
      (u) =>
        u.tables.every((t) => usableFor(room, t, r)) &&
        (!r.area || u.areas.includes(r.area)) &&
        u.base <= r.partySize + 8 &&
        maxSeats(u) >= r.partySize &&
        meetsNeeds(u.tables, r.needs),
    )
    .map((u) => ({
      u,
      k: Math.abs(u.base - r.partySize) * 2 + u.tables.length * 3 + (u.rows.length - 1) * 6,
    }))
    .sort((a, b) => a.k - b.k || a.u.rows.flat().join().localeCompare(b.u.rows.flat().join()))
    .slice(0, UNITS_PER_PARTY)
    .map((x) => x.u);
}

function choicesFor(
  room: Room,
  units: readonly Unit[],
  r: Reservation,
  busy: readonly Busy[],
  stock: Stock,
): Choice[] {
  const t0 = toMinutes(r.time);
  const from = t0 - BUILD_LEAD_MIN;
  const overlapping = busy.filter((b) => from < b.to && t0 + TURN_MIN > b.from);
  const takenIds = new Set(overlapping.flatMap((b) => b.ids));
  const takenRooms = new Set(overlapping.flatMap((b) => b.rooms));
  const out: Choice[] = [];
  for (const unit of units) {
    if (unit.tables.some((t) => takenIds.has(t.id))) continue;
    if (privateRooms(room, unit).some((a) => takenRooms.has(a))) continue;
    const freeByArea: Record<string, number> = {};
    for (const a of unit.areas) {
      const used = overlapping.reduce((n, b) => n + (b.spareByArea[a] ?? 0), 0);
      freeByArea[a] = Math.max(0, (areaByName(room, a)?.spareSlots ?? 0) - used);
    }
    const slotsFree = Object.values(freeByArea).reduce((n, v) => n + v, 0);
    const a = augment(unit, r.partySize, stock, slotsFree);
    if (!a) continue;
    const spareByArea: Record<string, number> = {};
    let toPlace = a.spareTables;
    for (const area of unit.areas) {
      const k = Math.min(toPlace, freeByArea[area] ?? 0);
      if (k) spareByArea[area] = k;
      toPlace -= k;
    }
    const waste = a.seats - r.partySize;
    const cost =
      waste * 2 +
      unit.tables.length * 3 +
      (unit.rows.length - 1) * 6 +
      a.extenders * 4 +
      a.spareTables * 5 +
      (a.extraChairs - a.extenders * SEATS_PER_EXTENDER - a.spareTables * 2);
    out.push({ unit, spareByArea, ...a, cost });
  }
  out.sort(
    (x, y) => x.cost - y.cost || x.unit.rows.flat().join().localeCompare(y.unit.rows.flat().join()),
  );
  return out.slice(0, OPTIONS_PER_PARTY);
}

/**
 * Plan table builds for large parties in a time window. Read-only.
 * Searches assignments (earliest party first) to place as many parties as possible, then to minimise
 * wasted seats, tables, rooms opened and storage used. Windows do not cross midnight.
 */
export interface PlanOptions {
  /** Reservations that may only use private event rooms (a "private feel" request). */
  privateOnly?: readonly string[];
  /** Aisle data; default: the room's venue data (clearanceFor). null = no aisle check. */
  clearance?: Clearance | null;
  /**
   * Per reservation: the only floor tables it may use (a manager's "between tables 30–50"). Other bookings are
   * not limited. Spare tables from storage still count.
   */
  onlyTables?: Readonly<Record<string, readonly string[]>>;
}

/** True when every join in the unit leaves the minimum aisle. */
function aisleOk(room: Room, c: Clearance | null, u: Unit): boolean {
  return !c || checkRows(c, room, u.rows).every((j) => j.ok);
}

export interface AisleReject {
  tables: string[];
  area: string;
  reason: string;
}

/**
 * Table sets that would seat this party but were rejected because a join fails the aisle check — the
 * alternatives a manager might have expected, with the reason. Best candidates first.
 */
export function aisleRejects(
  room: Room,
  r: Reservation,
  opts: {
    clearance?: Clearance | null;
    privateOnly?: boolean;
    max?: number;
    /** The tables actually chosen: only options ranked ahead of them are reported. */
    chosen?: readonly string[];
  } = {},
): AisleReject[] {
  const c = opts.clearance === undefined ? clearanceFor(room) : opts.clearance;
  if (!c) return [];
  const units = buildUnits(room).filter(
    (u) => !opts.privateOnly || u.areas.every((a) => areaByName(room, a)?.kind === "private"),
  );
  const out: AisleReject[] = [];
  const chosen = opts.chosen ? [...opts.chosen].sort().join() : null;
  for (const u of poolFor(room, units, r)) {
    if (chosen && [...u.rows.flat()].sort().join() === chosen) break;
    const bad = checkRows(c, room, u.rows).find((j) => !j.ok);
    if (bad?.reason)
      out.push({ tables: u.rows.flat(), area: u.areas.join(" + "), reason: bad.reason });
    if (out.length >= (opts.max ?? 1)) break;
  }
  return out;
}

export function planBuilds(
  room: Room,
  from: string,
  to: string,
  opts: PlanOptions = {},
): BuildPlan {
  const start = toMinutes(from);
  const end = toMinutes(to);
  const large = room.reservations
    .filter(
      (r) => r.partySize >= LARGE_PARTY && toMinutes(r.time) >= start && toMinutes(r.time) <= end,
    )
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time) || b.partySize - a.partySize);
  const clearance = opts.clearance === undefined ? clearanceFor(room) : opts.clearance;
  const units = buildUnits(room).filter((u) => aisleOk(room, clearance, u));
  const privateOnly = new Set(opts.privateOnly ?? []);
  const isPrivate = (u: Unit) => u.areas.every((a) => areaByName(room, a)?.kind === "private");
  const unitsFor = (r: Reservation): Unit[] => {
    const allowed = opts.onlyTables?.[r.id];
    const set = allowed ? new Set(allowed) : null;
    return units.filter(
      (u) =>
        (!privateOnly.has(r.id) || isPrivate(u)) &&
        (!set || u.rows.every((row) => row.every((id) => set.has(id)))),
    );
  };
  const pools = large.map((r) => poolFor(room, unitsFor(r), r));
  const spare4 = room.inventory.spareTables
    .filter((t) => t.seats >= 4)
    .reduce((n, t) => n + t.count, 0);

  let best: { picks: (Choice | null)[]; unplaced: number; cost: number } | undefined;
  let nodes = 0;
  const picks: (Choice | null)[] = [];
  const busy: Busy[] = [];
  const search = (i: number, stock: Stock, unplaced: number, cost: number) => {
    nodes++;
    if (best && (unplaced > best.unplaced || (unplaced === best.unplaced && cost >= best.cost)))
      return;
    if (i === large.length) {
      best = { picks: [...picks], unplaced, cost };
      return;
    }
    if (nodes > SEARCH_NODE_CAP && best) return;
    const r = large[i] as Reservation;
    const t0 = toMinutes(r.time);
    for (const c of choicesFor(room, pools[i] as Unit[], r, busy, stock)) {
      picks.push(c);
      busy.push({
        ids: c.unit.tables.map((t) => t.id),
        from: t0 - BUILD_LEAD_MIN,
        to: t0 + TURN_MIN,
        rooms: privateRooms(room, c.unit),
        spareByArea: c.spareByArea,
      });
      search(
        i + 1,
        {
          extenders: stock.extenders - c.extenders,
          chairs: stock.chairs - c.extraChairs,
          spare4: stock.spare4 - c.spareTables,
        },
        unplaced,
        cost + c.cost,
      );
      busy.pop();
      picks.pop();
    }
    picks.push(null);
    search(i + 1, stock, unplaced + 1, cost);
    picks.pop();
  };
  search(
    0,
    { extenders: room.inventory.extenders, chairs: room.inventory.spareChairs, spare4 },
    0,
    0,
  );

  const builds: Build[] = [];
  const unplaced: BuildPlan["unplaced"] = [];
  large.forEach((r, i) => {
    const c = best?.picks[i] ?? null;
    if (c) builds.push(describe(r, c));
  });
  const unplacedCount = large.filter((_, i) => !best?.picks[i]).length;
  large.forEach((r, i) => {
    if (best?.picks[i]) return;
    unplaced.push({
      reservationId: r.id,
      partySize: r.partySize,
      reason: diagnose(
        room,
        r,
        unitsFor(r),
        pools[i] as Unit[],
        builds,
        // the earliest-free search is cheap for a few can't-fits; skip it for a night that is mostly unplaceable
        unplacedCount <= MAX_NEXT_FIT ? end : -1,
      ),
      partial:
        unplacedCount <= MAX_NEXT_FIT
          ? (bestPartial(room, unitsFor(r), r, builds) ?? undefined)
          : undefined,
    });
  });
  const shortfalls = unplaced.length
    ? [`${unplaced.length} large part${unplaced.length === 1 ? "y" : "ies"} could not be placed`]
    : [];
  return {
    window: { from, to },
    builds,
    totals: {
      extenders: builds.reduce((n, b) => n + b.extenders, 0),
      extraChairs: builds.reduce((n, b) => n + b.extraChairs, 0),
      spareTables: builds.reduce((n, b) => n + b.spareTables, 0),
      tablesUsed: builds.reduce((n, b) => n + b.tables.length, 0),
    },
    shortfalls,
    unplaced,
  };
}

function describe(r: Reservation, c: Choice): Build {
  const t0 = toMinutes(r.time);
  const { unit } = c;
  const dividers: string[] = [];
  for (let k = 1; k < unit.areas.length; k++)
    dividers.push(`${unit.areas[k - 1]} | ${unit.areas[k]}`);
  const steps: string[] = [];
  for (const d of dividers) steps.push(`Open the divider ${d}`);
  for (const row of unit.rows) {
    const area = unit.tables.find((t) => t.id === row[0])?.area ?? "";
    steps.push(
      row.length > 1
        ? `Combine ${tablesPhrase(row)} in ${area}`
        : `Use ${tablesPhrase(row)} in ${area}`,
    );
  }
  if (c.spareTables)
    steps.push(`Bring ${c.spareTables} spare 4-top(s) from storage to the end of a row`);
  if (c.extenders) steps.push(`Add ${c.extenders} extender(s)`);
  if (c.extraChairs) steps.push(`Bring ${c.extraChairs} chair(s) from storage`);
  steps.push(
    `Set for ${r.partySize} by ${toHHMM(t0 - BUILD_LEAD_MIN)}; split after ~${toHHMM(t0 + TURN_MIN)}`,
  );
  return {
    reservationId: r.id,
    time: r.time,
    buildBy: toHHMM(t0 - BUILD_LEAD_MIN),
    partySize: r.partySize,
    area: unit.areas.join(" + "),
    rows: unit.rows,
    tables: unit.rows.flat(),
    seats: c.seats,
    extenders: c.extenders,
    extraChairs: c.extraChairs,
    spareTables: c.spareTables,
    dividersOpened: dividers,
    steps,
  };
}

/** Busy windows for the builds already in a plan (used to place one more party into what is left). */
function busyFrom(room: Room, builds: readonly Build[]): Busy[] {
  return builds.map((b) => {
    const areas = b.area.split(" + ");
    const spareByArea: Record<string, number> = {};
    let left = b.spareTables;
    for (const a of areas) {
      const k = Math.min(left, areaByName(room, a)?.spareSlots ?? 0);
      if (k) spareByArea[a] = k;
      left -= k;
    }
    return {
      ids: b.tables,
      from: toMinutes(b.time) - BUILD_LEAD_MIN,
      to: toMinutes(b.time) + TURN_MIN,
      rooms: areas.filter((a) => areaByName(room, a)?.kind === "private"),
      spareByArea,
    };
  });
}

/** Can't-fits per plan that get an "earliest free" time. */
export const MAX_NEXT_FIT = 5;

/** Latest arrival tried when looking for a later time a party could fit. */
export const LATEST_ARRIVAL = "22:00";

/** Earliest later arrival (15-minute steps) at which the party fits around this plan, or null. */
function earliestFree(
  room: Room,
  units: readonly Unit[],
  r: Reservation,
  builds: readonly Build[],
  latest: number,
): string | null {
  const busy = busyFrom(room, builds);
  const spare4 = room.inventory.spareTables
    .filter((t) => t.seats >= 4)
    .reduce((n, t) => n + t.count, 0);
  const stock: Stock = {
    extenders: room.inventory.extenders - builds.reduce((n, b) => n + b.extenders, 0),
    chairs: room.inventory.spareChairs - builds.reduce((n, b) => n + b.extraChairs, 0),
    spare4: spare4 - builds.reduce((n, b) => n + b.spareTables, 0),
  };
  for (let m = toMinutes(r.time) + 15; m <= Math.max(latest, toMinutes(LATEST_ARRIVAL)); m += 15) {
    const at = { ...r, time: toHHMM(m) };
    if (choicesFor(room, poolFor(room, units, at), at, busy, stock).length) return at.time;
  }
  return null;
}

/** Largest party (down to LARGE_PARTY) that fits at the party's time around this plan, and where. */
function bestPartial(
  room: Room,
  units: readonly Unit[],
  r: Reservation,
  builds: readonly Build[],
): string | null {
  const busy = busyFrom(room, builds);
  const spare4 = room.inventory.spareTables
    .filter((t) => t.seats >= 4)
    .reduce((n, t) => n + t.count, 0);
  const stock: Stock = {
    extenders: room.inventory.extenders - builds.reduce((n, b) => n + b.extenders, 0),
    chairs: room.inventory.spareChairs - builds.reduce((n, b) => n + b.extraChairs, 0),
    spare4: spare4 - builds.reduce((n, b) => n + b.spareTables, 0),
  };
  for (let n = r.partySize - 1; n >= LARGE_PARTY; n--) {
    const at = { ...r, partySize: n };
    const c = choicesFor(room, poolFor(room, units, at), at, busy, stock)[0];
    if (c) return `${c.unit.areas.join(" + ")} seats ${c.seats} of ${r.partySize} at ${r.time}`;
  }
  return null;
}

const listIds = (ids: string[]) =>
  ids.length > 3
    ? `${ids.slice(0, 3).map(tableNo).join(", ")} +${ids.length - 3}`
    : ids.map(tableNo).join(", ");

/** One-line reason a party could not be placed (size, needs, timing or storage) and when it could. */
function diagnose(
  room: Room,
  r: Reservation,
  units: readonly Unit[],
  pool: readonly Unit[],
  builds: readonly Build[],
  latest: number,
): string {
  const who = `Party of ${r.partySize} at ${r.time}`;
  const where = r.area ? ` in ${r.area}` : "";
  const needs = r.needs.length ? ` (${r.needs.join(", ")})` : "";
  const candidates = units.filter(
    (u) =>
      !u.tables.some((t) => t.status === "blocked") &&
      (!r.area || u.areas.includes(r.area)) &&
      meetsNeeds(u.tables, r.needs),
  );
  if (!candidates.length) return `${who}: no open tables${where}${needs} tonight.`;
  const largest = Math.max(...candidates.map(maxSeats));
  if (largest < r.partySize)
    return `${who}: the largest table set${where}${needs} seats ${largest}, even with storage.`;
  const next = latest >= 0 ? earliestFree(room, units, r, builds, latest) : null;
  const then =
    latest < 0 ? "" : next ? ` — earliest free ${next}` : " — nothing frees up later tonight";
  const usable = candidates.filter(
    (u) => maxSeats(u) >= r.partySize && u.tables.every((t) => usableFor(room, t, r)),
  );
  if (!usable.length)
    return `${who}: the tables${where}${needs} that seat them are still in use or held${then}.`;
  const t0 = toMinutes(r.time);
  const overlaps = builds.filter(
    (b) =>
      toMinutes(b.buildBy) < t0 + TURN_MIN && t0 - BUILD_LEAD_MIN < toMinutes(b.time) + TURN_MIN,
  );
  const fits = (pool.length ? pool : usable).filter((u) => maxSeats(u) >= r.partySize);
  const blockedBy = new Set<string>();
  const free = fits.filter((u) => {
    const clash = overlaps.filter(
      (b) =>
        b.tables.some((id) => u.tables.some((t) => t.id === id)) ||
        privateRooms(room, u).some((a) => b.area.split(" + ").includes(a)),
    );
    clash.forEach((b) => blockedBy.add(b.reservationId));
    return clash.length === 0;
  });
  if (!free.length && blockedBy.size)
    return `${who}: every table set${where}${needs} that seats them is built for ${listIds([...blockedBy])}${then}.`;
  const inv = room.inventory;
  const used = builds.reduce(
    (a, b) => ({ e: a.e + b.extenders, c: a.c + b.extraChairs, s: a.s + b.spareTables }),
    { e: 0, c: 0, s: 0 },
  );
  const spare = inv.spareTables.filter((x) => x.seats >= 4).reduce((n, x) => n + x.count, 0);
  const spares = spare ? `, ${used.s}/${spare} spare tables` : "";
  return `${who}: storage runs out (${used.e}/${inv.extenders} extenders, ${used.c}/${inv.spareChairs} chairs${spares} already in use; storage is held all night).`;
}

export type TableSetCheck =
  | { ok: true; rows: string[][]; baseSeats: number; maxSeats: number }
  | { ok: false; reason: string };

/**
 * Is this set of tables something a person could actually set up? One table, one legal long table, or up
 * to MAX_ROWS long tables in neighbouring rooms of one suite (dividers open). maxSeats includes the most
 * storage could add (header chairs, extenders, spare tables) regardless of what is left tonight.
 */
export function checkTableSet(room: Room, ids: readonly string[]): TableSetCheck {
  if (ids.length === 0) return { ok: false, reason: "no tables" };
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "a table is listed twice" };
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) return { ok: false, reason: `table ${tableNo(id)} does not exist` };
    if (t.status === "blocked") return { ok: false, reason: `table ${tableNo(id)} is blocked` };
  }
  // split into connected runs
  const left = new Set(ids);
  const rows: string[][] = [];
  while (left.size) {
    const first = [...left][0] as string;
    const row = [first];
    left.delete(first);
    for (let i = 0; i < row.length; i++) {
      for (const [a, b] of room.joins) {
        const cur = row[i];
        const other = a === cur ? b : b === cur ? a : undefined;
        if (other && left.has(other)) {
          left.delete(other);
          row.push(other);
        }
      }
    }
    rows.push(row);
  }
  if (rows.length > MAX_ROWS)
    return { ok: false, reason: `more than ${MAX_ROWS} separate tables for one party` };
  for (const row of rows) {
    if (row.length > 1) {
      const c = checkCombine(room, row);
      if (!c.ok) return { ok: false, reason: c.reason };
    }
  }
  if (rows.length > 1) {
    const areas = [...new Set(rows.map((r) => tableById(room, r[0] as string)?.area ?? ""))];
    const suite = areaByName(room, areas[0] as string)?.suite;
    if (!suite || areas.some((a) => areaByName(room, a)?.suite !== suite))
      return {
        ok: false,
        reason: "separate tables for one party must be in private rooms of one suite",
      };
    const orders = areas.map((a) => areaByName(room, a)?.order ?? -1).sort((x, y) => x - y);
    if (orders.some((o, i) => i > 0 && o !== (orders[i - 1] as number) + 1))
      return { ok: false, reason: "the rooms are not next to each other" };
  }
  // the aisle rule applies to every legality check, not just the planner
  const clearance = clearanceFor(room);
  const badJoin = clearance && checkRows(clearance, room, rows).find((j) => !j.ok);
  if (badJoin) return { ok: false, reason: badJoin.reason as string };
  const unit = makeUnit(room, rows);
  return {
    ok: true,
    rows,
    baseSeats: unit.base,
    maxSeats:
      unit.base +
      unit.headerRoom +
      MAX_EXTENDERS_PER_ROW * SEATS_PER_EXTENDER * unit.extendableRows +
      (unit.extendableRows ? unit.spareSlots * 2 : 0),
  };
}

export interface FitOptions {
  /** Only private event rooms (a "private feel" request). */
  privateOnly?: boolean;
  /** Latest arrival time to try when the requested time does not fit (default 22:00). */
  latest?: string;
  /** Only these floor tables (a manager's table range); the reason names it as `tablesLabel`. */
  tables?: readonly string[];
  /** How the reason names the range, e.g. "in tables 30–50". */
  tablesLabel?: string;
}

/** Later arrivals a request's fit check tries (15-minute steps). */
export const MAX_FIT_STEPS = 12;

export type RequestFit =
  | { ok: true; build: Build; plan: BuildPlan }
  | {
      ok: false;
      /** One line, e.g. "No private-room set for 30 is free at 19:30 — earliest 20:30." */
      reason: string;
      /** Earliest arrival (15-minute steps) that would fit without moving any booking, if any. */
      nextFit: string | null;
      plan: BuildPlan;
    };

/**
 * Can one more large party (a request above the online cap) be built tonight without bumping a booking?
 * Plans the book with and without the request: it fits when the planner places it and still places every
 * booking it placed before (their tables may change; their seats may not). Read-only. When it cannot fit,
 * says why in one line and finds the earliest later arrival (15-minute steps) that would.
 */
export function fitRequest(
  room: Room,
  r: Reservation,
  from: string,
  to: string,
  opts: FitOptions = {},
): RequestFit {
  const book = room.reservations.filter((x) => x.id !== r.id);
  const before = planBuilds({ ...room, reservations: book }, from, to);
  const placedBefore = new Set(before.builds.map((b) => b.reservationId));
  const latest = opts.latest ?? "22:00";
  const attempt = (time: string): BuildPlan | undefined => {
    const at = { ...r, time };
    const plan = planBuilds({ ...room, reservations: [...book, at] }, from, time > to ? time : to, {
      privateOnly: opts.privateOnly ? [r.id] : [],
      onlyTables: opts.tables ? { [r.id]: opts.tables } : undefined,
    });
    const placed = new Set(plan.builds.map((b) => b.reservationId));
    return placed.has(r.id) && [...placedBefore].every((id) => placed.has(id)) ? plan : undefined;
  };
  const plan = attempt(r.time);
  const build = plan?.builds.find((b) => b.reservationId === r.id);
  if (plan && build) return { ok: true, build, plan };

  // At most MAX_FIT_STEPS more plans (each tens of ms on a 95-table night) — bounded for the client.
  let nextFit: string | null = null;
  const stop = Math.min(toMinutes(latest), toMinutes(r.time) + 15 * MAX_FIT_STEPS);
  for (let m = toMinutes(r.time) + 15; m <= stop; m += 15) {
    if (attempt(toHHMM(m))) {
      nextFit = toHHMM(m);
      break;
    }
  }
  const what = `${opts.privateOnly ? "private-room set" : "table set"}${
    opts.tables ? ` ${opts.tablesLabel ?? "in that range"}` : ""
  }`;
  const needs = r.needs.length ? ` (${r.needs.join(", ")})` : "";
  const allowed = opts.tables ? new Set(opts.tables) : null;
  const units = buildUnits(room).filter(
    (u) =>
      meetsNeeds(u.tables, r.needs) &&
      (!opts.privateOnly || u.areas.every((a) => areaByName(room, a)?.kind === "private")) &&
      (!allowed || u.tables.every((t) => allowed.has(t.id))),
  );
  const largest = Math.max(0, ...units.map(maxSeats));
  const reason =
    largest < r.partySize
      ? `No ${what}${needs} seats ${r.partySize}, even with storage (largest: ${largest}).`
      : `No ${what} for ${r.partySize}${needs} is free at ${r.time} without bumping a booking${
          nextFit ? ` — earliest ${nextFit}` : " — none later tonight"
        }.`;
  return { ok: false, reason, nextFit, plan: before };
}
