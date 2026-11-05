import { useEffect, useRef } from "react";
import {
  checkTableSet,
  combinedSeats,
  estimateFreeTime,
  REMAINING_MIN,
  RESET_MIN,
  tableById,
  type Room,
  type Table,
} from "../../domain";
import type { Recommendation } from "../../shared/api";
import { dividersForTables } from "../FloorPlan/geometry";
import type { Highlight, HighlightControls } from "../highlight";
import { waitLabel } from "../lib/format";
import { PHASE_LABEL } from "../lib/service";
import type { RecActions } from "./AgentPanel";
import { tableNo, tablesPhrase } from "../../domain/wording";
import { plannerText } from "./screen";
import { clock12, times12 } from "../../domain/time";
import { actionLabel, needsBuild } from "./options";

interface Props {
  rec: Recommendation;
  hlKey: string;
  room: Room;
  highlight: HighlightControls;
  actions: RecActions;
  /** Party size from the host's message, used to pre-fill "Seat party of N". */
  partySize: number;
  /** The first option: its action is the view's one filled button. */
  primary?: boolean;
  /** "Fastest", "No build", "Quiet section": by rule from the capacity facts. */
  tag: string;
  /** Set once the host acted on this option: the result line with its Undo. */
  done?: { text: string; undo: () => void };
  /** Set when another decision already took one of its tables: the demo clock time it was taken. */
  taken?: string;
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
  tag,
  done,
  taken,
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
    if (!primary || done || autoPinned.current || highlight.pinnedKey) return;
    autoPinned.current = true;
    highlight.onTogglePin(h);
    // once per answer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const action = actionLabel(rec);
  return (
    <article
      className={`card rec-card${pinned ? " is-pinned" : ""}${done ? " is-done" : ""}${taken ? " is-taken" : ""}`}
      // a decided option no longer outlines the floor
      onMouseEnter={() => !done && highlight.onHover(h)}
      onMouseLeave={() => highlight.onHover(null)}
      onFocus={() => !done && highlight.onHover(h)}
      onBlur={() => highlight.onHover(null)}
      aria-label={`Recommendation ${rec.rank}`}
    >
      <header className="rec-head">
        <span className="rank">#{rec.rank}</span>
        <strong className="rec-tables">{rows.map((r) => tablesPhrase(r)).join("  |  ")}</strong>
        <span className="rec-tag">· {tag}</span>
        <span className="wait-pill">{rec.waitMin === 0 ? "free now" : `~${rec.waitMin} min`}</span>
      </header>
      <p className="rec-check small muted">
        {rec.seats} seats{!unknown.length ? " · capacity fit ✓" : ""} · {waitText(room, rec)}
        {extraChairs > 0
          ? ` · +${extraChairs} chair${extraChairs === 1 ? "" : "s"} from storage`
          : ""}
        {dividers.length > 0
          ? ` · opens ${dividers.length} divider${dividers.length === 1 ? "" : "s"}`
          : ""}
        {needsBuild(room, rec) ? " · tables pushed together when you confirm" : ""}
      </p>
      <p className="rec-reason">{times12(plannerText(rec.reasoning))}</p>
      {rec.tradeoffs.length > 0 && (
        <ul className="tradeoffs small">
          {rec.tradeoffs.map((t, i) => (
            <li key={i}>{times12(plannerText(t))}</li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && (
        <p className="warn-text small">Not in this room: {unknown.map(tableNo).join(", ")}</p>
      )}
      {done ? (
        <p className="rec-done small" role="status">
          {done.text} ·{" "}
          <button type="button" className="link-btn" onClick={done.undo}>
            Undo
          </button>
        </p>
      ) : taken ? (
        <p className="rec-taken small">taken · {clock12(taken)}</p>
      ) : (
        <div className="btn-row">
          <button
            type="button"
            className={primary ? "primary rec-go" : "outline rec-go"}
            disabled={unknown.length > 0}
            title="Opens the review screen; nothing changes until you confirm there"
            onClick={() => actions.onPick(rec, partySize)}
          >
            {action}
          </button>
          {rows.length > 1 && (
            <button type="button" className="link-btn" onClick={actions.onOpenShift}>
              Open shift setup
            </button>
          )}
        </div>
      )}
    </article>
  );
}
