// Where a table may stand tonight. Each table has a home position on the base layout; besides those, the venue
// lists a few extra spots per room (a second row in the Garden Room, a round spot in the Library, one spare spot
// per room's storage floor space). A floor edit moves tables only onto free spots — a listed one or a home
// position another table has left — so every aisle beside a moved table is a measured one.
// Kept beside the room schema rather than in it (the schema is human-tier); keyed by venue name, like clearance.
import { z } from "zod";
import spotsJson from "../../fixtures/spots/juniper-and-pine.json";
import { Clearance, clearanceFor } from "./clearance";
import { TableAttrs, type Room, type Table } from "./types";

export const Spot = z
  .object({
    id: z.string().min(1),
    /** The room (area name) the spot is in. */
    room: z.string().min(1),
    /** How crew steps name it: "Garden Room back row". */
    label: z.string().min(1),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    /** "square": rect and diamond tables up to its size · "round": round tables up to its size. */
    fits: z.enum(["square", "round"]),
    /** A spare spot (storage floor space): filling one uses one of the room's spareSlots. */
    spare: z.boolean().default(false),
    attrs: TableAttrs,
    maxExtraChairs: z.number().int().min(0).max(2),
    /** Spots in one row stand side by side; neighbours in a row may be joined. */
    row: z.string().nullable(),
  })
  .strict();
export type Spot = z.infer<typeof Spot>;

const Home = z.tuple([
  z.string(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.enum(["rect", "diamond", "round", "booth"]),
]);

export const VenueSpots = z
  .object({
    venue: z.string().min(1),
    source: z.string(),
    spots: z.array(Spot),
    /** "GR-B1|GR-B2" → inches of aisle left beside the tables on that pair of spots when joined. */
    pairs: z.record(z.string().regex(/^[A-Z0-9-]+\|[A-Z0-9-]+$/), z.number().nonnegative()),
    homesSource: z.string(),
    /** Table id → its home on the base layout: [room, x, y, w, h, shape]. */
    homes: z.record(z.string().regex(/^T\d+$/), Home),
  })
  .strict();
export type VenueSpots = z.infer<typeof VenueSpots>;

export const VENUE_SPOTS: VenueSpots = VenueSpots.parse(spotsJson);

/** The spots data for this room's venue, or null (no floor edits there). */
export function spotsFor(room: Room): VenueSpots | null {
  return room.name === VENUE_SPOTS.venue ? VENUE_SPOTS : null;
}

const NEAR = 0.25;
const at = (t: { x: number; y: number }, x: number, y: number) =>
  Math.abs(t.x - x) < NEAR && Math.abs(t.y - y) < NEAR;

/** A table's home on the base layout. */
export interface HomeSpot {
  tableId: string;
  room: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: Table["shape"];
}

export function homeOf(v: VenueSpots, id: string): HomeSpot | null {
  const h = v.homes[id];
  if (!h) return null;
  const [room, x, y, w, h2, shape] = h;
  return { tableId: id, room, x, y, w, h: h2, shape };
}

export function allHomes(v: VenueSpots): HomeSpot[] {
  return Object.keys(v.homes).map((id) => homeOf(v, id) as HomeSpot);
}

/**
 * What a table's position stands for: a listed spot ("spot:GR-B1"), the home position of a base table
 * ("T64" — its own, or one another table has left), or nothing on file (its own id: today's behaviour).
 */
export function positionOf(
  v: VenueSpots,
  t: Table,
): { kind: "spot" | "home" | "own"; key: string } {
  const spot = v.spots.find((s) => s.room === t.area && at(t, s.x, s.y));
  if (spot) return { kind: "spot", key: spot.id };
  const own = homeOf(v, t.id);
  if (own && own.room === t.area && at(t, own.x, own.y)) return { kind: "home", key: t.id };
  for (const h of allHomes(v))
    if (h.tableId !== t.id && h.room === t.area && at(t, h.x, h.y) && h.w === t.w && h.h === t.h)
      return { kind: "home", key: h.tableId };
  return { kind: "own", key: t.id };
}

const pairKey = (a: string, b: string) => `${a}|${b}`;

/**
 * Aisle data for the floor as it stands, decided per joined pair by POSITION (never by a new Table field):
 * - a table on a listed spot → the spots data for that pair of spots (none → unmeasured, which fails);
 * - a table on another table's vacated home → that table's measurement with the neighbour;
 * - otherwise → today's value by table ids (so crew-plan and editor layouts plan exactly as before).
 * Returns the venue's clearance with its join table re-keyed for this floor; null when the venue has none.
 */
export function clearanceForLayout(room: Room): Clearance | null {
  const base = clearanceFor(room);
  if (!base) return null;
  const v = spotsFor(room);
  if (!v) return base;
  const cached = memo.get(room);
  if (cached !== undefined) return cached;
  const pos = new Map<string, ReturnType<typeof positionOf>>();
  for (const t of room.tables) pos.set(t.id, positionOf(v, t));
  const moved = (id: string) => {
    const p = pos.get(id);
    return !!p && p.key !== id;
  };
  if (![...pos.keys()].some(moved)) {
    memo.set(room, base);
    return base;
  }
  // drop the ids-keyed value of every pair with a moved table, then set what its position says
  const stale = new Set<string>();
  for (const [a, b] of room.joins)
    if (moved(a) || moved(b)) stale.add(pairKey(a, b)).add(pairKey(b, a));
  const joins: Record<string, number> = Object.fromEntries(
    Object.entries(base.joins).filter(([k]) => !stale.has(k)),
  );
  for (const [a, b] of room.joins) {
    if (!moved(a) && !moved(b)) continue;
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (!pa || !pb) continue;
    let inches: number | undefined;
    if (pa.kind === "spot" && pb.kind === "spot")
      inches = v.pairs[pairKey(pa.key, pb.key)] ?? v.pairs[pairKey(pb.key, pa.key)];
    else if (pa.kind !== "spot" && pb.kind !== "spot")
      inches = base.joins[pairKey(pa.key, pb.key)] ?? base.joins[pairKey(pb.key, pa.key)];
    if (inches !== undefined) joins[pairKey(a, b)] = inches;
  }
  const out = Clearance.parse({ ...base, joins });
  memo.set(room, out);
  return out;
}

const memo = new WeakMap<Room, Clearance | null>();
