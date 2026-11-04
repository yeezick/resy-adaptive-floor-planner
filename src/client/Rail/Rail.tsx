import { useMemo, useState, type ReactNode } from "react";
import {
  clock12,
  LARGE_PARTY,
  planBuilds,
  times12,
  toHHMM,
  toMinutes,
  type Room,
} from "../../domain";
import { buildHighlight } from "../BuildPlan/BuildPlan";
import type { Highlight, HighlightControls } from "../highlight";
import { PHASE_LABEL, seatedParties, type DoneEntry, type WaitEntry } from "../lib/service";
import { SOURCE_LABEL, SOURCE_SHORT, VerdictChip } from "../requests/RequestSheet";
import { ProposedTag } from "../ProposedTag";
import {
  currentRequest,
  decisionOf,
  pendingCount,
  requestsBy,
  useRequests,
} from "../requests/store";
import { tableNo, tablesPhrase } from "../../domain/wording";
import { normalTimes } from "../lib/format";
import { partyName } from "../lib/names";

interface Props {
  room: Room;
  waitlist: WaitEntry[];
  done: DoneEntry[];
  highlight: HighlightControls;
  onWalkIn: () => void;
  onAddReservation: () => void;
  onSeatWaiting: (w: WaitEntry) => void;
  onRemoveWaiting: (id: string) => void;
  onSelectTables: (ids: string[]) => void;
  onFinish: (ids: string[]) => void;
  openRequest: string | null;
  onOpenRequest: (id: string) => void;
}

/** Long lists show this many rows until "Show all", so every list header stays on screen. */
const PREVIEW_ROWS = 6;

function ShowAll({
  shown,
  total,
  hidden,
  onToggle,
}: {
  shown: boolean;
  total: number;
  hidden: number;
  onToggle: () => void;
}) {
  if (!shown && hidden === 0) return null;
  return (
    <button type="button" className="show-all" aria-expanded={shown} onClick={onToggle}>
      {shown ? "Show fewer" : `Show all ${total} (${hidden} more)`}
    </button>
  );
}

const short = (area: string) => area;
const covers = (xs: { partySize: number }[]) => xs.reduce((n, x) => n + x.partySize, 0);

function hoverProps(highlight: HighlightControls, h: Highlight | null) {
  return h
    ? {
        onMouseEnter: () => highlight.onHover(h),
        onMouseLeave: () => highlight.onHover(null),
        onFocus: () => highlight.onHover(h),
        onBlur: () => highlight.onHover(null),
      }
    : {};
}

/** Guests who asked to hear if a table opens (a standby list). Fictional, per session. */
interface StandbyEntry {
  id: string;
  partySize: number;
  window: string;
  needs: string[];
}
function standbyFor(room: Room): StandbyEntry[] {
  const t = toMinutes(room.clock);
  const at = (m: number) => toHHMM(Math.min(t + m, 22 * 60));
  return [
    { id: "S1", partySize: 2, window: `${at(20)}–${at(80)}`, needs: [] },
    { id: "S2", partySize: 4, window: `${at(50)}–${at(110)}`, needs: ["view"] },
    { id: "S3", partySize: 6, window: `${at(90)}–${at(150)}`, needs: [] },
  ];
}

const matches = (q: string, ...parts: (string | number | undefined)[]) =>
  !q || parts.some((x) => x !== undefined && String(x).toLowerCase().includes(q));

