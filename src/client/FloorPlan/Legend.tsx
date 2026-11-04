import { PHASES } from "../../domain";
import { PHASE_ABBR, PHASE_LABEL } from "../lib/service";
import { STATUS_STYLE } from "./colors";

/**
 * The floor's one key, at the top of the floor. A live service shows the meal-phase bar with one line under
 * it; a planning night (nobody seated yet) shows the line with Open · Held only.
 */
export function FloorLegend({ live }: { live: boolean }) {
  return (
    <div className="floor-legend" aria-label="Floor key">
      {live && <PhaseStrip />}
      <p className="legend-line small">
        <span className="legend-item">
          <span
            className="swatch"
            style={{ background: STATUS_STYLE.open.fill, borderColor: STATUS_STYLE.open.stroke }}
            aria-hidden="true"
          />
          Open
        </span>
        <span aria-hidden="true"> · </span>
        <span className="legend-item">
          <span className="swatch swatch-held" aria-hidden="true" />
          Held
        </span>
        {live && (
          <>
            <span aria-hidden="true"> · </span>
            <span>free ~Nm = est. until free</span>
            <span aria-hidden="true"> · </span>
            <span>Dessert/Check amber = about to leave</span>
          </>
        )}
      </p>
    </div>
  );
}

/** The meal-phase words and colours on seated tables. */
export function PhaseStrip() {
  return (
    <div className="phase-strip" aria-label="Meal phase key">
      <span className="phase-strip-title">Meal phase</span>
      {PHASES.map((p) => (
        <span key={p} className={`phase-chip phase-${p}`} title={PHASE_LABEL[p]}>
          {PHASE_ABBR[p]}
          <span className="phase-strip-word"> {PHASE_LABEL[p]}</span>
        </span>
      ))}
    </div>
  );
}
