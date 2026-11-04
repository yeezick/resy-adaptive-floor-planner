import { useState } from "react";
import {
  checkTableSet,
  estimateFreeTime,
  meetsNeeds,
  tableById,
  type Need,
  type Room,
  type Table,
} from "../../domain";
import { clock12 } from "../../domain/time";
import { tablesPhrase } from "../../domain/wording";
import { NEEDS } from "../lib/service";
import { PersonIcon, ReviewDiff, ReviewFoot } from "./parts";
import "./review.css";

/** An AI Planner option the host picked: what the review screen opens with. */
export interface WalkInReviewDraft {
  /** The card it came from ("rec-<turn>-<rank>"), for the result line in the thread. */
  key: string;
  traceId?: string;
  tables: string[];
  /** The option's own wait estimate (used while its tables are unchanged). */
  waitMin: number;
  size: number;
  needs: Need[];
}

export interface WalkInConfirm {
  action: "seat" | "waitlist";
  tables: string[];
  size: number;
  needs: Need[];
  quoteMin: number;
  name: string;
  note: string;
}

/** The capacity check of a walk-in on these tables, now: fit, seats, wait (est.). */
export function walkInCheck(
  room: Room,
  tables: readonly string[],
  size: number,
  needs: readonly Need[],
  optionWait: number | null,
): { ok: boolean; text: string; base: number; chairs: number; waitMin: number | null } {
  const picked = tables.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  if (!picked.length)
    return { ok: false, text: "pick tables on the floor", base: 0, chairs: 0, waitMin: null };
  const check = picked.length > 1 ? checkTableSet(room, tables) : null;
  if (check && !check.ok)
    return { ok: false, text: check.reason, base: 0, chairs: 0, waitMin: null };
  const base = check?.ok ? check.baseSeats : picked.reduce((n, t) => n + t.seats, 0);
  const spare = picked.reduce((n, t) => n + t.maxExtraChairs, 0);
  const short = Math.max(0, size - base);
  const waits = picked.map((t) => estimateFreeTime(t).minutes);
  const waitMin =
    optionWait ?? (waits.some((w) => w === null) ? null : Math.max(...(waits as number[])));
  if (waitMin === null)
    return { ok: false, text: "a table is blocked tonight", base, chairs: 0, waitMin };
  if (short > spare)
    return {
      ok: false,
      text: `short ${short - spare} seat${short - spare === 1 ? "" : "s"}`,
      base,
      chairs: 0,
      waitMin,
    };
  if (!meetsNeeds(picked, needs))
    return { ok: false, text: `doesn't meet: ${needs.join(", ")}`, base, chairs: short, waitMin };
  return {
    ok: true,
    text: `capacity fit ✓ · ${base + short} seats${short ? ` (+${short} chairs from storage)` : ""}`,
    base,
    chairs: short,
    waitMin,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Review and confirm a walk-in before anything changes: the party, the tables with their capacity check, needs
 * and notes, all editable. Any edit re-runs the check and shows the change. One verb: Seat or Waitlist.
 */
export function WalkInReview({
  room,
  draft,
  tables,
  onBack,
  onConfirm,
}: {
  room: Room;
  draft: WalkInReviewDraft;
  /** The tables as picked now (the host can tap tables on the floor to change them). */
  tables: string[];
  onBack: () => void;
  onConfirm: (c: WalkInConfirm) => void;
}) {
  const [size, setSize] = useState(draft.size);
  const [needs, setNeeds] = useState<Need[]>(draft.needs);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const same = sameSet(tables, draft.tables);
  const now = walkInCheck(room, tables, size, needs, same ? draft.waitMin : null);
  const was = walkInCheck(room, draft.tables, draft.size, draft.needs, draft.waitMin);
  const quote = Math.max(now.waitMin ?? 0, 5);
  const action: "seat" | "waitlist" = now.waitMin === 0 ? "seat" : "waitlist";

  const diff: string[] = [];
  if (!same)
    diff.push(
      `Tables: ${tablesPhrase(draft.tables)} → ${tables.length ? tablesPhrase(tables) : "none"}`,
    );
  if (size !== draft.size) diff.push(`Party: ${draft.size} → ${size}`);
  const added = needs.filter((n) => !draft.needs.includes(n));
  const removed = draft.needs.filter((n) => !needs.includes(n));
  if (added.length) diff.push(`Needs: + ${added.join(", ")}`);
  if (removed.length) diff.push(`Needs: − ${removed.join(", ")}`);

  return (
    <div className="review" aria-label="Review and confirm">
      <header className="review-guest">
        <label className="review-name">
          <span className="sr-only">Guest name (optional)</span>
          <input
            type="text"
            maxLength={60}
            value={name}
            placeholder="Walk-in guest"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <span className="review-party" role="group" aria-label="Party size">
          <button
            type="button"
            aria-label="One fewer guest"
            disabled={size <= 1}
            onClick={() => setSize((n) => n - 1)}
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
            disabled={size >= 60}
            onClick={() => setSize((n) => n + 1)}
          >
            +
          </button>
        </span>
        <span className="review-time muted">now · {clock12(room.clock)}</span>
      </header>

      <section className="review-row" aria-label="Tables">
        <div className="review-tables">
          <strong>{tables.length ? tablesPhrase(tables) : "No tables"}</strong>
          <span className={`verdict ${now.ok ? "verdict-real" : "verdict-unsure"} fit-pill`}>
            {now.text}
          </span>
        </div>
        <p className="muted small">
          {now.waitMin === 0
            ? "Free now"
            : now.waitMin !== null
              ? `Free in ~${now.waitMin} min (est.)`
              : ""}
          {" · "}tap tables on the floor to change
        </p>
      </section>

      <section className="review-row" aria-label="Needs">
        <div className="chips">
          {NEEDS.map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={needs.includes(n)}
              onClick={() =>
                setNeeds((x) => (x.includes(n) ? x.filter((y) => y !== n) : [...x, n]))
              }
            >
              {n}
            </button>
          ))}
        </div>
        <label className="review-note small">
          <span className="muted">Notes, allergies, celebrations</span>
          <input
            type="text"
            maxLength={140}
            value={note}
            placeholder="e.g. birthday, nut allergy"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </section>

      <ReviewDiff lines={diff} before={was.ok ? "capacity fit ✓" : "no capacity fit"} after={now} />

      <ReviewFoot
        onBack={onBack}
        backLabel="‹ Back to AI Planner"
        primary={action === "seat" ? `Seat at ${tablesPhrase(tables)}` : `Waitlist · ~${quote} min`}
        disabled={!tables.length || !now.ok}
        onConfirm={() =>
          onConfirm({
            action,
            tables,
            size,
            needs,
            quoteMin: quote,
            name: name.trim(),
            note: note.trim(),
          })
        }
      />
    </div>
  );
}
