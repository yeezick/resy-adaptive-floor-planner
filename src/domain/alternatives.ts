// Answers to "put them in one room" and "bring tables from the back" for one large-party request, from the
// capacity check alone (no model): the planner is re-run per room with that room's tables plus storage, and the
// answer names the result or says plainly that nothing fits. Read-only.
import { fitRequest, type Build } from "./buildplan";
import { SERVICE, toReservation, type GuestRequest } from "./requests";
import type { Room } from "./types";
import { storagePhrase, tablesPhrase } from "./wording";

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
  /** No single room seats the party, even with storage: the room that comes closest. */
  | { ok: false; largest: { area: string; seats: number } | null };

/**
 * The party in ONE room, its floor tables plus whatever storage adds (spare tables, extenders, chairs), at the
 * requested time. Tries every room with tables; the first fit with the least storage wins.
 */
export function oneRoomPlan(room: Room, r: GuestRequest): OneRoomPlan {
  const res = toReservation(r);
  const areas = [...new Set(room.tables.map((t) => t.area))];
  const fits: { area: string; build: Build }[] = [];
  let largest: { area: string; seats: number } | null = null;
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
    const m = /largest: (\d+)/.exec(f.reason);
    const seats = m ? Number(m[1]) : 0;
    if (seats > 0 && (!largest || seats > largest.seats)) largest = { area, seats };
  }
  const best = fits.sort(
    (a, b) =>
      a.build.spareTables + a.build.extenders - (b.build.spareTables + b.build.extenders) ||
      a.build.tables.length - b.build.tables.length,
  )[0];
  return best ? { ok: true, area: best.area, build: best.build } : { ok: false, largest };
}

/** "No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats)." */
export function oneRoomSentence(
  r: Pick<GuestRequest, "partySize">,
  plan: OneRoomPlan,
  current: { area: string } | null,
): string {
  if (plan.ok) {
    const s = storagePhrase(plan.build);
    return `One room works: ${tablesPhrase(plan.build.tables)} in the ${plan.area}${
      s ? ` with ${s} from storage` : ""
    }, seats ${plan.build.seats}. It's shown on the floor; ask to switch and I'll propose it.`;
  }
  const closest = plan.largest
    ? ` (closest: ${plan.largest.area}, ${plan.largest.seats} seats)`
    : "";
  const nearest = current?.area.includes(" + ")
    ? ` The nearest is the current plan: ${current.area} with the divider open.`
    : "";
  return `No single room fits ${r.partySize}, even with tables from storage${closest}.${nearest}`;
}

/**
 * What storage still has once the night's other builds take theirs: "Storage tonight: 4 of 6 spare tables free,
 * 6 extenders, 40 chairs." or the plain no ("No spare tables in storage tonight: 0 of 6.").
 */
export function storageSentence(stock: StorageStock, usedSpare: number): string {
  const free = Math.max(0, stock.spareTables - usedSpare);
  if (free === 0) return `No spare tables in storage tonight: 0 of ${stock.spareTables}.`;
  return `Storage tonight: ${free} of ${stock.spareTables} spare tables free, ${stock.extenders} extenders, ${stock.chairs} chairs.`;
}
