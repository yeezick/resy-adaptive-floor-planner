// The party on each table, for the small party-size bubble on the floor: seated now, held by an accepted plan,
// or booked by the night's build plan. A table with no party has no entry.
import { useMemo } from "react";
import { planBuilds, toMinutes, type Room, type TonightProposal } from "../../domain";
import { checkRequest, SERVICE, type GuestRequest } from "../../domain/requests";
import type { PlanHold } from "../lib/holds";
import { currentRequest, useRequests } from "../requests/store";

interface PlannedParty {
  partySize: number;
  buildBy: string;
  tables: readonly string[];
}

/**
 * Seated parties win (they are on the table now), then holds of accepted plans, then the build plan (the
 * earliest party on a table that hosts more than one tonight).
 */
export function partiesOnTables(
  room: Room,
  builds: readonly PlannedParty[],
  holds: ReadonlyMap<string, Pick<PlanHold, "partySize">> = new Map(),
): Map<string, number> {
  const ids = new Set(room.tables.map((t) => t.id));
  const out = new Map<string, number>();
  const ordered = [...builds].sort((a, b) => toMinutes(a.buildBy) - toMinutes(b.buildBy));
  for (const b of ordered)
    for (const id of b.tables) if (ids.has(id) && !out.has(id)) out.set(id, b.partySize);
  for (const [id, h] of holds) if (ids.has(id)) out.set(id, h.partySize);
  for (const t of room.tables) {
    if (t.status === "occupied") {
      if (t.partySize) out.set(t.id, t.partySize);
      else out.delete(t.id);
    }
  }
  return out;
}

/**
 * The bubbles for the floor on screen: a crew-plan preview uses its own builds; an open request on its night
 * uses the plan with that request in it (so the 22-top's tables read 22 and a party it moves reads its size on
 * the new tables); otherwise the night's plan with the parties already accepted.
 */
export function usePartiesOnTables(
  room: Room,
  holds: ReadonlyMap<string, PlanHold>,
  opts: { proposal: TonightProposal | null; request: GuestRequest | null },
): Map<string, number> {
  const s = useRequests();
  const accepted = s.accepted[room.id];
  const asked = opts.request && opts.request.bookRoomId === room.id ? opts.request : null;
  const adjust = s.adjust;
  const request = useMemo(
    () => (asked ? currentRequest({ adjust }, asked) : null),
    [asked, adjust],
  );
  const builds = useMemo(() => {
    if (opts.proposal) return opts.proposal.builds;
    const extra = (accepted ?? []).filter((x) => x.id !== request?.id);
    const booked = { ...room, reservations: [...room.reservations, ...extra] };
    try {
      if (request) {
        const fit = checkRequest(booked, request);
        if (fit.ok) return fit.plan.builds;
      }
      return planBuilds(booked, SERVICE.from, SERVICE.to).builds;
    } catch {
      return [];
    }
  }, [opts.proposal, room, accepted, request]);
  return useMemo(
    () => partiesOnTables(opts.proposal?.variant ?? room, builds, holds),
    [opts.proposal, room, builds, holds],
  );
}
