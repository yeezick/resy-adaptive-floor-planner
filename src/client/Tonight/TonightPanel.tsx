import { useEffect, useRef, useState } from "react";
import {
  buildMinutes,
  clock12,
  generateTonight,
  storagePhrase,
  tableNumbers,
  tablesPhrase,
  times12,
  toHHMM,
  toMinutes,
  type Build,
  type CrewStep,
  type Room,
  type TonightProposal,
} from "../../domain";
import { PartyFitCard } from "../Fit/PartyFitCard";
import type { HighlightControls } from "../highlight";
import type { LayoutsApi } from "../layouts/useLayouts";
import { partyName, namesIn } from "../lib/names";

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
  /** The plan already applied to the layout in use (shown read-only, with Undo). */
  applied?: TonightProposal | null;
  /** The night on screen, as the night picker names it ("Fri · planning from 3:00 PM"). */
  nightLabel: string;
  /** Its weekday ("Fri"), for the accepted card. */
  nightDay?: string;
  onUndoApply?: () => void;
  /** Undo the accept of the focused party (and any Apply after it). */
  onUndoAccept?: () => void;
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
  applied = null,
  nightLabel,
  nightDay,
  onUndoApply,
  onUndoAccept,
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
  const shown = proposal ?? applied;

  return (
    <div className="tonight">
      {focusId && shown && (
        <AcceptedCard p={shown} id={focusId} day={nightDay ?? ""} onUndo={onUndoAccept} />
      )}
      {applied && !proposal && (
        <div className="applied-bar small" role="status">
          <span>
            Applied to <strong>{nightLabel}</strong>
          </span>
          {onUndoApply && (
            <button type="button" className="link-btn" onClick={onUndoApply}>
              Undo
            </button>
          )}
        </div>
      )}

      {!applied && (
        <details className="generate" open={!proposal}>
          <summary className="section-title">Generate the night's layout ▸</summary>
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
              className={proposal ? undefined : "primary"}
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
        </details>
      )}

      {shown && (
        <Proposal
          p={shown}
          focusId={focusId}
          highlight={highlight}
          readOnly={!proposal}
          nightLabel={nightLabel}
          onEdit={() => onEdit(shown.variant, tonightLabel(shown))}
          onApply={() => proposal && onApply(proposal)}
        />
      )}
    </div>
  );
}

function tonightLabel(p: TonightProposal): string {
  return `Tonight ${times12(`${p.window.from}–${p.window.to}`)}`;
}

/** The party the manager just accepted, as one card: when, tables, build-by, hold, crew start — and Undo. */
function AcceptedCard({
  p,
  id,
  day,
  onUndo,
}: {
  p: TonightProposal;
  id: string;
  day: string;
  onUndo?: () => void;
}) {
  const f = p.parties.find((x) => x.reservationId === id);
  const b = p.builds.find((x) => x.reservationId === id);
  if (!f) return null;
  const crewStart = b ? toHHMM(toMinutes(b.buildBy) - buildMinutes(b)) : null;
  return (
    <section className="accepted-card" aria-label="Accepted party">
      <h3 className="accepted-title">
        {partyName(id)} · {f.partySize} · {day ? `${day} ` : ""}
        {clock12(f.time)} — Accepted
      </h3>
      <dl className="accepted-grid small">
        <dt>Tables</dt>
        <dd>
          {tablesPhrase(f.tables)} · {f.area}
        </dd>
        {b && (
          <>
            <dt>Build by</dt>
            <dd>{clock12(b.buildBy)}</dd>
            <dt>Crew starts</dt>
            <dd>
              ~{clock12(crewStart ?? b.buildBy)} (est., ~{buildMinutes(b)} min)
            </dd>
          </>
        )}
        {f.hold.tables.length > 0 && (
          <>
            <dt>Held</dt>
            <dd>{times12(`${f.hold.from}–${f.hold.until}`)}</dd>
          </>
        )}
      </dl>
      {onUndo && (
        <button type="button" className="undo-accept" onClick={onUndo}>
          Undo accept
        </button>
      )}
    </section>
  );
}

/** One crew instruction per build: "Join tables 82–86 (5 tables) · 2 chairs from storage". */
function crewLine(b: Build | undefined, c: CrewStep): string {
  if (!b) return times12(namesIn(c.actions[0] ?? ""));
  const join =
    b.rows.length > 1
      ? `Join ${b.rows.map((r) => tableNumbers(r)).join(" + ")} (${b.tables.length} tables)`
      : b.tables.length > 1
        ? `Join ${tableNumbers(b.tables)} (${b.tables.length} tables)`
        : `Set ${tablesPhrase(b.tables)}`;
  const storage = storagePhrase(b);
  const divider = b.dividersOpened.length ? " · open the divider" : "";
  return `${join}${divider}${storage ? ` · ${storage} from storage` : ""}`;
}

