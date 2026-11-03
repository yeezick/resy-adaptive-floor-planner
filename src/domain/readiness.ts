// Readiness for a proposed join: for each table, its meal stage now and roughly how long until it is free (from
// meal phase, so every number is an estimate). The join is ready to set up when its slowest table is free.
import { estimateFreeTime } from "./phases";
import { tableById } from "./room";
import type { Phase, Room, Table } from "./types";

export interface TableReadiness {
  id: string;
  status: Table["status"];
  /** Meal stage for a seated table; null when nobody is sitting there. */
  phase: Phase | null;
  /** Estimated minutes until free: 0 = free now, null = blocked this service. */
  minutes: number | null;
}

export interface JoinReadiness {
  tables: TableReadiness[];
  /** Every table is free now. */
  ready: boolean;
  /** Minutes until the slowest table is free (est.); null when a table is blocked. */
  readyInMin: number | null;
}

/** Readiness of the floor tables in a join (spare tables from storage are always ready, so they're skipped). */
export function joinReadiness(room: Room, ids: readonly string[]): JoinReadiness {
  const tables: TableReadiness[] = [];
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) continue;
    tables.push({
      id,
      status: t.status,
      phase: t.status === "occupied" ? (t.phase ?? "seated") : null,
      minutes: estimateFreeTime(t).minutes,
    });
  }
  const blocked = tables.some((t) => t.minutes === null);
  const readyInMin = blocked ? null : Math.max(0, ...tables.map((t) => t.minutes ?? 0));
  return { tables, ready: readyInMin === 0, readyInMin };
}

/** The bubble on one table: "now" when free, "~25m" until free (est.), "blocked" when it isn't usable. */
export function readinessBadge(t: TableReadiness): string {
  if (t.minutes === null) return "blocked";
  return t.minutes === 0 ? "now" : `~${t.minutes}m`;
}

/** The capacity-fit pill: "capacity fit ✓ · Ready" or "capacity fit ✓ · ready to set up in ~X min". */
export function readinessPill(j: JoinReadiness): string {
  if (j.ready) return "capacity fit ✓ · Ready";
  if (j.readyInMin === null) return "capacity fit ✓ · a table is blocked this service";
  return `capacity fit ✓ · ready to set up in ~${j.readyInMin} min`;
}
