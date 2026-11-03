// Checks every recommendation against room state before it reaches a person. Shared with the eval assertions.
import {
  checkTableSet,
  estimateFreeTime,
  meetsNeeds as domainMeetsNeeds,
  tableById,
  toMinutes,
  TURN_MIN,
  type Need,
  type Room,
  type Table,
} from "../../domain";
import type { Recommendation } from "../../shared/api";

/** Allowed gap between a recommendation's waitMin and estimateFreeTime. */
export const WAIT_TOLERANCE_MIN = 5;

/** The domain's needs check (accessible/quiet = every table; view/stroller = any; booth = one booth). */
export function meetsNeeds(tables: readonly Table[], needs: readonly Need[]): boolean {
  return domainMeetsNeeds(tables, needs);
}

/** Minutes until every table is free (max over tables); null if any is blocked or unknown. */
export function expectedWait(room: Room, ids: readonly string[]): number | null {
  let max = 0;
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) return null;
    const m = estimateFreeTime(t).minutes;
    if (m === null) return null;
    max = Math.max(max, m);
  }
  return max;
}

/** A recommended table that is held for a reservation arriving before this party would finish. */
export function heldTable(room: Room, ids: readonly string[], waitMin: number): Table | undefined {
  const now = toMinutes(room.clock);
  return ids
    .map((id) => tableById(room, id))
    .find(
      (t): t is Table =>
        !!t &&
        t.status === "reserved" &&
        !!t.reservedAt &&
        toMinutes(t.reservedAt) - now < waitMin + TURN_MIN,
    );
}

/** Chairs a walk-in fit may add: the tables' header seats, limited by spare chairs in storage. */
export function headerChairs(room: Room, ids: readonly string[]): number {
  const available = ids.reduce((n, id) => n + (tableById(room, id)?.maxExtraChairs ?? 0), 0);
  return Math.min(available, room.inventory.spareChairs);
}

export interface ValidationProblem {
  /** Position of the recommendation in the array that was validated. */
  index: number;
  rank: number;
  message: string;
}

/** Physical problems with one recommendation's tables (existence, blocked, legal set). */
export function tableProblems(room: Room, ids: readonly string[]): string[] {
  const out: string[] = [];
  const unknown = ids.filter((id) => !tableById(room, id));
  if (unknown.length) out.push(`table(s) not in room state: ${unknown.join(", ")}`);
  const blocked = ids.filter((id) => tableById(room, id)?.status === "blocked");
  if (blocked.length) out.push(`blocked table(s): ${blocked.join(", ")}`);
  if (!unknown.length && new Set(ids).size !== ids.length) out.push("a table is listed twice");
  if (!unknown.length && !blocked.length && ids.length > 1) {
    const c = checkTableSet(room, ids);
    if (!c.ok) out.push(`illegal combine ${ids.join(" + ")}: ${c.reason}`);
  }
  return out;
}

/** The part of a plan_builds party the validator needs. */
export interface BuildRef {
  reservationId: string;
  partySize: number;
  tables: string[];
}

/** What the tools said about the request: the party being fitted, and any planned builds. */
export interface ValidationContext {
  /** From the last find_tables_for_party call, unless a plan_builds call came after it. */
  fit?: { partySize: number; needs: Need[] };
  /** Every party placed by plan_builds; only these may use storage beyond header chairs. */
  builds: BuildRef[];
}

interface ToolLike {
  name: string;
  ok: boolean;
  input: unknown;
  output?: unknown;
}

export function validationContext(tools: readonly ToolLike[]): ValidationContext {
  const ctx: ValidationContext = { builds: [] };
  for (const t of tools) {
    if (!t.ok) continue;
    if (t.name === "find_tables_for_party") {
      const i = t.input as { partySize?: unknown; needs?: unknown };
      if (typeof i.partySize === "number")
        ctx.fit = {
          partySize: i.partySize,
          needs: Array.isArray(i.needs) ? (i.needs as Need[]) : [],
        };
    } else if (t.name === "plan_builds") {
      ctx.fit = undefined;
      // plan_builds returns the compact tonight proposal (`parties`); older transcripts carry `builds`.
      const out = t.output as { parties?: BuildRef[]; builds?: BuildRef[] } | undefined;
      const placed = out?.parties ?? out?.builds;
      if (Array.isArray(placed)) ctx.builds.push(...placed);
    }
  }
  return ctx;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function validateRecommendations(
  room: Room,
  recs: readonly Recommendation[],
  ctx: ValidationContext = { builds: [] },
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const owner = new Map<string, number>();
  const ranks = new Map<number, number>();
  recs.forEach((rec, index) => {
    const add = (message: string) => problems.push({ index, rank: rec.rank, message });
    const dupRank = ranks.get(rec.rank);
    if (dupRank !== undefined) add(`rank ${rec.rank} is used twice`);
    else ranks.set(rec.rank, index);

    const physical = tableProblems(room, rec.tables);
    physical.forEach(add);
    for (const id of rec.tables) {
      const prev = owner.get(id);
      if (prev !== undefined && prev !== index)
        add(`table ${id} is already assigned in recommendation #${prev + 1}`);
      else owner.set(id, index);
    }
    if (physical.length) return;

    const set = checkTableSet(room, rec.tables);
    if (!set.ok) return;
    const tables = rec.tables.map((id) => tableById(room, id) as Table);
    const build = ctx.builds.find((b) => sameSet(b.tables, rec.tables));
    const partySize = build ? build.partySize : ctx.fit?.partySize;
    const needs = build
      ? (room.reservations.find((r) => r.id === build.reservationId)?.needs ?? [])
      : (ctx.fit?.needs ?? []);
    const limit = build ? set.maxSeats : set.baseSeats + headerChairs(room, rec.tables);

    if (rec.seats > limit)
      add(
        build
          ? `claims ${rec.seats} seats but this build seats at most ${set.maxSeats}`
          : `claims ${rec.seats} seats but ${rec.tables.join(" + ")} seat ${set.baseSeats} (+${headerChairs(room, rec.tables)} header chair(s)); storage is only for planned builds`,
      );
    if (partySize !== undefined && rec.seats < partySize)
      add(`${rec.seats} seats is fewer than the party of ${partySize}`);
    if (needs.length && !meetsNeeds(tables, needs)) add(`does not meet: ${needs.join(", ")}`);
    const held = heldTable(room, rec.tables, rec.waitMin);
    if (held) add(`${held.id} is held for a ${held.reservedAt} reservation`);
    const wait = expectedWait(room, rec.tables);
    if (wait !== null && Math.abs(rec.waitMin - wait) > WAIT_TOLERANCE_MIN)
      add(`waitMin ${rec.waitMin} does not match estimate_free_time (${wait} min)`);
  });
  return problems;
}
