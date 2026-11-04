import {
  acceptLine,
  buildMinutes,
  coverTrade,
  DECLINE_LINE,
  impactsOf,
  signed,
  type Build,
  type PartyFit,
  times12,
  type Room,
} from "../../domain";

/**
 * Impacts of saying yes to one large party: pros and cons side by side, then the net covers line and the crew's
 * build time. Solver output only; estimates say "est.". A negative net is shown as it is.
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
  const trade = coverTrade(f.partySize, f.hold.coversLost);
  return (
    <div className="impacts" aria-label="Impacts of saying yes">
      <p className="impacts-net">
        <strong className={`net-hero${trade.net < 0 ? " is-neg" : ""}`}>
          Net {signed(trade.net)} covers (est.)
        </strong>
        <span className="net-basis muted small">
          {acceptLine(trade)} · {DECLINE_LINE}
        </span>
      </p>
      <h4 className="impacts-title small">Impacts of saying yes</h4>
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
      <p className="small">Crew: build time ~{buildMinutes(build)} min (est.)</p>
    </div>
  );
}
