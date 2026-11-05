// What a proposed floor edit does for ONE request: the capacity check re-run on the edited floor (before →
// after: tables, rooms, divider, servers) and every booking whose tables change. Deterministic, read-only.
import { planBuilds, type Build } from "./buildplan";
import { checkAdjusted, type AdjustedFit, type ChatConstraints } from "./requestChat";
import { SERVICE, toReservation, type GuestRequest } from "./requests";
import { tableById } from "./room";
import type { Room } from "./types";
import { tablesPhrase } from "./wording";

export interface EditImpact {
  before: AdjustedFit;
  after: AdjustedFit;
  /** "tables 57–61 and 63–66 · Garden Room + Library (divider open) · two servers (sections 10 + 11)" */
  planBefore: string;
  planAfter: string;
  /** One line per booking whose tables change: "Oduya, C. (12): Library → Dining room · guest not told". */
  bookingsMoved: string[];
}

const COUNT: Record<number, string> = { 2: "two", 3: "three", 4: "four" };

/** Servers a build needs: one per section its tables are in. */
export function sectionsOf(room: Room, tables: readonly string[]): number[] {
  return [
    ...new Set(tables.map((id) => tableById(room, id)?.section).filter((x): x is number => !!x)),
  ].sort((a, b) => a - b);
}

/** One line for the capacity check's plan, or why nothing fits. */
export function planSummary(room: Room, a: AdjustedFit): string {
  if (!a.fit.ok) return a.closest ? `no capacity fit · closest: ${a.closest}` : "no capacity fit";
  const b = a.fit.build;
  const rooms = b.area.split(" + ");
  const s = sectionsOf(room, b.tables);
  const servers =
    s.length === 1
      ? `one server (section ${s[0]})`
      : `${COUNT[s.length] ?? s.length} servers (sections ${s.join(" + ")})`;
  return `${tablesPhrase(b.tables)} · ${
    rooms.length > 1 ? `${b.area} (divider open)` : `${b.area} only`
  } · ${servers}`;
}

function bookedPlan(room: Room, r: GuestRequest, a: AdjustedFit): Build[] {
  const withR = a.fit.ok
    ? {
        ...room,
        reservations: [...room.reservations.filter((x) => x.id !== r.id), toReservation(a.request)],
      }
    : room;
  return planBuilds(withR, SERVICE.from, SERVICE.to).builds.filter((b) => b.reservationId !== r.id);
}

/**
 * The request re-planned on the edited floor. Bookings moved = the night's current plan (with the request as
 * currently planned) before the edit vs after it — not the request's own fit.moved.
 */
export function editImpact(
  room: Room,
  edited: Room,
  r: GuestRequest,
  c: ChatConstraints,
  nameOf: (id: string) => string = (id) => id,
): EditImpact {
  const before = checkAdjusted(room, r, c);
  const after = checkAdjusted(edited, r, c);
  const was = new Map(bookedPlan(room, r, before).map((b) => [b.reservationId, b]));
  const moved: string[] = [];
  for (const b of bookedPlan(edited, r, after)) {
    const a = was.get(b.reservationId);
    if (!a) continue;
    const same = [...a.tables].sort().join() === [...b.tables].sort().join();
    if (same) continue;
    const who = `${nameOf(b.reservationId)} (${b.partySize})`;
    moved.push(
      a.area !== b.area
        ? `${who}: ${a.area} → ${b.area} · guest not told`
        : `${who}: ${tablesPhrase(a.tables)} → ${tablesPhrase(b.tables)}`,
    );
  }
  return {
    before,
    after,
    planBefore: planSummary(room, before),
    planAfter: planSummary(edited, after),
    bookingsMoved: moved,
  };
}
