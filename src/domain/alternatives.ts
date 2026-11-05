// Answers to "put them in one room" and "bring tables from the back" for one large-party request, from the
// capacity check alone (no model): the planner is re-run per room with that room's tables plus storage, and the
// answer names the result or says plainly that nothing fits. Read-only.
import { fitRequest, type Build } from "./buildplan";
import { SERVICE, toReservation, type GuestRequest } from "./requests";
import type { Room } from "./types";
import { listAnd, storagePhrase, tablesPhrase } from "./wording";

export interface StorageStock {
  /** Spare 4-tops (or larger) in storage tonight. */
  spareTables: number;
  extenders: number;
  chairs: number;
}

export function stockOf(room: Room): StorageStock {
  const inv = room.inventory;
  return {
    spareTables: inv.spareTables.filter((x) => x.seats >= 4).reduce((n, x) => n + x.count, 0),
    extenders: inv.extenders,
    chairs: inv.spareChairs,
  };
}

export type OneRoomPlan =
  | { ok: true; area: string; build: Build }
  /**
   * No single room works: the room that comes closest in seats, and rooms whose check failed for another
   * reason (booked or not free at that time), which are named as "not free" rather than "too small".
   */
  | { ok: false; largest: { area: string; seats: number } | null; busy: string[] };

/**
 * The party in ONE room, its floor tables plus whatever storage adds (spare tables, extenders, chairs), at the
 * requested time. Tries every room with tables; the first fit with the least storage wins.
 */
export function oneRoomPlan(room: Room, r: GuestRequest): OneRoomPlan {
  const res = toReservation(r);
  const areas = [...new Set(room.tables.map((t) => t.area))];
  const fits: { area: string; build: Build }[] = [];
  let largest: { area: string; seats: number } | null = null;
  const busy: string[] = [];
  for (const area of areas) {
    const tables = room.tables.filter((t) => t.area === area).map((t) => t.id);
    // latest = the requested time: no later-arrival search, one plan per room
    const f = fitRequest(room, res, SERVICE.from, SERVICE.to, {
      privateOnly: r.privateRoom,
      tables,
      tablesLabel: `in the ${area}`,
      latest: r.time,
    });
    if (f.ok) {
      if (!f.build.area.includes(" + ")) fits.push({ area, build: f.build });
      continue;
    }
    // the planner's reason names the largest set when seats run short; any other reason means not free then
    const m = /largest: (\d+)/.exec(f.reason);
    if (!m) {
      busy.push(area);
      continue;
    }
    const seats = Number(m[1]);
    if (seats > 0 && (!largest || seats > largest.seats)) largest = { area, seats };
  }
  const best = fits.sort(
    (a, b) =>
      a.build.spareTables + a.build.extenders - (b.build.spareTables + b.build.extenders) ||
      a.build.tables.length - b.build.tables.length,
  )[0];
  return best ? { ok: true, area: best.area, build: best.build } : { ok: false, largest, busy };
}

/**
 * "No single room fits 22 as the floor stands (today's Garden Room tables top out at 20). Ask me to move tables to
 * make one room." — the ceiling counts storage (header chairs, extenders, spare tables), so it is the real limit
 * of the room's tables tonight; moving tables is the way past it.
 */
export function oneRoomSentence(
  r: Pick<GuestRequest, "partySize">,
  plan: OneRoomPlan,
  _current?: { area: string } | null,
): string {
  if (plan.ok) {
    const s = storagePhrase(plan.build);
    return `One room works: ${tablesPhrase(plan.build.tables)} in the ${plan.area}${
      s ? ` with ${s} from storage` : ""
    }, seats ${plan.build.seats}. It's shown on the floor; ask to switch and I'll propose it.`;
  }
  const ceiling = plan.largest
    ? ` (today's ${plan.largest.area} tables top out at ${plan.largest.seats})`
    : "";
  const busy = plan.busy.length
    ? ` ${listAnd(plan.busy)} ${plan.busy.length === 1 ? "isn't" : "aren't"} free at that time.`
    : "";
  return `No single room fits ${r.partySize} as the floor stands${ceiling}.${busy} ${MOVE_OFFER}`;
}

export const MOVE_OFFER = "Ask me to move tables to make one room.";

/**
 * What storage still has once the night's other builds take theirs: "Storage tonight: 4 of 6 spare tables free,
 * 6 of 6 extenders, 32 of 40 chairs." or the plain no ("No spare tables in storage tonight: 0 of 6.").
 */
export function storageSentence(
  stock: StorageStock,
  used: { spareTables: number; extenders: number; extraChairs: number },
): string {
  const free = Math.max(0, stock.spareTables - used.spareTables);
  if (free === 0) return `No spare tables in storage tonight: 0 of ${stock.spareTables}.`;
  const ext = Math.max(0, stock.extenders - used.extenders);
  const chairs = Math.max(0, stock.chairs - used.extraChairs);
  return `Storage tonight: ${free} of ${stock.spareTables} spare tables free, ${ext} of ${stock.extenders} extenders, ${chairs} of ${stock.chairs} chairs.`;
}
