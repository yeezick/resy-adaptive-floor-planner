import {
  clock12,
  acceptLine,
  buildMinutes,
  coverTrade,
  DECLINE_LINE,
  type Build,
  type PartyFit,
} from "../../domain";
import { partyName } from "../lib/names";

/**
 * Capacity fit + cost for one large party: yes vs no in covers, crew build time, hold, server section(s) and
 * the aisle check. Solver output only; every estimate is labelled "est.".
 */
export function PartyFitCard({
  f,
  build,
  title,
  focus,
  onHover,
}: {
  f: PartyFit;
  /** The party's build, for the crew time ("Build time ~15 min (est.)"). */
  build?: Build;
  title?: string;
  focus?: boolean;
  onHover?: (on: boolean) => void;
}) {
  const a = f.aisle;
  const trade = coverTrade(f.partySize, f.hold.coversLost);
  const hover = onHover
    ? {
        tabIndex: 0,
        onMouseEnter: () => onHover(true),
        onMouseLeave: () => onHover(false),
        onFocus: () => onHover(true),
        onBlur: () => onHover(false),
      }
    : {};
  return (
    <li className={`fit-card${focus ? " is-focus" : ""}`} {...hover}>
      <div className="fit-head">
        <strong>{title ?? partyName(f.reservationId)}</strong>
        <span className="muted">
          party of {f.partySize} · {clock12(f.time)} · {f.area}
        </span>
        {focus && <span className="pill pill-accent">just accepted</span>}
      </div>
      <dl className="fit-grid small">
        <dt>Yes vs no</dt>
        <dd className="trade">
          <span className={trade.net < 0 ? "warn-text" : undefined}>
            <strong>{acceptLine(trade)}</strong>
          </span>
          <span className="muted">{DECLINE_LINE}</span>
        </dd>
        {build && (
          <>
            <dt>Crew</dt>
            <dd>Build time ~{buildMinutes(build)} min (est.)</dd>
          </>
        )}
        <dt>Hold</dt>
        <dd>
          {f.hold.tables.length ? (
            f.hold.runs.map((r, i) => (
              <span key={r.from}>
                {i > 0 && " · "}
                {r.byArea.join(" · ")} held from <strong>{clock12(r.from)}</strong>
              </span>
            ))
          ) : (
            <>
              spare tables only held from <strong>{clock12(f.hold.from)}</strong>
            </>
          )}{" "}
          · {f.hold.slotsBlocked} slot
          {f.hold.slotsBlocked === 1 ? "" : "s"} blocked ·{" "}
          <strong className={f.hold.coversLost ? "warn-text" : undefined}>
            ~{f.hold.coversLost} covers lost (est.)
          </strong>
        </dd>
        <dt>Section</dt>
        <dd className={f.spansSections ? "warn-text" : undefined}>
          {f.sections.length > 1 ? "Sections " : "Section "}
          {f.sections.join(" + ")}
          {f.spansSections && " — spans two servers' sections"}
        </dd>
        <dt>Aisle</dt>
        <dd>
          {a.minIn === null ? (
            <span className="muted">no aisle data for this venue</span>
          ) : a.checked.length === 0 ? (
            <span>no joins · nothing narrows the aisle</span>
          ) : (
            <span className={a.ok ? "ok-text" : "warn-text"}>
              {a.ok ? "✓" : "✗"} {a.checked.length} join{a.checked.length === 1 ? "" : "s"}{" "}
              {a.ok ? "clear" : "fail"} · narrowest {a.narrowestIn} in (min {a.minIn})
            </span>
          )}
          {a.spareEndIn !== null && (
            <span className="muted"> · spare table at row end leaves {a.spareEndIn} in</span>
          )}
          {a.rejected.map((r) => (
            <div key={r.tables.join()} className="fit-reject">
              Rejected: {r.reason}
            </div>
          ))}
        </dd>
      </dl>
    </li>
  );
}
