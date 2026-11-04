// Which tables an accepted large-party plan holds on a night, and when — derived on the client from the
// accepted requests and the solver's capacity fit. A held table is never given a "blocked" status.
import { partyFits } from "../../domain";
import { checkRequest, SERVICE, toReservation } from "../../domain/requests";
import type { Room } from "../../domain";
import { decisionOf, type RequestsState } from "../requests/store";
import { surname } from "./names";

export interface PlanHold {
  name: string;
  partySize: number;
  from: string;
  until: string;
}

export function planHolds(
  room: Room,
  s: Pick<RequestsState, "book" | "decisions">,
): Map<string, PlanHold> {
  const out = new Map<string, PlanHold>();
  for (const r of s.book?.requests ?? []) {
    if (r.bookRoomId !== room.id) continue;
    const d = decisionOf(s, r.id);
    if (d.kind !== "accepted") continue;
    const without = { ...room, reservations: room.reservations.filter((x) => x.id !== r.id) };
    const fit = checkRequest(without, r);
    if (!fit.ok) continue;
    const cost = partyFits(
      { ...without, reservations: [...without.reservations, toReservation(r)] },
      fit.plan.builds,
      SERVICE.from,
      { privateOnly: r.privateRoom ? [r.id] : [] },
    ).find((f) => f.reservationId === r.id);
    if (!cost) continue;
    for (const id of d.tables)
      out.set(id, {
        name: surname(r.contact),
        partySize: r.partySize,
        from: cost.hold.from,
        until: cost.hold.until,
      });
  }
  return out;
}
