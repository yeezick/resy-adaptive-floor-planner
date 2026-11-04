import { useEffect, useRef } from "react";
import {
  checkTableSet,
  combinedSeats,
  comboOf,
  estimateFreeTime,
  REMAINING_MIN,
  RESET_MIN,
  tableById,
  type Room,
  type Table,
} from "../../domain";
import type { Recommendation } from "../../shared/api";
import { dividersForTables } from "../FloorPlan/geometry";
import { combineStatus } from "../FloorPlan/SelectionBar";
import type { Highlight, HighlightControls } from "../highlight";
import { waitLabel } from "../lib/format";
import { PHASE_LABEL } from "../lib/service";
import type { RecActions } from "./AgentPanel";
import { plainTables, tableNo, tablesPhrase } from "../../domain/wording";
import { times12 } from "../../domain/time";

interface Props {
  rec: Recommendation;
  hlKey: string;
  room: Room;
  highlight: HighlightControls;
  actions: RecActions;
  /** Party size from the host's message, used to pre-fill "Seat party of N". */
  partySize: number;
  /** The first option: its "Select tables" is the view's one filled button. */
  primary?: boolean;
}

function isApplied(room: Room, ids: string[]): boolean {
  const c = comboOf(room, ids[0] ?? "");
  return !!c && c.length === ids.length && ids.every((id) => c.includes(id));
}

/** How the recommended tables are physically set: rows, and seats before storage chairs. */
function layout(room: Room, ids: string[]): { rows: string[][]; base: number } {
  const check = checkTableSet(room, ids);
  if (check.ok) return { rows: check.rows, base: check.baseSeats };
  const tables = ids.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  return { rows: [ids], base: combinedSeats(tables) };
}

/**
 * The wait with its basis, from the slowest seated table in the option: "~11 min est. (check ~6 + reset 5)".
 * The basis is shown only when it adds up to the option's wait.
 */
export function waitText(room: Room, rec: Pick<Recommendation, "tables" | "waitMin">): string {
  if (rec.waitMin === 0) return waitLabel(0);
  const slowest = rec.tables
    .map((id) => tableById(room, id))
    .filter((t): t is Table => !!t && t.status === "occupied")
    .sort((a, b) => REMAINING_MIN[b.phase ?? "seated"] - REMAINING_MIN[a.phase ?? "seated"])[0];
  const left = slowest ? REMAINING_MIN[slowest.phase ?? "seated"] : null;
  const basis =
    slowest && left !== null && left + RESET_MIN === rec.waitMin
      ? ` (${PHASE_LABEL[slowest.phase ?? "seated"].toLowerCase()} ~${left} + reset ${RESET_MIN})`
      : "";
  return `~${rec.waitMin} min est.${basis}`;
}

export function RecommendationCard({
  rec,
  hlKey,
  room,
  highlight,
  actions,
  partySize,
  primary = false,
}: Props) {
  const unknown = rec.tables.filter((id) => !tableById(room, id));
  const { rows, base } = layout(room, rec.tables);
  const extraChairs = unknown.length ? 0 : Math.max(0, rec.seats - base);
  const dividers = dividersForTables(room, rec.tables);
  const h: Highlight = {
    key: hlKey,
    ids: rec.tables,
    label: `AI option ${rec.rank}: ${rows.map((r) => tablesPhrase(r)).join(" | ")}`,
    dividers,
    source: "ai",
    // each table's own countdown on the floor (amber until free, est.; green when free now)
    badges: Object.fromEntries(
      rec.tables.flatMap((id) => {
        const t = tableById(room, id);
        if (!t || t.status === "blocked") return [];
        const m = estimateFreeTime(t).minutes;
        return m === null ? [] : [[id, m === 0 ? "now" : `~${m}m`]];
      }),
    ),
  };
  const pinned = highlight.pinnedKey === hlKey;
  // the first option is shown on the floor when the answer arrives (the floor scrolls it into view)
  const autoPinned = useRef(false);
  useEffect(() => {
    if (!primary || autoPinned.current || highlight.pinnedKey) return;
    autoPinned.current = true;
    highlight.onTogglePin(h);
    // once per answer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinRows = rows.filter((r) => r.length > 1);
  const applied = joinRows.length > 0 && joinRows.every((r) => isApplied(room, r));
  const problems = applied ? [] : joinRows.map((r) => combineStatus(room, r)).filter((s) => !s.ok);

  return (
    <article
      className={`card rec-card${pinned ? " is-pinned" : ""}`}
      onMouseEnter={() => highlight.onHover(h)}
      onMouseLeave={() => highlight.onHover(null)}
      onFocus={() => highlight.onHover(h)}
      onBlur={() => highlight.onHover(null)}
      aria-label={`Recommendation ${rec.rank}`}
    >
      <header className="rec-head">
        <span className="rank">#{rec.rank}</span>
        <strong>{rows.map((r) => tablesPhrase(r)).join("  |  ")}</strong>
        <span className="muted">
          {rec.seats} seats · {waitText(room, rec)}
        </span>
      </header>
      {(extraChairs > 0 || dividers.length > 0) && (
        <div className="rec-tags">
          {extraChairs > 0 && (
            <span className="pill">
              +{extraChairs} chair{extraChairs === 1 ? "" : "s"} from storage
            </span>
          )}
          {dividers.length > 0 && (
            <span className="pill">
              opens {dividers.length} divider{dividers.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
      {!unknown.length && (
        <p className="rec-check small">Capacity check: capacity fit ✓ · {rec.seats} seats</p>
      )}
      <p className="rec-reason">{times12(plainTables(rec.reasoning))}</p>
      {rec.tradeoffs.length > 0 && (
        <ul className="tradeoffs small">
          {rec.tradeoffs.map((t, i) => (
            <li key={i}>{times12(plainTables(t))}</li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && (
        <p className="warn-text small">Not in this room: {unknown.map(tableNo).join(", ")}</p>
      )}
      <div className="btn-row">
        <button
          type="button"
          className={primary ? "primary" : undefined}
          disabled={unknown.length > 0}
          title={`Opens the walk-in sheet with these tables picked; you confirm the seat`}
          onClick={() => actions.onSelectTables(rec.tables, partySize)}
        >
          Select tables
        </button>
        <button type="button" aria-pressed={pinned} onClick={() => highlight.onTogglePin(h)}>
          {pinned ? "Hide on floor" : "Show on floor"}
        </button>
        {rows.length > 1 && (
          <button type="button" onClick={actions.onOpenShift}>
            Open shift setup
          </button>
        )}
        {joinRows.length > 0 &&
          (applied ? (
            <span className="ok-text small">Combined on the floor ✓</span>
          ) : (
            <button
              type="button"
              disabled={problems.length > 0}
              title={problems[0]?.text ?? "Push these tables together (you can split later)"}
              onClick={() => actions.onApplyRows(joinRows)}
            >
              {joinRows.length > 1 ? `Apply combine (${joinRows.length} rows)` : "Apply combine"}
            </button>
          ))}
      </div>
      {problems[0] && <p className="muted small">Can't combine: {problems[0].text}</p>}
    </article>
  );
}
