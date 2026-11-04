import {
  comboOf,
  ELAPSED_EST_MIN,
  clock12,
  estimateFreeTime,
  times12,
  tableById,
  PHASES,
  type Phase,
  type Room,
  type Table,
} from "../../domain";
import type { PlanHold } from "../lib/holds";
import { seatedName } from "../lib/names";
import { waitLabel } from "../lib/format";
import { PHASE_LABEL } from "../lib/service";
import { tableNo, tablesPhrase } from "../../domain/wording";

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
  /** Tables held by accepted large-party plans. */
  holds?: ReadonlyMap<string, PlanHold>;
  /** Tables whose phase the host set by hand. */
  phaseByHost?: ReadonlySet<string>;
  /** Minutes since the party sat, fixed when the host first changed its phase (a phase change isn't a re-seat). */
  seatedAgo?: ReadonlyMap<string, number>;
  onPhase?: (ids: string[], phase: Phase) => void;
}

export function TableDetails({
  room,
  selected,
  onFinish,
  holds,
  phaseByHost,
  seatedAgo,
  onPhase,
}: Props) {
  const tables = selected.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  if (!tables.length) return null;
  return (
    <div className="details-grid">
      {tables.map((t) => (
        <TableCard
          key={t.id}
          room={room}
          table={t}
          onFinish={onFinish}
          hold={holds?.get(t.id)}
          byHost={phaseByHost?.has(t.id) ?? false}
          seatedMin={seatedAgo?.get(t.id)}
          onPhase={onPhase}
        />
      ))}
    </div>
  );
}

function TableCard({
  room,
  table: t,
  onFinish,
  hold,
  byHost,
  seatedMin,
  onPhase,
}: {
  room: Room;
  table: Table;
  onFinish: (ids: string[]) => void;
  hold?: PlanHold;
  byHost: boolean;
  seatedMin?: number;
  onPhase?: (ids: string[], phase: Phase) => void;
}) {
  const free = estimateFreeTime(t);
  const combo = comboOf(room, t.id);
  return (
    <article className="card table-card" aria-label={`Details for table ${tableNo(t.id)}`}>
      <header>
        <strong>Table {tableNo(t.id)}</strong>
        {t.status === "occupied" ? (
          <span>
            {seatedName(combo?.[0] ?? t.id)}
            {t.partySize ? ` · party of ${t.partySize}` : ""}
          </span>
        ) : (
          <span className={`pill status-${t.status}`}>{t.status}</span>
        )}
        {hold && <span className="pill pill-held">Held</span>}
      </header>
      {hold && (
        <p className="held-line small">
          Held · {hold.name} · party of {hold.partySize} · {times12(`${hold.from}–${hold.until}`)}
        </p>
      )}
      <dl className="kv facts">
        {t.status === "occupied" && (
          <>
            <dt>Phase</dt>
            <dd>{PHASE_LABEL[t.phase ?? "seated"]}</dd>
          </>
        )}
        <dt>Free</dt>
        <dd>
          {free.minutes === null
            ? "not this service"
            : free.minutes === 0
              ? waitLabel(0)
              : `in ~${free.minutes} min (est.)`}
          <div className="muted small">{times12(free.basis)}</div>
        </dd>
        {t.status === "occupied" && (
          <>
            <dt>Seated</dt>
            <dd>~{seatedMin ?? ELAPSED_EST_MIN[t.phase ?? "seated"]} min ago (est.)</dd>
          </>
        )}
        {t.reservedAt && (
          <>
            <dt>Held for</dt>
            <dd>{clock12(t.reservedAt)}</dd>
          </>
        )}
      </dl>
      {t.status === "occupied" && (
        <button type="button" className="finish-btn" onClick={() => onFinish(combo ?? [t.id])}>
          Finish {tablesPhrase(combo ?? [t.id])} — party leaves, tables open
        </button>
      )}
      {t.status === "occupied" && onPhase && (
        <div className="phase-control" role="group" aria-label="Meal phase">
          {PHASES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={t.phase === p}
              onClick={() => onPhase(combo ?? [t.id], p)}
            >
              {PHASE_LABEL[p]}
            </button>
          ))}
          <p className="muted small phase-source">
            {byHost ? "set by host" : "from POS (simulated)"}
          </p>
        </div>
      )}
      <details className="more small">
        <summary>Table ▸</summary>
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
          {combo && (
            <>
              <dt>Combo</dt>
              <dd>{tablesPhrase(combo)}</dd>
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
      </details>
    </article>
  );
}
