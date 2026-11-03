import { PHASES } from "../../domain";
import { PHASE_LABEL } from "../lib/service";
import { PHASE_FILL, STATUS_STYLE } from "./colors";

function Swatch({ fill, stroke, hatch }: { fill: string; stroke: string; hatch?: boolean }) {
  return (
    <span
      className={hatch ? "swatch swatch-hatch" : "swatch"}
      style={hatch ? { borderColor: stroke } : { background: fill, borderColor: stroke }}
      aria-hidden="true"
    />
  );
}

export function Legend() {
  return (
    <div className="legend small" aria-label="Legend">
      <div className="legend-group">
        <span className="legend-title">Status</span>
        <span className="legend-item">
          <Swatch fill={STATUS_STYLE.open.fill} stroke={STATUS_STYLE.open.stroke} /> Open
        </span>
        <span className="legend-item">
          <Swatch fill={STATUS_STYLE.reserved.fill} stroke={STATUS_STYLE.reserved.stroke} />{" "}
          Reserved
        </span>
        <span className="legend-item">
          <Swatch fill="" stroke={STATUS_STYLE.blocked.stroke} hatch /> Blocked
        </span>
      </div>
      <div className="legend-group">
        <span className="legend-title">Seated · meal phase</span>
        {PHASES.map((p, i) => (
          <span key={p} className="legend-item">
            <Swatch fill={PHASE_FILL[p]} stroke="#1b3640" /> {PHASE_LABEL[p]}
            <span className="pips" aria-hidden="true">
              {PHASES.map((q, j) => (
                <span key={q} className={j <= i ? "pip on" : "pip"} />
              ))}
            </span>
          </span>
        ))}
      </div>
      <div className="legend-group">
        <span className="legend-item">
          <span className="swatch swatch-selected" aria-hidden="true" /> Selected
        </span>
        <span className="legend-item">
          <span className="swatch swatch-lit" aria-hidden="true" /> Recommended / build
        </span>
        <span className="legend-item">
          <span className="swatch swatch-combo" aria-hidden="true" /> Combined
        </span>
        <span className="legend-item">
          <span className="swatch swatch-diamond" aria-hidden="true" /> Diamond 4-top
        </span>
        <span className="legend-item">
          <span className="swatch swatch-section" aria-hidden="true">
            1
          </span>{" "}
          Server section
        </span>
        <span className="legend-item">
          <span className="load-chip" aria-hidden="true">
            3 just sat
          </span>{" "}
          Tables sat in the last few minutes
        </span>
        <span className="legend-item">
          <span className="wall" aria-hidden="true" /> Divider closed
        </span>
        <span className="legend-item">
          <span className="wall is-open" aria-hidden="true" /> Divider opened by build
        </span>
        <span className="legend-item">
          <span className="swatch swatch-station" aria-hidden="true" /> Station / bar (no tables)
        </span>
      </div>
    </div>
  );
}