export function Rail(p: Props) {
  const { room, done, highlight } = p;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const waitlist = p.waitlist.filter((w) => matches(q, w.partySize, w.id, ...w.needs));
  const standby = useMemo(() => standbyFor(room), [room]).filter((s) =>
    matches(q, s.partySize, s.window, ...s.needs),
  );
  const now = toMinutes(room.clock);
  const seated = useMemo(() => seatedParties(room), [room]);
  const [allUp, setAllUp] = useState(false);
  const [allSeated, setAllSeated] = useState(false);
  const allReservations = useMemo(
    () => [...room.reservations].sort((a, b) => toMinutes(a.time) - toMinutes(b.time)),
    [room.reservations],
  );
  const reservations = allReservations.filter((r) =>
    matches(q, r.id, r.partySize, r.time, r.area, ...r.needs),
  );
  // Where each large party would be built, so hovering an Upcoming row shows it.
  const builds = useMemo(() => {
    const plan = planBuilds(room, "00:00", "23:59");
    return new Map(plan.builds.map((b) => [b.reservationId, b]));
  }, [room]);
  const held = room.tables
    .filter((t) => t.status === "reserved")
    .sort((a, b) => toMinutes(a.reservedAt ?? "23:59") - toMinutes(b.reservedAt ?? "23:59"));
  const walkIn = (
    <button type="button" className="rail-action" onClick={p.onWalkIn}>
      + Walk-in
    </button>
  );

  return (
    <div className="rail-lists">
      <div className="rail-search">
        <label className="sr-only" htmlFor="rail-search">
          Search guest lists
        </label>
        <input
          id="rail-search"
          type="search"
          placeholder="Search party, time, table…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <RequestsSection
        open={p.openRequest}
        onOpen={p.onOpenRequest}
        query={q}
        night={{ roomId: p.room.id, clock: p.room.clock }}
      />
      <RailSection
        title="Standby"
        parties={standby.length}
        covers={covers(standby)}
        defaultOpen={false}
      >
        <p className="rail-note">Asked to hear if a table opens</p>
        <ul className="rows">
          {standby.map((s) => (
            <li key={s.id} className="row">
              <span className="row-time">{clock12(s.window.split("–")[0] ?? "")}</span>
              <span className="row-party">{s.partySize}</span>
              <span className="row-main">
                <span className="row-sub">wants {times12(s.window)}</span>
                {s.needs.length > 0 && (
                  <span className="needs">
                    {s.needs.map((n) => (
                      <span key={n} className="need">
                        {n}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="row-finish"
                onClick={() =>
                  p.onSeatWaiting({
                    id: s.id,
                    partySize: s.partySize,
                    needs: s.needs as WaitEntry["needs"],
                    quoteMin: 0,
                    addedAt: room.clock,
                  })
                }
              >
                Offer
              </button>
            </li>
          ))}
        </ul>
      </RailSection>
      <RailSection
        title="Waitlist"
        defaultOpen={p.waitlist.length > 0}
        parties={waitlist.length}
        covers={covers(waitlist)}
        action={walkIn}
      >
        {waitlist.length === 0 ? (
          <p className="rail-empty">Nobody waiting.</p>
        ) : (
          <ul className="rows">
            {waitlist.map((w) => (
              <li key={w.id} className="row">
                <span className="row-time">{clock12(w.addedAt)}</span>
                <span className="row-party">{w.partySize}</span>
                <span className="row-main">
                  <span className="row-sub">
                    {w.name ? `${w.name} · ` : ""}quoted ~{w.quoteMin} min
                    {w.tables?.length ? ` · for ${tablesPhrase(w.tables)}` : ""}
                    {w.note ? ` · ${w.note}` : ""}
                  </span>
                  {w.needs.length > 0 && (
                    <span className="needs">
                      {w.needs.map((n) => (
                        <span key={n} className="need">
                          {n}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="row-actions">
                    <button type="button" onClick={() => p.onSeatWaiting(w)}>
                      Seat
                    </button>
                    <button type="button" onClick={() => p.onRemoveWaiting(w.id)}>
                      Remove
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection
        title="Booked"
        parties={reservations.length}
        covers={covers(reservations)}
        action={
          <button type="button" className="rail-action" onClick={p.onAddReservation}>
            + Book
          </button>
        }
      >
        {reservations.length === 0 ? (
          <p className="rail-empty">No reservations in the book.</p>
        ) : (
          <ul className="rows">
            {(allUp ? reservations : reservations.slice(0, PREVIEW_ROWS)).map((r) => {
              const build = builds.get(r.id);
              const h = build ? { ...buildHighlight(build), key: `up-${r.id}` } : null;
              return (
                <li
                  key={r.id}
                  className={`row${toMinutes(r.time) < now ? " is-past" : ""}`}
                  tabIndex={h ? 0 : undefined}
                  {...hoverProps(highlight, h)}
                >
                  <span className="row-time">{clock12(r.time)}</span>
                  <span className="row-main">
                    <span className="row-name">
                      <strong>{partyName(r.id)}</strong>
                      <span className="row-party-inline">
                        <span aria-hidden="true">{r.partySize}</span>
                        <span className="sr-only">party of {r.partySize}</span>
                      </span>
                      <span className="row-table">
                        {build ? tablesPhrase(build.tables) : "unassigned"}
                      </span>
                    </span>
                    {(r.partySize >= LARGE_PARTY || r.needs.length > 0) && (
                      <span className="needs">
                        {r.partySize >= LARGE_PARTY && (
                          <span className={build ? "tag" : "tag tag-warn"}>
                            {build ? "build" : "no fit"}
                          </span>
                        )}
                        {r.needs.map((n) => (
                          <span key={n} className="need">
                            {n}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <ShowAll
          shown={allUp}
          total={reservations.length + held.length}
          hidden={Math.max(0, reservations.length - PREVIEW_ROWS) + held.length}
          onToggle={() => setAllUp((v) => !v)}
        />
        {allUp && held.length > 0 && (
          <>
            <div className="rail-sub">Held tables · {held.length}</div>
            <ul className="rows">
              {held.map((t) => (
                <li key={t.id} className="row">
                  <button
                    type="button"
                    className="row-btn"
                    onClick={() => p.onSelectTables([t.id])}
                    {...hoverProps(highlight, {
                      key: `held-${t.id}`,
                      ids: [t.id],
                      label: `Table ${tableNo(t.id)} held for ${t.reservedAt ? clock12(t.reservedAt) : "later"}`,
                    })}
                  >
                    <span className="row-time">{t.reservedAt ? clock12(t.reservedAt) : "—"}</span>
                    <span className="row-party">{t.seats}</span>
                    <span className="row-main">
                      <span className="row-sub">
                        <strong>Table {tableNo(t.id)}</strong> · {short(t.area)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </RailSection>

      <RailSection title="Seated" parties={seated.length} covers={covers(seated)} action={walkIn}>
        {seated.length === 0 ? (
          <p className="rail-empty">No one seated.</p>
        ) : (
          <ul className="rows">
            {(allSeated ? seated : seated.slice(0, PREVIEW_ROWS)).map((s) => (
              <li
                key={s.key}
                className="row row-seated"
                {...hoverProps(highlight, {
                  key: `seated-${s.key}`,
                  ids: s.ids,
                  label: `${s.ids.join("+")} · ${PHASE_LABEL[s.phase]}`,
                })}
              >
                <span className={`phase-chip phase-${s.phase}`}>{PHASE_LABEL[s.phase]}</span>
                <span className="row-party">{s.partySize}</span>
                <span className="row-main">
                  <button
                    type="button"
                    className="link-btn row-sub"
                    onClick={() => p.onSelectTables(s.ids)}
                  >
                    <strong>{s.ids.join("+")}</strong>{" "}
                    <span className="muted">{s.area.split(" ")[0]}</span>
                  </button>
                </span>
                <button type="button" className="row-finish" onClick={() => p.onFinish(s.ids)}>
                  Finish
                </button>
              </li>
            ))}
          </ul>
        )}
        <ShowAll
          shown={allSeated}
          total={seated.length}
          hidden={Math.max(0, seated.length - PREVIEW_ROWS)}
          onToggle={() => setAllSeated((v) => !v)}
        />
      </RailSection>

      <RailSection title="Done" parties={done.length} covers={covers(done)}>
        {done.length === 0 ? (
          <p className="rail-empty">No parties finished this session.</p>
        ) : (
          <ul className="rows">
            {[...done].reverse().map((d) => (
              <li key={d.id} className="row">
                <span className="row-time">{clock12(d.finishedAt)}</span>
                <span className="row-party">{d.partySize}</span>
                <span className="row-main">
                  <span className="row-sub">{d.tables.join("+")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </div>
  );
}

function RequestsSection({
  open,
  onOpen,
  query,
  night,
}: {
  open: string | null;
  onOpen: (id: string) => void;
  query: string;
  /** The night on screen: only requests received by its clock are listed. */
  night: { roomId: string; clock: string };
}) {
  const s = useRequests();
  // as the request stands now (the manager's applied changes), received by this night's clock
  const list = requestsBy(s, night)
    .map((r) => currentRequest(s, r))
    .filter((r) => matches(query, r.id, r.partySize, r.day, r.time, r.occasion));
  const badge = pendingCount(s, night);
  return (
    <RailSection
      title="Requests"
      parties={list.length}
      covers={covers(list)}
      badge={badge}
      countText={`${badge} open ${badge === 1 ? "request" : "requests"}${
        list.length > badge ? ` · ${list.length - badge} decided` : ""
      }`}
    >
      {s.error && <p className="rail-empty">Requests unavailable: {s.error.message}</p>}
      {!s.error && !s.book && <p className="rail-empty">Loading requests…</p>}
      {s.book && (
        <p className="rail-note">
          <ProposedTag /> Parties above the online cap of {s.book.onlineCap}
        </p>
      )}
      <ul className="rows">
        {list.map((r) => {
          const t = s.triage[r.id];
          const d = decisionOf(s, r.id);
          return (
            <li key={r.id} className={`row row-request${open === r.id ? " is-open" : ""}`}>
              <button
                type="button"
                className="row-btn"
                aria-current={open === r.id ? "true" : undefined}
                onClick={() => onOpen(r.id)}
              >
                <span className="row-time">
                  {r.day}
                  <br />
                  {clock12(r.time)}
                </span>
                <span className="row-party">
                  <span aria-hidden="true">{r.partySize} ppl</span>
                  <span className="sr-only">party of {r.partySize}</span>
                </span>
                <span className="row-main">
                  <span className="row-sub">
                    <VerdictChip t={t} override={s.overrides[r.id]} />
                  </span>
                  <span className="row-source muted" title={SOURCE_LABEL[r.source]}>
                    {SOURCE_SHORT[r.source]}
                  </span>
                  {t?.status === "ok" && (
                    <span className="req-lines">
                      <span>{normalTimes(times12(t.result.summary[0] ?? ""))}</span>
                    </span>
                  )}
                  {d.kind !== "pending" ? (
                    <span className={`tag tag-${d.kind}`}>
                      {d.kind === "declined" ? `declined · ${d.reason}` : d.kind}
                    </span>
                  ) : (
                    s.replies[r.id] && <span className="tag tag-replied">replied</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </RailSection>
  );
}

interface SectionProps {
  title: string;
  parties: number;
  covers: number;
  action?: ReactNode;
  defaultOpen?: boolean;
  /** Count of items waiting for someone (shown as a badge). */
  badge?: number;
  /** Replaces the "N parties · M cov" line. */
  countText?: string;
  children: ReactNode;
}

function RailSection({
  title,
  parties,
  covers,
  action,
  defaultOpen = true,
  badge,
  countText,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `rail-${title.toLowerCase()}`;
  return (
    <section className="rail-section" aria-labelledby={`${id}-h`}>
      <div className="rail-title">
        <button
          type="button"
          id={`${id}-h`}
          className="rail-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="rail-name">
            <span className="rail-name-row">
              {title}
              {badge ? (
                <span className="badge">
                  <span aria-hidden="true">{badge}</span>
                  <span className="sr-only">{badge} waiting</span>
                </span>
              ) : null}
            </span>
            <span className="rail-count">
              {countText ?? `${parties} ${parties === 1 ? "party" : "parties"} · ${covers} cov`}
            </span>
          </span>
        </button>
        {action}
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
