// Fit + cost for each large party in a plan: the hold (which tables, from when, covers lost), the server
// section(s) it lands in, and the aisle check on every join. Pure and deterministic — the numbers a manager
// weighs before saying yes, from the solver's plan (never from a model).
import { aisleRejects, BUILD_LEAD_MIN, type AisleReject, type Build } from "./buildplan";
import { TURN_MIN } from "./capacity";
import { checkRows, clearanceFor, type Clearance, type JoinCheck } from "./clearance";
import { tableById } from "./room";
import { tableNumbers } from "./wording";
import { toHHMM, toMinutes } from "./time";
import type { Room, Table } from "./types";

export interface Hold {
  /** Floor tables held for the party (spare tables from storage are extra, so they cost nothing). */
  tables: string[];
  /** The same tables by room, as runs: "Garden Room tables 57–61". */
  byArea: string[];
  /** When the first of the tables stops taking new bookings (the earliest of `runs`). */
  from: string;
  /**
   * The tables grouped by when each one's hold starts, earliest first. A table an earlier party is still
   * seated at is held only from when that party leaves, so one party's tables can start at different times.
   */
  runs: { from: string; tables: string[]; byArea: string[] }[];
  /** The party's arrival. */
  until: string;
  seats: number;
  /** 15-minute booking slots the hold closes on those tables, before the build starts. */
  slotsBlocked: number;
  /** Seats × time blocked ÷ one turn: the covers those tables would typically have served. */
  coversLost: number;
}

export interface PartyFit {
  reservationId: string;
  partySize: number;
  time: string;
  area: string;
  tables: string[];
  hold: Hold;
  sections: number[];
  /** A join that spans two server sections needs both servers (or one covering both). */
  spansSections: boolean;
  aisle: {
    checked: JoinCheck[];
    ok: boolean;
    narrowestIn: number | null;
    minIn: number | null;
    /** Spare tables from storage at a row end: the aisle left there. */
    spareEndIn: number | null;
    /** Sets that would have seated the party but failed the aisle check. */
    rejected: AisleReject[];
  };
}

export const SLOT_MIN = 15;

/**
 * Hold for one build. Tables are held from (build start − one turn), clamped to the start of service and to
 * when an earlier large party on the same tables leaves (that time is already spoken for, not lost).
 */
export function holdFor(
  room: Room,
  b: Build,
  serviceFrom: string,
  earlier: readonly Build[],
): Hold {
  const buildStart = toMinutes(b.time) - BUILD_LEAD_MIN;
  const tables = b.tables.filter((id) => tableById(room, id));
  let seats = 0;
  let seatMinutes = 0;
  let from = buildStart;
  let slots = 0;
  const startOf = new Map<string, number>();
  for (const id of tables) {
    const t = tableById(room, id) as Table;
    const prior = earlier
      .filter((e) => e.tables.includes(id) && toMinutes(e.time) < toMinutes(b.time))
      .map((e) => toMinutes(e.time) + TURN_MIN);
    const start = Math.min(
      buildStart,
      Math.max(toMinutes(serviceFrom), buildStart - TURN_MIN, ...prior),
    );
    from = Math.min(from, start);
    startOf.set(id, start);
    seats += t.seats;
    seatMinutes += t.seats * (buildStart - start);
    slots = Math.max(slots, Math.floor((buildStart - start) / SLOT_MIN));
  }
  const starts = [...new Set(startOf.values())].sort((x, y) => x - y);
  const runs = starts.map((m) => {
    const ids = tables.filter((id) => startOf.get(id) === m);
    return { from: toHHMM(m), tables: ids, byArea: tablesByArea(room, ids) };
  });
  return {
    tables,
    byArea: tablesByArea(room, tables),
    from: toHHMM(from),
    runs,
    until: b.time,
    seats,
    slotsBlocked: slots,
    coversLost: Math.round(seatMinutes / TURN_MIN),
  };
}

/** "T57, T58, T59, T63" → "57–59 and 63" (consecutive numbers collapse to a range; no "T" prefix). */
export function tableRuns(ids: readonly string[]): string {
  return tableNumbers(ids);
}

export function tablesByArea(room: Room, ids: readonly string[]): string[] {
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const a = tableById(room, id)?.area ?? "?";
    by.set(a, [...(by.get(a) ?? []), id]);
  }
  return [...by.entries()].map(
    ([a, t]) => `${a} ${t.length === 1 ? "table" : "tables"} ${tableRuns(t)}`,
  );
}

