import { useState } from "react";
import { toHHMM, toMinutes, type Need, type Reservation } from "../../domain";
import { NEEDS } from "../lib/service";

const SIZES = Array.from({ length: 12 }, (_, i) => i + 1);

/** Add a booking to tonight's book (this session only). */
export function ReservationSheet({
  clock,
  onAdd,
}: {
  clock: string;
  onAdd: (r: Omit<Reservation, "id">) => void;
}) {
  const [time, setTime] = useState(() => toHHMM(Math.ceil((toMinutes(clock) + 1) / 15) * 15));
  const [size, setSize] = useState(2);
  const [needs, setNeeds] = useState<Need[]>([]);
  const valid = /^\d\d:\d\d$/.test(time) && size > 0;

  return (
    <div className="walkin">
      <label className="field-col">
        <span>Time</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <fieldset className="field-block">
        <legend>Party size</legend>
        <div className="size-grid">
          {SIZES.map((n) => (
            <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)}>
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
                if (Number.isInteger(n) && n > 0) setSize(Math.min(60, n));
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
              onClick={() =>
                setNeeds((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]))
              }
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="muted small">Added to tonight's book in this session only.</p>
      <div className="btn-row sheet-actions">
        <button
          type="button"
          className="primary"
          disabled={!valid}
          onClick={() => onAdd({ time, partySize: size, needs })}
        >
          Add party of {size} at {time}
        </button>
      </div>
    </div>
  );
}
