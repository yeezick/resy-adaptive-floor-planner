// Aisle / egress clearance for joins. Pushing tables together (and adding a spare table at a row end) makes a
// long table that can narrow the aisle beside it. The venue's fixture records, per joinable pair, the inches of
// aisle left when that pair is joined; a join below the minimum is rejected with a reason.
// Kept beside the room schema rather than in it (the schema is human-tier); keyed by venue name.
import { z } from "zod";
import venueJson from "../../fixtures/clearance/juniper-and-pine.json";
import type { Room } from "./types";
import { tableNo } from "./wording";

export const Clearance = z
  .object({
    venue: z.string().min(1),
    /** Minimum aisle the venue keeps clear (inches). */
    minAisleIn: z.number().positive(),
    source: z.string(),
    /** "T43|T44" → inches of aisle left beside that pair when joined. */
    joins: z.record(z.string().regex(/^T\d+\|T\d+$/), z.number().nonnegative()),
    /** Why a short join is short (shown with the rejection). */
    notes: z.record(z.string(), z.string()).default({}),
    /**
     * Inches left when a spare table from storage is added at a row end, per area. Informational (shown on
     * the fit card): spare-table placement is already limited by each area's spareSlots floor space.
     */
    spareEnds: z.record(z.string(), z.number().nonnegative()).default({}),
  })
  .strict();
export type Clearance = z.infer<typeof Clearance>;

export const VENUE_CLEARANCE: Clearance = Clearance.parse(venueJson);

/** The clearance data for this room's venue, or null when there is none (no aisle check). */
export function clearanceFor(room: Room): Clearance | null {
  return room.name === VENUE_CLEARANCE.venue ? VENUE_CLEARANCE : null;
}

export interface JoinCheck {
  pair: [string, string];
  clearanceIn: number | null;
  ok: boolean;
  /** Set when the join fails: one line naming the pair, the inches and the minimum. */
  reason?: string;
}

const key = (a: string, b: string) => `${a}|${b}`;

/** Clearance of one join; null when the fixture has no measurement (treated as failing: unknown ≠ safe). */
export function joinClearance(c: Clearance, a: string, b: string): number | null {
  return c.joins[key(a, b)] ?? c.joins[key(b, a)] ?? null;
}

export function checkJoin(c: Clearance, a: string, b: string): JoinCheck {
  const inches = joinClearance(c, a, b);
  const ok = inches !== null && inches >= c.minAisleIn;
  const note = c.notes[key(a, b)] ?? c.notes[key(b, a)];
  return {
    pair: [a, b],
    clearanceIn: inches,
    ok,
    reason: ok
      ? undefined
      : inches === null
        ? `joining tables ${tableNo(a)} and ${tableNo(b)}: no aisle measurement on file — not joined until someone measures it`
        : `joining tables ${tableNo(a)} and ${tableNo(b)} leaves ${inches} in of aisle (needs ${c.minAisleIn} in)${note ? ` — ${note}` : ""}`,
  };
}

/** Every join inside these rows (pairs that are joinable neighbours in the room). */
export function rowJoins(room: Room, rows: readonly (readonly string[])[]): [string, string][] {
  const out: [string, string][] = [];
  for (const row of rows) {
    const set = new Set(row);
    for (const [a, b] of room.joins) if (set.has(a) && set.has(b)) out.push([a, b]);
  }
  return out;
}

export function checkRows(
  c: Clearance,
  room: Room,
  rows: readonly (readonly string[])[],
): JoinCheck[] {
  return rowJoins(room, rows).map(([a, b]) => checkJoin(c, a, b));
}
