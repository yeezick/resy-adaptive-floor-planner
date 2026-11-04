import { useMemo, useState } from "react";
import {
  clock12,
  LARGE_PARTY,
  planBuilds,
  tableById,
  times12,
  toMinutes,
  type Build,
  type Room,
} from "../../domain";
import { normaliseDivider } from "../FloorPlan/geometry";
import type { Highlight, HighlightControls } from "../highlight";
import { Storage } from "./Storage";
import { tablesPhrase } from "../../domain/wording";

interface Props {
  room: Room;
  highlight: HighlightControls;
}

export function buildHighlight(b: Build): Highlight {
  return {
    key: `build-${b.reservationId}`,
    ids: b.tables,
    label: `${clock12(b.time)} party of ${b.partySize}: ${b.rows.map((r) => r.join("+")).join(" | ")}`,
    dividers: b.dividersOpened.map(normaliseDivider),
  };
}

export function BuildPlan({ room, highlight }: Props) {
  const [from, setFrom] = useState("17:00");
  const [to, setTo] = useState("20:00");
  const valid =
    /^\d\d:\d\d$/.test(from) && /^\d\d:\d\d$/.test(to) && toMinutes(from) <= toMinutes(to);
  const plan = useMemo(() => (valid ? planBuilds(room, from, to) : null), [room, from, to, valid]);

  return (
    <div className="buildplan">
      <p className="muted small">
        Table builds for parties of {LARGE_PARTY}+ from the reservation book, computed in your
        browser. Read-only — use Combine on the floor to act on one.
      </p>
      <div className="field-row">
        <label className="field-inline">
          <span>From</span>
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field-inline">
          <span>To</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="warn-text small">Pick a start time before the end time.</p>}

      {plan && (
        <>
          <div className="totals" aria-label="Plan totals">
            <Stat label="Builds" value={String(plan.builds.length)} />
            <Stat label="Tables used" value={String(plan.totals.tablesUsed)} />
            <Stat
              label="Dividers opened"
              value={String(plan.builds.reduce((n, b) => n + b.dividersOpened.length, 0))}
            />
            <Stat
              label="Unplaced"
              value={String(plan.unplaced.length)}
              warn={plan.unplaced.length > 0}
            />
          </div>

          <Storage inventory={room.inventory} totals={plan.totals} />

          {plan.shortfalls.length > 0 && (
            <ul className="shortfalls" role="alert">
              {plan.shortfalls.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}

          {plan.builds.length === 0 && plan.unplaced.length === 0 && (
            <div className="state-card small">
              No parties of {LARGE_PARTY}+ booked between {clock12(from)} and {clock12(to)}.
              {room.reservations.length === 0 && " This room has no reservations loaded."}
            </div>
          )}

          <ol className="builds">
            {plan.builds.map((b) => (
              <BuildCard key={b.reservationId} room={room} build={b} highlight={highlight} />
            ))}
          </ol>

          {plan.unplaced.length > 0 && (
            <section aria-label="Unplaced parties">
              <h3 className="section-title">Could not place</h3>
              <ul className="unplaced">
                {plan.unplaced.map((u) => (
                  <li key={u.reservationId}>
                    <strong>
                      {u.reservationId} · party of {u.partySize}
                    </strong>
                    <div className="muted small">{times12(u.reason)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`stat${warn ? " warn" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function BuildCard({
  room,
  build: b,
  highlight,
}: {
  room: Room;
  build: Build;
  highlight: HighlightControls;
}) {
  const h = buildHighlight(b);
  const pinned = highlight.pinnedKey === h.key;
  const extras = [
    b.spareTables > 0 && `${b.spareTables} spare table${b.spareTables === 1 ? "" : "s"}`,
    b.extenders > 0 && `${b.extenders} extender${b.extenders === 1 ? "" : "s"}`,
    b.extraChairs > 0 && `${b.extraChairs} chair${b.extraChairs === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <li
      className={`card build-card${pinned ? " is-pinned" : ""}`}
      onMouseEnter={() => highlight.onHover(h)}
      onMouseLeave={() => highlight.onHover(null)}
      onFocus={() => highlight.onHover(h)}
      onBlur={() => highlight.onHover(null)}
    >
      <header className="rec-head">
        <span className="rank">{clock12(b.time)}</span>
        <strong>Party of {b.partySize}</strong>
        <span className="muted">
          {b.seats} seats · build by {clock12(b.buildBy)}
        </span>
      </header>
      <ul className="build-rows small">
        {b.rows.map((row, i) => (
          <li key={row.join("+")}>
            <span className="muted">
              {b.rows.length > 1 ? `Row ${i + 1}` : "Table"} · {tableById(room, row[0] ?? "")?.area}
            </span>{" "}
            <strong>{tablesPhrase(row)}</strong>
          </li>
        ))}
      </ul>
      {b.dividersOpened.length > 0 && (
        <div className="small divider-note">
          Open {b.dividersOpened.length === 1 ? "divider" : "dividers"}:{" "}
          {b.dividersOpened.join(", ")}
        </div>
      )}
      {extras.length > 0 && <div className="small muted">From storage: {extras.join(" · ")}</div>}
      <details className="small">
        <summary>Steps</summary>
        <ol className="steps">
          {b.steps.map((s) => (
            <li key={s}>{times12(s)}</li>
          ))}
        </ol>
      </details>
      <button type="button" aria-pressed={pinned} onClick={() => highlight.onTogglePin(h)}>
        {pinned ? "Hide on floor" : "Show on floor"}
      </button>
    </li>
  );
}
