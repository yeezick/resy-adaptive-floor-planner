import { useMemo, useState } from "react";
import { clock12, toHHMM, toMinutes, type Room } from "../../domain";
import { baseConstraints, changeList, checkAdjusted } from "../../domain/requestChat";
import { DEMO_WEEK_ISO, NEEDS, SERVICE, type GuestRequest } from "../../domain/requests";
import { storagePhrase, tablesPhrase } from "../../domain/wording";
import { requestsActions, useRequests } from "../requests/store";
import { PersonIcon, ReviewDiff, ReviewFoot } from "./parts";
import "./review.css";

const SLOTS = (() => {
  const out: string[] = [];
  for (let m = toMinutes(SERVICE.from); m <= toMinutes(SERVICE.to); m += 15) out.push(toHHMM(m));
  return out;
})();

const NEED_LABEL: Record<string, string> = {
  accessible: "wheelchair",
  stroller: "stroller",
  quiet: "quiet corner",
  view: "view",
};

/** "Fri, Nov 6" for a request on another night than the one on screen. */
function dateLabel(day: string): string {
  const iso = DEMO_WEEK_ISO[day as keyof typeof DEMO_WEEK_ISO];
  if (!iso) return day;
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Review and confirm a large-party request before Accept: the guest, party, time (and date when it isn't the
 * night on screen), the tables with their capacity check, needs and notes. Every setting is editable here and
 * writes the same request state as the chat; any edit re-runs the check and shows the change. One verb:
 * "Accept · hold tables" (it also applies the night's crew plan).
 */
export function RequestReview({
  request: r,
  room,
  now,
  fromRequest,
  impact = null,
  onBack,
  onAccept,
}: {
  request: GuestRequest;
  room: Room;
  /** The night on screen (its weekday), to show the date only when it differs. */
  now: { day: string } | null;
  /** What the request itself says (the AI triage summary), shown as notes. */
  fromRequest: readonly string[];
  /** "+22 booked vs up to ~24 possible walk-ins · held 5:00–6:30 PM" for the request as it stands. */
  impact?: string | null;
  onBack: () => void;
  onAccept: (tables: string[]) => void;
}) {
  const s = useRequests();
  const c = s.adjust[r.id] ?? baseConstraints(r);
  // the request as it stood when the review opened: the diff is against it
  const [opened] = useState(c);
  const [note, setNote] = useState("");
  const set = (next: Partial<typeof c>) => requestsActions.setConstraints(r.id, { ...c, ...next });
  const res = useMemo(() => checkAdjusted(room, r, c), [room, r, c]);
  const was = useMemo(() => checkAdjusted(room, r, opened), [room, r, opened]);
  const size = c.partySize ?? r.partySize;
  const time = c.time ?? r.time;
  const fit = res.fit;

  const had = new Set(changeList(r, opened));
  const diff = changeList(r, c)
    .filter((x) => !had.has(x))
    .concat(
      changeList(r, opened)
        .filter((x) => !changeList(r, c).includes(x))
        .map((x) => `back: ${x}`),
    );

  return (
    <div className="review" aria-label="Review and confirm">
      <header className="review-guest">
        <strong className="review-who">{r.contact}</strong>
        <span className="review-party" role="group" aria-label="Party size">
          <button
            type="button"
            aria-label="One fewer guest"
            disabled={size <= 1}
            onClick={() => set({ partySize: size - 1 === r.partySize ? null : size - 1 })}
          >
            −
          </button>
          <span className="review-count">
            <PersonIcon /> <strong>{size}</strong>
            <span className="sr-only"> guests</span>
          </span>
          <button
            type="button"
            aria-label="One more guest"
            disabled={size >= 500}
            onClick={() => set({ partySize: size + 1 === r.partySize ? null : size + 1 })}
          >
            +
          </button>
        </span>
        <label className="review-time">
          <span className="sr-only">Time</span>
          <select
            value={time}
            onChange={(e) => set({ time: e.target.value === r.time ? null : e.target.value })}
          >
            {(SLOTS.includes(r.time) ? SLOTS : [r.time, ...SLOTS]).map((t) => (
              <option key={t} value={t}>
                {clock12(t)}
              </option>
            ))}
          </select>
        </label>
        {now?.day !== r.day && <span className="review-date muted">{dateLabel(r.day)}</span>}
      </header>

      <section className="review-row" aria-label="Tables">
        <div className="review-tables">
          <strong>{fit.ok ? tablesPhrase(fit.build.tables) : "No tables"}</strong>
          <span className={`verdict ${fit.ok ? "verdict-real" : "verdict-unsure"} fit-pill`}>
            {fit.ok ? "capacity fit ✓" : "no capacity fit"}
          </span>
        </div>
        <p className="muted small">
          {fit.ok
            ? `${fit.build.area} · seats ${fit.build.seats}${storagePhrase(fit.build) ? ` · ${storagePhrase(fit.build)} from storage` : ""} · build by ${clock12(fit.build.buildBy)}`
            : res.line}
        </p>
        {impact && <p className="review-impact small">{impact}</p>}
        <div className="review-range small">
          <span className="muted">Only tables</span>
          <label>
            <span className="sr-only">First table</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              placeholder="any"
              value={c.tableRange?.from ?? ""}
              onChange={(e) => {
                const from = Number(e.target.value);
                if (!e.target.value) return set({ tableRange: null });
                if (Number.isInteger(from) && from > 0)
                  set({ tableRange: { from, to: Math.max(from, c.tableRange?.to ?? from) } });
              }}
            />
          </label>
          <span className="muted">to</span>
          <label>
            <span className="sr-only">Last table</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              placeholder="any"
              value={c.tableRange?.to ?? ""}
              onChange={(e) => {
                const to = Number(e.target.value);
                if (!e.target.value) return set({ tableRange: null });
                if (Number.isInteger(to) && to > 0)
                  set({ tableRange: { from: Math.min(to, c.tableRange?.from ?? to), to } });
              }}
            />
          </label>
        </div>
      </section>

      <section className="review-row" aria-label="Needs and notes">
        <div className="chips">
          {NEEDS.map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={c.needs.includes(n)}
              onClick={() =>
                set({
                  needs: c.needs.includes(n) ? c.needs.filter((x) => x !== n) : [...c.needs, n],
                })
              }
            >
              {NEED_LABEL[n] ?? n}
            </button>
          ))}
          {c.notes.map((n) => (
            <button
              key={n}
              type="button"
              className="chip chip-note"
              aria-label={`Remove note ${n}`}
              onClick={() => set({ notes: c.notes.filter((x) => x !== n) })}
            >
              {n} ×
            </button>
          ))}
        </div>
        <form
          className="review-note small"
          onSubmit={(e) => {
            e.preventDefault();
            const n = note.trim().slice(0, 40);
            if (!n || c.notes.includes(n) || c.notes.length >= 4) return;
            set({ notes: [...c.notes, n] });
            setNote("");
          }}
        >
          <label className="sr-only" htmlFor={`note-${r.id}`}>
            Add a note for the crew
          </label>
          <input
            id={`note-${r.id}`}
            type="text"
            maxLength={40}
            value={note}
            placeholder="Add a note: allergy, cake, high chair…"
            onChange={(e) => setNote(e.target.value)}
          />
        </form>
        {fromRequest.length > 0 && (
          <ul className="review-from small" aria-label="From the request">
            {fromRequest.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </section>

      <ReviewDiff
        lines={diff}
        before={was.fit.ok ? "capacity fit ✓" : "no capacity fit"}
        after={{ ok: fit.ok, text: fit.ok ? "capacity fit ✓" : "no capacity fit" }}
      />

      <ReviewFoot
        onBack={onBack}
        backLabel="‹ Back to the request"
        primary="Accept · hold tables"
        disabled={!fit.ok}
        title={
          fit.ok
            ? "Holds the tables and applies the night's crew plan"
            : "It doesn't fit that night"
        }
        onConfirm={() => fit.ok && onAccept(fit.build.tables)}
      />
    </div>
  );
}
