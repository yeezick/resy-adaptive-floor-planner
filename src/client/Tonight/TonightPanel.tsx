import { useEffect, useRef, useState } from "react";
import {
  generateTonight,
  toMinutes,
  type LayoutChange,
  type Room,
  type TonightProposal,
} from "../../domain";
import { dividersForTables } from "../FloorPlan/geometry";
import { openedDividers } from "../FloorPlan/ChangeOverlay";
import { PartyFitCard } from "../Fit/PartyFitCard";
import type { HighlightControls } from "../highlight";
import type { LayoutsApi } from "../layouts/useLayouts";

export const POSITIONING =
  "Host tools today plan the layout ahead of time. This plans tonight's layout from tonight's book.";

interface Props {
  layouts: LayoutsApi;
  proposal: TonightProposal | null;
  highlight: HighlightControls;
  onProposal: (p: TonightProposal | null) => void;
  onEdit: (room: Room, name: string) => void;
  onApply: (p: TonightProposal) => void;
  /** Generate once on mount (opening an accepted request's night). */
  autoGenerate?: { from: string; to: string };
  /** A party to put first and pin on the floor. */
  focusId?: string;
}

export function TonightPanel({
  layouts,
  proposal,
  highlight,
  onProposal,
  onEdit,
  onApply,
  autoGenerate,
  focusId,
}: Props) {
  const [baseId, setBaseId] = useState(layouts.active.id);
  const [from, setFrom] = useState(autoGenerate?.from ?? "17:00");
  const [to, setTo] = useState(autoGenerate?.to ?? "22:00");
  const base = layouts.layouts.find((l) => l.id === baseId) ?? layouts.active;
  const valid = toMinutes(from) < toMinutes(to);
  const auto = useRef(autoGenerate);
  useEffect(() => {
    const a = auto.current;
    if (!a) return;
    auto.current = undefined;
    onProposal(generateTonight(base.room, a.from, a.to));
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tonight">
      <h3 className="section-title">Generate tonight's layout</h3>
      <div className="field-stack">
        <label className="field-inline">
          <span>Start from</span>
          <select value={base.id} onChange={(e) => setBaseId(e.target.value)}>
            {layouts.layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
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
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="primary"
          disabled={!valid}
          onClick={() => onProposal(generateTonight(base.room, from, to))}
        >
          {proposal ? "Regenerate" : "Generate tonight's layout"}
        </button>
        {proposal && (
          <button type="button" onClick={() => onProposal(null)}>
            Discard
          </button>
        )}
      </div>
      {!valid && <p className="warn-text small">Pick a start time before the end time.</p>}

      {proposal && (
        <Proposal
          p={proposal}
          focusId={focusId}
          highlight={highlight}
          onEdit={() => onEdit(proposal.variant, tonightLabel(proposal))}
          onApply={() => onApply(proposal)}
        />
      )}
    </div>
  );
}

function tonightLabel(p: TonightProposal): string {
  return `Tonight ${p.window.from}–${p.window.to}`;
}

function Proposal({
  p,
  focusId,
  highlight,
  onEdit,
  onApply,
}: {
  p: TonightProposal;
  focusId?: string;
  highlight: HighlightControls;
  onEdit: () => void;
  onApply: () => void;
}) {
  const s = p.summary;
  const parties = groupByParty(p).sort(
    (a, b) => Number(b.id === focusId) - Number(a.id === focusId),
  );
  return (
    <div className="proposal">
      <div className="totals">
        <Tile label="Covers booked" value={String(s.coversBooked)} />
        <Tile label={`Peak · ${s.peakCovers.at}`} value={String(s.peakCovers.covers)} />
        <Tile
          label="Seats on floor"
          value={String(s.seatsOnFloor)}
          hint={s.seatsAddedFromStorage ? `+${s.seatsAddedFromStorage} from storage` : undefined}
        />
        <Tile
          label="Large parties placed"
          value={`${s.placed}/${s.largeParties}`}
          warn={s.placed < s.largeParties}
        />
        <Tile
          label="Covers lost to holds"
          value={`~${s.coversLostToHolds}`}
          hint="seats × time held ÷ one 90-min turn"
        />
      </div>

      <section aria-label="Fit and cost by party">
        <h3 className="section-title">Large parties · fit + cost · {p.parties.length}</h3>
        <p className="muted small">
          Holds, sections and aisle checks come from the planner. Hover a party to see it on the
          floor.
        </p>
        <ul className="fit-list">
          {[...p.parties]
            .sort(
              (a, b) => Number(b.reservationId === focusId) - Number(a.reservationId === focusId),
            )
            .map((f) => {
              const h = {
                key: `fit-${f.reservationId}`,
                ids: f.tables,
                label: `${f.reservationId} · party of ${f.partySize}`,
              };
              return (
                <PartyFitCard
                  key={f.reservationId}
                  f={f}
                  focus={f.reservationId === focusId}
                  onHover={(on) => highlight.onHover(on ? h : null)}
                />
              );
            })}
        </ul>
      </section>
      {p.infeasible.length > 0 && (
        <section aria-label="Can't fit">
          <h3 className="section-title">Can't fit · {p.infeasible.length}</h3>
          <p className="muted small">The rest of the plan still stands.</p>
          {p.infeasible.map((x) => (
            <div key={x.reservationId} className="cant-fit">
              <strong>{x.reservationId}</strong> <span className="small">{x.reason}</span>
            </div>
          ))}
        </section>
      )}

      <table className="data compact" aria-label="Storage used versus in stock">
        <tbody>
          <StockRow
            label="Extenders"
            used={s.storageUsed.extenders}
            stock={s.storageInStock.extenders}
          />
          <StockRow label="Chairs" used={s.storageUsed.chairs} stock={s.storageInStock.chairs} />
          <StockRow
            label="Spare tables"
            used={s.storageUsed.spareTables}
            stock={s.storageInStock.spareTables}
          />
        </tbody>
      </table>

      <div className="btn-row sheet-actions">
        <button type="button" onClick={onEdit}>
          Edit in editor
        </button>
        <button type="button" className="primary" onClick={onApply}>
          Apply to tonight
        </button>
      </div>

      <section aria-label="Changes by party">
        <h3 className="section-title">Changes by party · {parties.length}</h3>
        <ul className="party-changes">
          {parties.map((g) => {
            const h = {
              key: `tonight-${g.id}`,
              ids: g.tables,
              label: `${g.id} · party of ${g.size}`,
              dividers: g.dividers,
            };
            return (
              <li
                key={g.id}
                className={`card${g.id === focusId ? " is-focus" : ""}`}
                tabIndex={0}
                onMouseEnter={() => highlight.onHover(h)}
                onMouseLeave={() => highlight.onHover(null)}
                onFocus={() => highlight.onHover(h)}
                onBlur={() => highlight.onHover(null)}
              >
                <div className="rec-head">
                  <strong>{g.id}</strong>
                  {g.id === focusId && <span className="pill pill-accent">just accepted</span>}
                  <span className="muted">party of {g.size}</span>
                </div>
                {g.reason && <p className="small rec-reason">{g.reason}</p>}
                <ul className="steps small">
                  {g.changes.map((c, i) => (
                    <li key={i} className={`chg chg-${c.kind}`}>
                      {c.text}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Crew build list">
        <h3 className="section-title">Crew build list</h3>
        <ol className="crew">
          {p.crew.map((c) => (
            <li key={`${c.reservationId}-${c.start}`} className={c.tight ? "is-tight" : undefined}>
              <div className="crew-head">
                <span className="crew-time">
                  {c.start}–{c.end}
                </span>
                <strong>
                  {c.reservationId} · {c.partySize}
                </strong>
                <span className="pill">{c.when === "set" ? "set before service" : "rebuild"}</span>
                {c.tight && <span className="pill pill-warn">tight</span>}
              </div>
              <details className="small">
                <summary>{c.actions.length} steps</summary>
                <ol className="steps">
                  {c.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

interface PartyGroup {
  id: string;
  size: number;
  reason: string | undefined;
  changes: LayoutChange[];
  tables: string[];
  dividers: string[];
}

function groupByParty(p: TonightProposal): PartyGroup[] {
  const ids = [
    ...new Set([
      ...p.changes.map((c) => c.reservationId),
      ...p.reasons.map((r) => r.reservationId),
    ]),
  ];
  return ids.map((id) => {
    const changes = p.changes.filter((c) => c.reservationId === id);
    const tables = [...new Set(changes.flatMap((c) => c.tables))];
    return {
      id,
      size:
        p.crew.find((c) => c.reservationId === id)?.partySize ??
        p.variant.reservations.find((r) => r.id === id)?.partySize ??
        0,
      reason: p.reasons.find((r) => r.reservationId === id)?.text,
      changes,
      tables,
      dividers: [...openedDividers(changes), ...dividersForTables(p.variant, tables)],
    };
  });
}

function Tile({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className={`stat${warn ? " warn" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        {label}
        {hint && <div className="muted">{hint}</div>}
      </div>
    </div>
  );
}

function StockRow({ label, used, stock }: { label: string; used: number; stock: number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={`num${used > stock ? " warn-text" : ""}`}>
        {used} / {stock} in stock
      </td>
    </tr>
  );
}
