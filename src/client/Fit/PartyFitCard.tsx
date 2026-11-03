import type { PartyFit } from "../../domain";

const tablesShort = (ids: string[]) =>
  ids.length > 4
    ? `${ids.slice(0, 2).join(", ")} … ${ids[ids.length - 1]} (${ids.length})`
    : ids.join(", ");

/** Fit + cost for one large party: hold and covers lost, server section(s), aisle check. Solver output only. */
export function PartyFitCard({
  f,
  title,
  focus,
  onHover,
}: {
  f: PartyFit;
  title?: string;
  focus?: boolean;
  onHover?: (on: boolean) => void;
}) {
  const a = f.aisle;
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
        <strong>{title ?? f.reservationId}</strong>
        <span className="muted">
          party of {f.partySize} · {f.time} · {f.area}
        </span>
        {focus && <span className="pill pill-accent">just accepted</span>}
      </div>
      <dl className="fit-grid small">
        <dt>Hold</dt>
        <dd>
          {f.hold.tables.length ? tablesShort(f.hold.tables) : "spare tables only"} held from{" "}
          <strong>{f.hold.from}</strong> · {f.hold.slotsBlocked} slot
          {f.hold.slotsBlocked === 1 ? "" : "s"} blocked ·{" "}
          <strong className={f.hold.coversLost ? "warn-text" : undefined}>
            ~{f.hold.coversLost} covers lost
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
              Rejected {r.reason}
            </div>
          ))}
        </dd>
      </dl>
    </li>
  );
}