export function partyFit(
  room: Room,
  b: Build,
  serviceFrom: string,
  earlier: readonly Build[],
  opts: { clearance?: Clearance | null; privateOnly?: boolean } = {},
): PartyFit {
  const c = opts.clearance === undefined ? clearanceFor(room) : opts.clearance;
  const sections = [
    ...new Set(b.tables.map((id) => tableById(room, id)?.section).filter((x) => x !== undefined)),
  ].sort((x, y) => x - y);
  const checked = c ? checkRows(c, room, b.rows) : [];
  const inches = checked.map((j) => j.clearanceIn).filter((x): x is number => x !== null);
  const r = room.reservations.find((x) => x.id === b.reservationId) ?? {
    id: b.reservationId,
    time: b.time,
    partySize: b.partySize,
    needs: [],
  };
  const spareArea = b.area.split(" + ").find((a) => c?.spareEnds[a] !== undefined);
  return {
    reservationId: b.reservationId,
    partySize: b.partySize,
    time: b.time,
    area: b.area,
    tables: b.tables,
    hold: holdFor(room, b, serviceFrom, earlier),
    sections,
    spansSections: sections.length > 1,
    aisle: {
      checked,
      ok: checked.every((j) => j.ok),
      narrowestIn: inches.length ? Math.min(...inches) : null,
      minIn: c?.minAisleIn ?? null,
      spareEndIn: b.spareTables && spareArea && c ? (c.spareEnds[spareArea] ?? null) : null,
      rejected: aisleRejects(room, r, {
        clearance: c,
        privateOnly: opts.privateOnly,
        chosen: b.tables,
      }),
    },
  };
}

/** Fit + cost for every placed party in a plan, in arrival order. */
export function partyFits(
  room: Room,
  builds: readonly Build[],
  serviceFrom: string,
  opts: { privateOnly?: readonly string[] } = {},
): PartyFit[] {
  const sorted = [...builds].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const priv = new Set(opts.privateOnly ?? []);
  return sorted.map((b, i) =>
    partyFit(room, b, serviceFrom, sorted.slice(0, i), { privateOnly: priv.has(b.reservationId) }),
  );
}

/** When the hold on one table starts ("19:00"), or null when the party doesn't hold it. */
export function holdStartFor(h: Hold, id: string): string | null {
  return h.runs.find((r) => r.tables.includes(id))?.from ?? null;
}

export interface HoldConflict {
  table: string;
  /** The party whose hold (or setup) starts too early. */
  reservationId: string;
  from: string;
  /** The earlier party still seated at the table, and until when (arrival + one turn). */
  seatedId: string;
  seatedUntil: string;
}

/**
 * Holds that start while an earlier party is still seated at the same table (arrival + one turn).
 * Pass `starts` to also check setup starts (the crew rebuild time per party).
 */
export function holdConflicts(
  fits: readonly PartyFit[],
  starts: Readonly<Record<string, string>> = {},
): HoldConflict[] {
  const out: HoldConflict[] = [];
  for (const f of fits) {
    for (const run of f.hold.runs.length
      ? f.hold.runs
      : [{ from: f.hold.from, tables: f.tables, byArea: [] }]) {
      const setup = starts[f.reservationId];
      for (const id of run.tables) {
        const begin = Math.min(
          toMinutes(run.from),
          setup ? toMinutes(setup) : Number.POSITIVE_INFINITY,
        );
        for (const e of fits) {
          if (e === f || !e.tables.includes(id) || toMinutes(e.time) >= toMinutes(f.time)) continue;
          const until = toMinutes(e.time) + TURN_MIN;
          if (begin < until)
            out.push({
              table: id,
              reservationId: f.reservationId,
              from: toHHMM(begin),
              seatedId: e.reservationId,
              seatedUntil: toHHMM(until),
            });
        }
      }
    }
  }
  return out;
}

/** One line for a card: "Held 17:00–19:00 · 6 slots · ~13 covers lost". */
export function holdLine(h: Hold): string {
  return `Held ${h.from}–${h.until} · ${h.slotsBlocked} slot${h.slotsBlocked === 1 ? "" : "s"} blocked · ~${h.coversLost} cover${h.coversLost === 1 ? "" : "s"} lost`;
}
