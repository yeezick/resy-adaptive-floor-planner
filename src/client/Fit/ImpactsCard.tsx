import {
  bookedVsWalkIns,
  buildMinutes,
  capacityLine,
  coverTrade,
  DECLINE_LINE,
  impactsOf,
  takeItLine,
  type Build,
  type PartyFit,
  times12,
  type Room,
} from "../../domain";

/**
 * Saying yes, in covers, as a host reads it: the party is booked (guaranteed); the hold costs walk-in capacity,
 * which turns into covers only if every held seat would have turned. Solver output only. A capacity fit never
 * cancels a booking (every booking keeps a table, or there is no fit), so "cancelled" is 0 whenever this shows.
 */
export function CoversSummary({ f, moved }: { f: PartyFit; moved: number }) {
  const trade = coverTrade(f.partySize, f.hold.coversLost);
  const cancelled = 0;
  const takeIt = takeItLine(trade, { fit: true, cancelled });
  return (
    <div className="covers-summary">
      <p className="impacts-net">
        <strong className="net-hero">{bookedVsWalkIns(trade)}</strong>
      </p>
      <p className="capacity-line small muted">{capacityLine(trade, moved, cancelled)}</p>
      {takeIt && (
        <p className="take-it small" role="note">
          {takeIt}
        </p>
      )}
    </div>
  );
}

/**
 * Impacts of saying yes to one large party: pros and cons side by side, then the crew's build time and what a
 * decline means. Solver output only; estimates say "est.".
 */
export function ImpactsCard({
  room,
  f,
  build,
  needs,
  moved,
  movedDetail = [],
}: {
  room: Room;
  f: PartyFit;
  build: Build;
  needs: readonly string[];
  moved: readonly string[];
  /** Named moves ("Moves Okafor (10) from tables 63–66 to tables 27–29"), shown in place of the count. */
  movedDetail?: readonly string[];
}) {
  const { pros, cons } = impactsOf(room, { fit: f, needs, moved, movedDetail });
  return (
    <div className="impacts" aria-label="Impacts of saying yes">
      <div className="impacts-cols">
        <div className="impacts-col is-pro">
          <h5 className="small">Pros</h5>
          <ul aria-label="Pros">
            {pros.map((p) => (
              <li key={p}>{times12(p)}</li>
            ))}
          </ul>
        </div>
        <div className="impacts-col is-con">
          <h5 className="small">Cons</h5>
          <ul aria-label="Cons">
            {cons.length ? (
              cons.map((c) => <li key={c}>{times12(c)}</li>)
            ) : (
              <li className="muted">None</li>
            )}
          </ul>
        </div>
      </div>
      <p className="small">
        Crew: build time ~{buildMinutes(build)} min (est.) ·{" "}
        <span className="muted">{DECLINE_LINE}</span>
      </p>
    </div>
  );
}
