import { useMemo } from "react";
import {
  checkTableSet,
  findTablesForParty,
  tableById,
  type Need,
  type Room,
  type Table,
} from "../../domain";
import { etaText, NEEDS, typicalWait } from "../lib/service";

export interface WalkInDraft {
  size: number;
  needs: Need[];
  /** Set when seating someone from the waitlist. */
  waitId?: string;
}

interface Props {
  room: Room;
  draft: WalkInDraft;
  selected: string[];
  onDraft: (d: WalkInDraft) => void;
  onSelect: (ids: string[]) => void;
  onSeat: (ids: string[], size: number) => void;
  onWaitlist: (quoteMin: number) => void;
}

const SIZES = Array.from({ length: 12 }, (_, i) => i + 1);

export function WalkInSheet({
  room,
  draft,
  selected,
  onDraft,
  onSelect,
  onSeat,
  onWaitlist,
}: Props) {
  const { size, needs } = draft;
  const fit = useMemo(
    () => findTablesForParty(room, { partySize: size, needs, maxOptions: 12 }),
    [room, size, needs],
  );
  const suggestions = fit.options.slice(0, 3);
  const live = fit.options.length ? Math.min(...fit.options.map((o) => o.waitMin)) : null;
  const typical = typicalWait(size);
  // A table is free now but the guest still wants to wait: quote at least a few minutes.
  const quote = live === null ? typical : Math.max(live, 5);

  const picked = selected.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  const check = selected.length ? checkTableSet(room, selected) : null;
  const base = check?.ok ? check.baseSeats : picked.reduce((n, t) => n + t.seats, 0);
  const busy = picked.filter((t) => t.status === "occupied" || t.status === "blocked");
  const problem = !selected.length
    ? "Tap a suggestion or tables on the floor"
    : check && !check.ok
      ? check.reason
      : busy.length
        ? `${busy.map((t) => t.id).join(", ")} still ${busy.length === 1 ? "has" : "have"} guests — add to the waitlist or pick free tables`
        : null;
  const short = Math.max(0, size - base);

  const toggleNeed = (n: Need) =>
    onDraft({ ...draft, needs: needs.includes(n) ? needs.filter((x) => x !== n) : [...needs, n] });

  return (
    <div className="walkin">
      <fieldset className="field-block">
        <legend>Party size</legend>
        <div className="size-grid">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={size === n}
              onClick={() => onDraft({ ...draft, size: n })}
            >
              {n}
            </button>
          ))}
          <label className="size-more">
            <span className="sr-only">More than 12</span>
            <input
              type="number"
              min={13}
              max={60}
              placeholder="more"
              value={size > 12 ? size : ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n > 0) onDraft({ ...draft, size: Math.min(60, n) });
              }}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="field-block">
        <legend>Needs (optional)</legend>
        <div className="chips">
          {NEEDS.map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={needs.includes(n)}
              onClick={() => toggleNeed(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <section aria-label="Suggested tables" className="suggested">
        <h3 className="section-title">
          Suggested <span className="muted">· instant, from table phases</span>
        </h3>
        {suggestions.length === 0 ? (
          <p className="muted small">{fit.note ?? "Nothing fits right now."}</p>
        ) : (
          <ul className="sugg-list">
            {suggestions.map((o) => {
              const on =
                o.tables.length === selected.length &&
                o.tables.every((id) => selected.includes(id));
              return (
                <li key={o.tables.join("+")}>
                  <button
                    type="button"
                    className="sugg"
                    aria-pressed={on}
                    onClick={() => onSelect(o.tables)}
                  >
                    <span className="sugg-head">
                      <strong>{o.tables.join(" + ")}</strong>
                      <span className={o.waitMin === 0 ? "ok-text" : "muted"}>
                        {etaText(room, o)}
                      </span>
                    </span>
                    <span className="small muted">
                      {o.seats} seats · {o.area} · section {o.sections.join("/")}
                      {o.tradeoffs[0] ? ` · ${o.tradeoffs[0]}` : ""}
                    </span>
                    {o.extraChairs > 0 && (
                      <span className="pill pill-warn">
                        +{o.extraChairs} chair{o.extraChairs === 1 ? "" : "s"} from storage
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="picked" aria-live="polite">
        <div className="small">
          {selected.length ? (
            <>
              Selected <strong>{selected.join(", ")}</strong> · {base} seats
              {short > 0 && !problem && (
                <span className="warn-text"> · short {short}, add chairs from storage</span>
              )}
            </>
          ) : (
            <span className="muted">Or tap tables on the floor — manual picks always work.</span>
          )}
        </div>
        {problem && selected.length > 0 && <div className="small warn-text">{problem}</div>}
      </section>

      <div className="quote small">
        <div>
          <span className="muted">Typical for party of {size}</span> <strong>~{typical} min</strong>
          <span className="muted"> (synthetic ladder)</span>
        </div>
        <div>
          <span className="muted">Live, from table phases</span>{" "}
          <strong>{live === null ? "no fit" : live === 0 ? "now" : `~${live} min`}</strong>
        </div>
      </div>

      <div className="btn-row sheet-actions">
        <button
          type="button"
          className="primary"
          disabled={problem !== null}
          onClick={() => onSeat(selected, size)}
        >
          Seat party of {size}
        </button>
        {!draft.waitId && (
          <button type="button" onClick={() => onWaitlist(quote)}>
            Add to waitlist · quote ~{quote} min
          </button>
        )}
      </div>
    </div>
  );
}
