import { comboOf, estimateFreeTime, tableById, type Room, type Table } from "../../domain";
import { waitLabel } from "../lib/format";
import { PHASE_LABEL } from "../lib/service";

const ATTRS: [keyof Table["attrs"], string][] = [
  ["accessible", "Accessible"],
  ["strollerSpace", "Stroller space"],
  ["quiet", "Quiet"],
  ["view", "View"],
  ["booth", "Booth"],
];

interface Props {
  room: Room;
  selected: string[];
  onFinish: (ids: string[]) => void;
}

export function TableDetails({ room, selected, onFinish }: Props) {
  const tables = selected.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  if (!tables.length) return null;
  return (
    <div className="details-grid">
      {tables.map((t) => (
        <TableCard key={t.id} room={room} table={t} onFinish={onFinish} />
      ))}
      <p className="muted small details-note">
        Moving a table changes the drawing only. Which tables can be joined comes from the room's
        join list.
      </p>
    </div>
  );
}

function TableCard({
  room,
  table: t,
  onFinish,
}: {
  room: Room;
  table: Table;
  onFinish: (ids: string[]) => void;
}) {
  const free = estimateFreeTime(t);
  const combo = comboOf(room, t.id);
  return (
    <article className="card table-card" aria-label={`Details for ${t.id}`}>
      <header>
        <strong>{t.id}</strong>
        <span className={`pill status-${t.status}`}>{t.status}</span>
      </header>
      <dl className="kv">
        <dt>Seats</dt>
        <dd>
          {t.seats} · {t.shape === "diamond" ? "diamond (4-top at 45°)" : t.shape}
          {t.maxExtraChairs > 0 && (
            <div className="muted small">
              +{t.maxExtraChairs} chair{t.maxExtraChairs === 1 ? "" : "s"} possible from storage
            </div>
          )}
        </dd>
        <dt>Area</dt>
        <dd>
          {t.area} · section {t.section}
        </dd>
        {t.status === "occupied" && (
          <>
            <dt>Phase</dt>
            <dd>
              {PHASE_LABEL[t.phase ?? "seated"]}
              {t.partySize ? ` · party of ${t.partySize}` : ""}
            </dd>
          </>
        )}
        {t.reservedAt && (
          <>
            <dt>Held for</dt>
            <dd>{t.reservedAt}</dd>
          </>
        )}
        <dt>Free</dt>
        <dd>
          {free.minutes === null ? "not this service" : waitLabel(free.minutes)}
          <div className="muted small">{free.basis}</div>
        </dd>
        <dt>Joinable</dt>
        <dd>{t.joinable ? "yes" : "no"}</dd>
        {combo && (
          <>
            <dt>Combo</dt>
            <dd>{combo.join(" + ")}</dd>
          </>
        )}
      </dl>
      <div className="chips">
        {ATTRS.filter(([k]) => t.attrs[k]).map(([k, label]) => (
          <span key={k} className="chip-static">
            {label}
          </span>
        ))}
      </div>
      {t.status === "occupied" && (
        <button type="button" className="finish-btn" onClick={() => onFinish(combo ?? [t.id])}>
          Finish {combo ? combo.join("+") : t.id} — party leaves, tables open
        </button>
      )}
    </article>
  );
}
