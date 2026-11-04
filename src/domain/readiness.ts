// Readiness for a proposed join, from meal phase (so every number is an estimate).
//
// Two modes (Cowork lock, 2026-11-03 18:15):
// - A request for now (it arrives within one turn of the floor clock): live minutes until each table is free.
// - A future request: projected to the hold start. Will each table be free when the hold begins?
import { TURN_MIN } from "./capacity";
import { estimateFreeTime } from "./phases";
import { tableById } from "./room";
import { clock12, toHHMM, toMinutes } from "./time";
import type { Phase, Room, Table } from "./types";

export interface TableReadiness {
  id: string;
  status: Table["status"];
  /** Meal stage for a seated table; null when nobody is sitting there. */
  phase: Phase | null;
  /** Estimated minutes until free: 0 = free now, null = blocked this service. */
  minutes: number | null;
  /** Floor time ("HH:MM") the table is free (est.); null when blocked. */
  freeAt: string | null;
}

export interface JoinReadiness {
  tables: TableReadiness[];
  /** The hold start this was projected to ("HH:MM"), or null for a request for now (live minutes). */
  at: string | null;
  /** Live: every table is free now. Projected: every table is free by the hold start. */
  ready: boolean;
  /** Minutes until the slowest table is free (est.); null when a table is blocked. */
  readyInMin: number | null;
  /** Floor time the slowest table is free (est.); null when a table is blocked. */
  readyAt: string | null;
}

/**
 * Which mode a request's readiness uses: null (live minutes) for a request for now, else the hold start it is
 * projected to. "For now" = it arrives within one turn of the floor clock, or its hold has already begun.
 */
export function readinessTarget(
  arrival: string,
  clock: string,
  holdFrom: string | null,
): string | null {
  const now = toMinutes(clock);
  if (toMinutes(arrival) - now <= TURN_MIN) return null;
  if (holdFrom === null || toMinutes(holdFrom) <= now) return null;
  return holdFrom;
}

/**
 * Readiness of the floor tables in a join (spare tables from storage are always ready, so they're skipped).
 * `at` = the hold start for a future request, or null for a request for now.
 */
export function joinReadiness(
  room: Room,
  ids: readonly string[],
  at: string | null = null,
): JoinReadiness {
  const now = toMinutes(room.clock);
  const tables: TableReadiness[] = [];
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) continue;
    const minutes = estimateFreeTime(t).minutes;
    tables.push({
      id,
      status: t.status,
      phase: t.status === "occupied" ? (t.phase ?? "seated") : null,
      minutes,
      freeAt: minutes === null ? null : toHHMM(now + minutes),
    });
  }
  const blocked = tables.some((t) => t.minutes === null);
  const readyInMin = blocked ? null : Math.max(0, ...tables.map((t) => t.minutes ?? 0));
  const readyAt = readyInMin === null ? null : toHHMM(now + readyInMin);
  const ready =
    readyInMin !== null && (at === null ? readyInMin === 0 : now + readyInMin <= toMinutes(at));
  return { tables, at, ready, readyInMin, readyAt };
}

/** Is this table ready in the join's mode (free now, or free by the hold start)? */
export function tableReady(t: TableReadiness, j: JoinReadiness): boolean {
  if (t.minutes === null) return false;
  if (!j || j.at === null) return t.minutes === 0;
  return toMinutes(t.freeAt ?? "00:00") <= toMinutes(j.at);
}

/** The live bubble on one table: "now" when free, "~25m" until free (est.), "blocked" when it isn't usable. */
export function readinessBadge(t: TableReadiness): string {
  if (t.minutes === null) return "blocked";
  return t.minutes === 0 ? "now" : `~${t.minutes}m`;
}

/**
 * The bubble on one floor table in the join's mode. Live: as `readinessBadge`. Projected: "free" (by the hold
 * start) or "~5:20 PM" (busy until then). All est.
 */
export function joinBadge(t: TableReadiness, j: JoinReadiness): string {
  if (t.minutes === null || j.at === null) return readinessBadge(t);
  return tableReady(t, j) ? "free" : `~${clock12(t.freeAt ?? "")}`;
}

/** The chip in the sheet's table list: like the bubble, but a full phrase when projected. */
export function readinessChip(t: TableReadiness, j: JoinReadiness): string {
  if (t.minutes === null || j.at === null) return readinessBadge(t);
  return tableReady(t, j)
    ? `free by ${clock12(j.at)}`
    : `busy until ~${clock12(t.freeAt ?? "")} (est.)`;
}

/**
 * The capacity-fit pill. Live: "capacity fit ✓ · Ready" or "… · ready to set up in ~X min". Projected:
 * "capacity fit ✓ · Ready" (every table free by the hold start) or "… · ready to set up at ~5:20 PM".
 */
export function readinessPill(j: JoinReadiness): string {
  if (j.ready) return "capacity fit ✓ · Ready";
  if (j.readyInMin === null) return "capacity fit ✓ · a table is blocked this service";
  if (j.at === null) return `capacity fit ✓ · ready to set up in ~${j.readyInMin} min`;
  return `capacity fit ✓ · ready to set up at ~${clock12(j.readyAt ?? "")}`;
}
