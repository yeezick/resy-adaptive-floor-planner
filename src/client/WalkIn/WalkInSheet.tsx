import { useState } from "react";
import { ProposedTag } from "../requests/RequestSheet";
import { requestsActions, useRequests } from "../requests/store";
import { NIGHTS } from "../nights";
import { NEEDS as REQUEST_NEEDS, SERVICE } from "../../domain/requests";
import { toHHMM, toMinutes } from "../../domain/time";
import {
  checkTableSet,
  tableById,
  type FitResult,
  type Need,
  type Room,
  type Table,
} from "../../domain";
import type { HighlightControls } from "../highlight";
import { etaText, NEEDS, typicalWait } from "../lib/service";
import { tablesPhrase } from "../../domain/wording";

export interface WalkInDraft {
  size: number;
  needs: Need[];
  /** Set when seating someone from the waitlist. */
  waitId?: string;
}

interface Props {
  room: Room;
  fit: FitResult | null;
  highlight: HighlightControls;
  draft: WalkInDraft;
  selected: string[];
  onDraft: (d: WalkInDraft) => void;
  onSelect: (ids: string[]) => void;
  onSeat: (ids: string[], size: number) => void;
  onWaitlist: (quoteMin: number) => void;
}

const SIZES = Array.from({ length: 12 }, (_, i) => i + 1);

/** Arrival times a host-stand request can ask for: 15-minute slots from now (or service start) to close. */
function laterSlots(clock: string): string[] {
  const from = Math.max(toMinutes(SERVICE.from), Math.ceil(toMinutes(clock) / 15) * 15);
  const out: string[] = [];
  for (let m = from; m <= toMinutes(SERVICE.to); m += 15) out.push(toHHMM(m));
  return out;
}

/**
 * A party above the online cap asking in person: take it as a request so it gets the same capacity fit and
 * cost of saying yes vs no as an online request. Nothing is booked.
 */
function HostStandRequest({ room, size, needs }: { room: Room; size: number; needs: Need[] }) {
  const s = useRequests();
  const slots = laterSlots(room.clock);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const cap = s.book?.onlineCap ?? 8;
  if (size <= cap || !s.book || !slots.length) return null;
  const at = time && slots.includes(time) ? time : (slots[0] as string);
  const day = (NIGHTS[room.id]?.day ?? "Sat") as Parameters<
    typeof requestsActions.addWalkIn
  >[0]["day"];
  return (
    <section className="host-stand card" aria-label="Large party at the host stand">
      <h3 className="section-title">
        Party of {size} at the stand <ProposedTag />
      </h3>
      <p className="muted small">
        Above the online cap of {cap}: check the capacity fit and the cost of saying yes, like any
        request.
      </p>
      <div className="host-stand-row">
        <label className="small">
          Arrival
          <select value={at} onChange={(e) => setTime(e.target.value)}>
            {slots.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="small">
          Name (optional)
          <input
            type="text"
            maxLength={60}
            value={name}
            placeholder="Walk-in guest"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="primary"
        onClick={() =>
          requestsActions.addWalkIn({
            day,
            bookRoomId: room.id,
            clock: room.clock,
            time: at,
            partySize: size,
            needs: needs.filter((n): n is (typeof REQUEST_NEEDS)[number] =>
              (REQUEST_NEEDS as readonly string[]).includes(n),
            ),
            contact: name,
          })
        }
      >
        Check capacity fit →
      </button>
    </section>
  );
}

export function WalkInSheet({
  fit,
  highlight,
  room,
  draft,
  selected,
  onDraft,
  onSelect,
  onSeat,
  onWaitlist,
}: Props) {
  const { size, needs } = draft;
  if (!fit) return null;
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
        ? `${tablesPhrase(busy.map((t) => t.id))} still ${busy.length === 1 ? "has" : "have"} guests — add to the waitlist or pick free tables`
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

      <HostStandRequest room={room} size={size} needs={needs} />

      <section aria-label="Suggested tables" className="suggested">
        <h3 className="section-title">
          Suggested <ProposedTag />{" "}
          <span className="muted">· outlined on the floor · tap one to pick it</span>
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
                    onMouseEnter={() =>
                      highlight.onHover({
                        key: `sugg-${o.tables.join("+")}`,
                        ids: o.tables,
                        label: `Suggested: ${tablesPhrase(o.tables)}`,
                      })
                    }
                    onMouseLeave={() => highlight.onHover(null)}
                  >
                    <span className="sugg-head">
                      <span className="ai-chip">Suggested</span>
                      <strong>{tablesPhrase(o.tables)}</strong>
                      <span className={o.waitMin === 0 ? "ok-text eta" : "muted eta"}>
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
              Selected <strong>{tablesPhrase(selected)}</strong> · {base} seats
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
