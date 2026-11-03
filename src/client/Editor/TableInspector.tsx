import { neighbours, tableById, type Room, type Table } from "../../domain";
import { joinCandidates, MAX_NEIGHBOURS } from "./edit";

interface Props {
  room: Room;
  id: string;
  onPatch: (patch: Partial<Table>) => void;
  onJoin: (other: string, on: boolean) => void;
}

const SHAPE_NAME: Record<Table["shape"], string> = {
  rect: "Rectangular",
  round: "Round",
  diamond: "Diamond",
  booth: "Booth",
};

const ATTRS: [keyof Table["attrs"], string][] = [
  ["accessible", "Accessible"],
  ["strollerSpace", "Aisle clearance"],
  ["quiet", "Quiet zone"],
  ["view", "View"],
  ["booth", "Booth"],
];

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`${label} down`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`${label} up`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function TableInspector({ room, id, onPatch, onJoin }: Props) {
  const t = tableById(room, id);
  if (!t) return null;
  const areas = room.areas.filter((a) => a.kind !== "station");
  const joined = neighbours(room, id);
  const candidates =
    t.shape === "rect" && t.joinable && joined.length < MAX_NEIGHBOURS
      ? joinCandidates(room, id)
      : [];

  return (
    <div className="inspector">
      <div className="insp-head">
        <strong>{t.id}</strong>
        <span className="muted small">
          {t.x}, {t.y} · {t.w}×{t.h}
        </span>
      </div>

      <label className="field-col">
        <span>Table type / area</span>
        <select value={t.area} onChange={(e) => onPatch({ area: e.target.value })}>
          {areas.map((a) => (
            <option key={a.id} value={a.name}>
              {a.kind === "bar"
                ? `Bar — ${a.name}`
                : a.kind === "private"
                  ? `Private — ${a.name}`
                  : `Dining — ${a.name}`}
            </option>
          ))}
        </select>
      </label>

      <label className="field-col">
        <span>Shape</span>
        <select
          value={t.shape}
          onChange={(e) => {
            const shape = e.target.value as Table["shape"];
            onPatch({ shape, joinable: shape === "rect" ? t.joinable : false });
          }}
        >
          <option value="rect">Rectangle</option>
          <option value="round">Round</option>
          <option value="diamond">Diamond (square at 45°)</option>
          <option value="booth">Booth</option>
        </select>
      </label>

      <Stepper
        label="Min seats"
        value={t.minSeats}
        min={1}
        max={t.seats}
        onChange={(n) => onPatch({ minSeats: n })}
      />
      <Stepper
        label="Max seats"
        value={t.seats}
        min={Math.max(1, t.minSeats)}
        max={20}
        onChange={(n) => onPatch({ seats: n })}
      />
      <Stepper
        label="Extra chairs"
        value={t.maxExtraChairs}
        min={0}
        max={2}
        onChange={(n) => onPatch({ maxExtraChairs: n })}
      />

      <fieldset className="field-block">
        <legend>Attributes</legend>
        <div className="checks">
          {ATTRS.map(([k, label]) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={t.attrs[k]}
                onChange={(e) => onPatch({ attrs: { ...t.attrs, [k]: e.target.checked } })}
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field-block">
        <legend>Joining</legend>
        <label>
          <input
            type="checkbox"
            checked={t.joinable}
            disabled={t.shape !== "rect"}
            onChange={(e) => onPatch({ joinable: e.target.checked })}
          />{" "}
          Joinable
        </label>
        {t.shape !== "rect" && (
          <p className="reason small">
            {SHAPE_NAME[t.shape]} tables can't join — only rectangular tables push together. Change
            the shape to Rectangle to allow joins.
          </p>
        )}
        <div className="small muted">
          Joinable neighbours · {joined.length}/{MAX_NEIGHBOURS}
        </div>
        <ul className="neighbours">
          {joined.map((n) => (
            <li key={n}>
              {n}
              <button
                type="button"
                aria-label={`Remove join ${t.id}–${n}`}
                onClick={() => onJoin(n, false)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <label className="field-col">
            <span className="small">Add neighbour (nearest first)</span>
            <select value="" onChange={(e) => e.target.value && onJoin(e.target.value, true)}>
              <option value="">Choose a table…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.seats} seats
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
    </div>
  );
}
