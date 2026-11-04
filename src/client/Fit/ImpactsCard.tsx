import { bookedVsWalkIns, capacityLine, coverTrade, type PartyFit, times12 } from "../../domain";

/**
 * Saying yes, in covers, as a host reads it: the party is booked (guaranteed); the hold costs walk-in capacity,
 * which turns into covers only if every held seat would have turned. Solver output only. A capacity fit never
 * cancels a booking (every booking keeps a table, or there is no fit), so "cancelled" is 0 whenever this shows.
 * The "Take it" rule sits on the request card itself, above the rating row.
 */
export function CoversSummary({ f, moved }: { f: PartyFit; moved: number }) {
  const trade = coverTrade(f.partySize, f.hold.coversLost);
  const cancelled = 0;
  return (
    <div className="covers-summary field-value">
      <p className="impacts-net">
        <strong className="net-hero">{bookedVsWalkIns(trade)}</strong>
        {f.hold.tables.length > 0 && (
          <span className="net-held"> · held {times12(`${f.hold.from}–${f.hold.until}`)}</span>
        )}
      </p>
      <p className="capacity-line small muted">{capacityLine(trade, moved, cancelled)}</p>
    </div>
  );
}
