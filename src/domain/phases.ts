import type { Phase, Room, Table } from "./types";

/** Typical minutes left in the meal once a table reaches each phase (synthetic assumption, stated on /evals). */
export const REMAINING_MIN: Record<Phase, number> = {
  seated: 85,
  drinks: 75,
  appetizers: 60,
  entrees: 40,
  dessert: 15,
  check: 6,
};

/** Minutes to bus and reset a table after the party leaves. */
export const RESET_MIN = 5;

/** Phases that mean the table was sat recently and its server is busiest. */
export const FRESH_PHASES: readonly Phase[] = ["seated", "drinks"];

export interface FreeTime {
  tableId: string;
  minutes: number | null; // null = not available this service (blocked)
  basis: string;
}

export function estimateFreeTime(table: Table): FreeTime {
  switch (table.status) {
    case "open":
      return { tableId: table.id, minutes: 0, basis: "open now" };
    case "occupied": {
      const phase = table.phase ?? "seated";
      const minutes = REMAINING_MIN[phase] + RESET_MIN;
      return {
        tableId: table.id,
        minutes,
        basis: `${phase}: ~${REMAINING_MIN[phase]} min left + ${RESET_MIN} min reset`,
      };
    }
    case "reserved":
      return {
        tableId: table.id,
        minutes: 0,
        basis: `open now, held for ${table.reservedAt ?? "a reservation"}`,
      };
    case "blocked":
      return { tableId: table.id, minutes: null, basis: "blocked for this service" };
  }
}

/** Tables in a section that were sat recently (seated or drinks). Higher = a server who is already slammed. */
export function sectionLoad(room: Room, section: number): number {
  return room.tables.filter(
    (t) =>
      t.section === section &&
      t.status === "occupied" &&
      t.phase !== undefined &&
      FRESH_PHASES.includes(t.phase),
  ).length;
}