function Proposal({
  p,
  focusId,
  highlight,
  readOnly,
  nightLabel,
  onEdit,
  onApply,
}: {
  p: TonightProposal;
  focusId?: string;
  highlight: HighlightControls;
  readOnly: boolean;
  nightLabel: string;
  onEdit: () => void;
  onApply: () => void;
}) {
  const s = p.summary;
  const others = p.parties.filter((f) => f.reservationId !== focusId);
  return (
    <div className="proposal">
      {p.infeasible.length > 0 && (
        <p className="unplaced-line small" role="status">
          <strong>
            {p.infeasible.length} {p.infeasible.length === 1 ? "party needs" : "parties need"} a
            table:
          </strong>{" "}
          {p.infeasible
            .map((x) => {
              const r = p.variant.reservations.find((v) => v.id === x.reservationId);
              return `${partyName(x.reservationId)} (${x.partySize}${r ? `, ${clock12(r.time)}` : ""})`;
            })
            .join(" · ")}
        </p>
      )}

      <section aria-label="Crew build list">
        <h3 className="section-title">Setup checklist</h3>
        <ol className="crew">
          {p.crew.map((c) => {
            const b = p.builds.find((x) => x.reservationId === c.reservationId);
            const h = b ? { key: `crew-${c.reservationId}-${c.start}`, ids: b.tables } : null;
            return (
              <li
                key={`${c.reservationId}-${c.start}`}
                className={
                  [c.tight && "is-tight", c.reservationId === focusId && "is-focus"]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                tabIndex={h ? 0 : undefined}
                onMouseEnter={() =>
                  h &&
                  highlight.onHover({
                    ...h,
                    label: `${partyName(c.reservationId)} · party of ${c.partySize}`,
                  })
                }
                onMouseLeave={() => highlight.onHover(null)}
                onFocus={() =>
                  h &&
                  highlight.onHover({
                    ...h,
                    label: `${partyName(c.reservationId)} · party of ${c.partySize}`,
                  })
                }
                onBlur={() => highlight.onHover(null)}
              >
                <div className="crew-head">
                  <span className="crew-time">{times12(`${c.start}–${c.end}`)}</span>
                  <strong>
                    {partyName(c.reservationId)} ({c.partySize})
                  </strong>
                  {c.when === "rebuild" && <span className="pill">rebuild</span>}
                  {c.tight && <span className="pill pill-warn">tight</span>}
                </div>
                <div className="crew-line small">{crewLine(b, c)}</div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="totals">
        <Tile label="Covers booked" value={String(s.coversBooked)} />
        <Tile label={`Peak · ${clock12(s.peakCovers.at)}`} value={String(s.peakCovers.covers)} />
        <Tile
          label="Large parties placed"
          value={`${s.placed}/${s.largeParties}`}
          warn={s.placed < s.largeParties}
        />
        <Tile
          label="Covers lost to holds"
          value={`~${s.coversLostToHolds} est.`}
          hint="seats × time held ÷ one 90-min turn"
        />
      </div>

      {!readOnly && (
        <div className="btn-row sheet-actions">
          <button type="button" onClick={onEdit}>
            Edit in editor
          </button>
          <button type="button" className="primary" onClick={onApply}>
            Apply to {nightLabel}
          </button>
        </div>
      )}

      <details className="more small">
        <summary>
          Capacity fit + cost by party ▸ {others.length > 0 ? `(${others.length} more)` : ""}
        </summary>
        <ul className="fit-list">
          {p.parties.map((f) => {
            const h = {
              key: `fit-${f.reservationId}`,
              ids: f.tables,
              label: `${partyName(f.reservationId)} · party of ${f.partySize}`,
            };
            return (
              <PartyFitCard
                key={f.reservationId}
                f={f}
                build={p.builds.find((b) => b.reservationId === f.reservationId)}
                focus={f.reservationId === focusId}
                onHover={(on) => highlight.onHover(on ? h : null)}
              />
            );
          })}
        </ul>
        {p.infeasible.map((x) => (
          <div key={x.reservationId} className="cant-fit">
            <strong>{partyName(x.reservationId)}</strong>{" "}
            <span className="small">{times12(namesIn(x.reason))}</span>
            {x.partial && (
              <div className="small muted">Best partial option: {times12(x.partial)}</div>
            )}
          </div>
        ))}
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
      </details>
    </div>
  );
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
