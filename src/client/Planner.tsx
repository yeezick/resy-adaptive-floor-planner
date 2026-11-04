import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clock12,
  times12,
  applyCombine,
  applyMove,
  applySplit,
  comboOf,
  findTablesForParty,
  joinReadiness,
  joinBadge,
  readinessPill,
  tableById,
  type Room,
  type TonightProposal,
} from "../domain";
import type { AppliedPlan, EditRequest } from "./LayoutHost";
import { LayoutsList } from "./layouts/LayoutsList";
import { tonightName, type LayoutsApi } from "./layouts/useLayouts";
import { TonightPanel } from "./Tonight/TonightPanel";
import { AgentPanel } from "./AgentPanel/AgentPanel";
import { BuildPlan } from "./BuildPlan/BuildPlan";
import { ConsoleBar, type PanelMode } from "./ConsoleBar";
import { CoversStrip } from "./CoversStrip";
import { FloorPlan } from "./FloorPlan/FloorPlan";
import { tabForTables } from "./FloorPlan/geometry";
import { Legend } from "./FloorPlan/Legend";
import { SelectionBar } from "./FloorPlan/SelectionBar";
import { TableDetails } from "./FloorPlan/TableDetails";
import type { Highlight, HighlightControls } from "./highlight";
import { finishParty, seatParty, type DoneEntry, type WaitEntry } from "./lib/service";
import { Rail } from "./Rail/Rail";
import { RequestSheet } from "./requests/RequestSheet";
import { ProposedTag } from "./ProposedTag";
import { pendingCount, requestsActions, useRequests } from "./requests/store";
import { ReservationSheet } from "./WalkIn/ReservationSheet";
import { WalkInSheet, type WalkInDraft } from "./WalkIn/WalkInSheet";
import { tablesPhrase } from "../domain/wording";
import { activeScenario } from "./scenarios";
import { NIGHTS, nightDate } from "./nights";
import { partyName, surname } from "./lib/names";

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const PANEL_TITLE: Record<PanelMode, string> = {
  details: "Table details",
  walkin: "Walk-in",
  assistant: "AI Planner",
  shift: "Shift setup",
  reservation: "Add reservation",
  request: "Large-party request",
};

/** Owns the edited room and the session's waitlist / done lists. Remounted per fixture. */
interface PlannerProps {
  fixture: Room;
  roomSelect: ReactNode;
  layouts: LayoutsApi;
  onEditLayout: (req: EditRequest) => void;
  /** Set when a manager just accepted a request for this night: open its plan with the party in focus. */
  focusRequest?: string;
  /** "request": open that request's sheet (not the plan) with its fit outlined on the floor. */
  focusView?: "plan" | "request";
  /** The tonight plan applied to the layout in use, if this session applied it. */
  applied?: AppliedPlan | null;
  onApplied?: (
    p: TonightProposal,
    baseRoom: Room,
    meta: { name: string; date?: string; shift?: string },
  ) => void;
  onUndoApply?: () => void;
}

export function Planner({
  fixture,
  roomSelect,
  layouts,
  onEditLayout,
  focusRequest: focus,
  focusView,
  applied = null,
  onApplied,
  onUndoApply,
}: PlannerProps) {
  const focusRequest = focusView === "request" ? undefined : focus;
  const [room, setRoom] = useState(fixture);
  const [proposal, setProposal] = useState<TonightProposal | null>(null);
  const [edited, setEdited] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [hover, setHover] = useState<Highlight | null>(null);
  const [pinned, setPinned] = useState<Highlight | null>(null);
  const [mode, setMode] = useState<PanelMode>(
    focusView === "request"
      ? "request"
      : focusRequest
        ? "shift"
        : activeScenario()?.panel === "assistant" && activeScenario()?.roomId === fixture.id
          ? "assistant"
          : "details",
  );
  const [openRequest, setOpenRequest] = useState<string | null>(
    focusView === "request" ? (focus ?? null) : null,
  );
  const requests = useRequests();
  // The planner is a fixed-height app shell: rail, floor and sheet scroll on their own, the console bar stays.
  useEffect(() => {
    document.documentElement.classList.add("planner-shell");
    return () => document.documentElement.classList.remove("planner-shell");
  }, []);
  // iPad: an open sheet collapses the rail to a strip; the host can expand it again.
  const [railOpen, setRailOpen] = useState(false);
  const [railFor, setRailFor] = useState(false);
  const request = requests.book?.requests.find((r) => r.id === openRequest) ?? null;

  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [draft, setDraft] = useState<WalkInDraft>({ size: 2, needs: [] });
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const nextId = useRef(1);

  // Walk-in suggestions are computed once here: listed in the sheet and outlined on the floor.
  const fit = useMemo(
    () =>
      mode === "walkin"
        ? findTablesForParty(room, { partySize: draft.size, needs: draft.needs, maxOptions: 12 })
        : null,
    [mode, room, draft.size, draft.needs],
  );
  const suggested: Highlight | null =
    fit && fit.options.length
      ? {
          key: "walkin-suggested",
          ids: [...new Set(fit.options.slice(0, 3).flatMap((o) => o.tables))],
          label: `Suggested for party of ${draft.size}`,
        }
      : null;
  // Opening an accepted request's night: show (and outline) that party's tables.
  const shownPlan = proposal ?? applied?.proposal ?? null;
  const focusTables = useMemo(
    () =>
      shownPlan && focusRequest
        ? [
            ...new Set(
              shownPlan.changes
                .filter((c) => c.reservationId === focusRequest)
                .flatMap((c) => c.tables),
            ),
          ]
        : [],
    [shownPlan, focusRequest],
  );
  const focusTab = focusTables.length
    ? tabForTables(shownPlan?.variant ?? room, focusTables)
    : "first";
  const focusHighlight: Highlight | null = focusTables.length
    ? {
        key: `focus-${focusRequest}`,
        ids: focusTables,
        label: `${focusRequest ? partyName(focusRequest) : ""} · just accepted`,
      }
    : null;
  // An open request whose night is on screen: outline the tables its fit check would hold.
  const reqTables = useMemo(
    () =>
      mode === "request" && request && request.bookRoomId === room.id
        ? (requests.fitTables[request.id] ?? [])
        : [],
    [mode, request, room.id, requests.fitTables],
  );
  const reqReady = useMemo(
    () =>
      reqTables.length
        ? joinReadiness(room, reqTables, request ? (requests.fitReadyAt[request.id] ?? null) : null)
        : null,
    [room, reqTables, request, requests.fitReadyAt],
  );
  const reqHighlight: Highlight | null =
    reqTables.length && reqReady
      ? {
          key: `req-${request?.id}`,
          ids: reqTables,
          label: `${request ? surname(request.contact) : ""} · party of ${request?.partySize} · ${readinessPill(reqReady)}`,
          source: "fit",
          badges: Object.fromEntries(reqReady.tables.map((t) => [t.id, joinBadge(t, reqReady)])),
        }
      : null;
  const highlight = hover ?? pinned ?? suggested ?? focusHighlight ?? reqHighlight;
  const controls: HighlightControls = {
    pinnedKey: pinned?.key ?? null,
    onHover: setHover,
    onTogglePin: (h) => setPinned((p) => (p?.key === h.key ? null : h)),
  };

  const run = (fn: () => Room, message: string): ActionResult => {
    try {
      setRoom(fn());
      setEdited(true);
      const r: ActionResult = { ok: true, message };
      setNotice(r);
      return r;
    } catch (err) {
      const r: ActionResult = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
      setNotice(r);
      return r;
    }
  };

  const combine = (ids: string[]) => {
    const r = run(() => applyCombine(room, ids), `Combined ${tablesPhrase(ids)}`);
    if (r.ok) setSelected([]);
    return r;
  };
  const combineRows = (rows: string[][]) =>
    run(
      () => rows.reduce((next, r) => applyCombine(next, r), room),
      `Combined ${rows.map((r) => tablesPhrase(r)).join("; ")}`,
    );
  const split = (ids: string[]) => {
    const combos = new Set(ids.map((id) => comboOf(room, id)).filter((c) => c !== undefined));
    run(
      () => {
        let next = room;
        for (const c of combos) next = applySplit(next, c[0] as string);
        return next;
      },
      `Split ${[...combos].map((c) => tablesPhrase(c)).join("; ")}`,
    );
  };
  const move = (id: string, x: number, y: number) =>
    run(() => applyMove(room, id, x, y), `Moved ${id}`);
  const toggle = (id: string) => {
    if (selected.length === 0 && mode !== "walkin") setMode("details");
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const openWalkIn = (d: Partial<WalkInDraft> & { ids?: string[] } = {}) => {
    setDraft({ size: d.size ?? 2, needs: d.needs ?? [], waitId: d.waitId });
    setSelected(d.ids ?? []);
    setMode("walkin");
  };
  const seat = (ids: string[], size: number) => {
    const r = run(
      () => seatParty(room, ids, size),
      `Seated party of ${size} at ${tablesPhrase(ids)}`,
    );
    if (!r.ok) return;
    if (draft.waitId) setWaitlist((w) => w.filter((x) => x.id !== draft.waitId));
    setSelected([]);
    setMode("details");
  };
  const addToWaitlist = (quoteMin: number) => {
    const entry: WaitEntry = {
      id: `W${nextId.current++}`,
      partySize: draft.size,
      needs: draft.needs,
      quoteMin,
      addedAt: room.clock,
    };
    setWaitlist((w) => [...w, entry]);
    setNotice({ ok: true, message: `Party of ${draft.size} waitlisted, quoted ~${quoteMin} min` });
    setSelected([]);
    setMode("details");
  };
  const finish = (ids: string[]) => {
    const size = Math.max(...ids.map((id) => tableById(room, id)?.partySize ?? 0));
    const r = run(() => finishParty(room, ids), `Finished ${tablesPhrase(ids)} — tables open`);
    if (!r.ok) return;
    setDone((d) => [
      ...d,
      { id: `D${nextId.current++}`, partySize: size, tables: ids, finishedAt: room.clock },
    ]);
    setSelected((s) => s.filter((id) => !ids.includes(id)));
  };
  const reset = () => {
    setRoom(fixture);
    setEdited(false);
    setSelected([]);
    setPinned(null);
    setNotice({ ok: true, message: "Reset to the original room" });
  };

  const night = NIGHTS[room.id];
  const hasSheet = mode !== "details" || selected.length > 0;
  // the expanded rail resets each time a sheet closes
  if (railFor !== hasSheet) {
    setRailFor(hasSheet);
    if (!hasSheet && railOpen) setRailOpen(false);
  }
  const openCount = pendingCount(requests);
  return (
    <div className={`console${hasSheet ? " has-sheet" : ""}${railOpen ? " rail-open" : ""}`}>
      <ConsoleBar
        room={room}
        roomSelect={roomSelect}
        layoutName={layouts.active.name}
        edited={edited}
        notice={notice}
        mode={mode}
        onMode={(m) => (m === "walkin" ? openWalkIn() : setMode(m))}
        onReset={reset}
      />
      {proposal && (
        <div className="preview-bar" role="status">
          <strong>Previewing the night's layout</strong> ·{" "}
          {times12(`${proposal.window.from}–${proposal.window.to}`)} · nothing changes until you
          apply it
          <button type="button" className="link-btn" onClick={() => setProposal(null)}>
            Exit preview
          </button>
        </div>
      )}
      <div className="console-body">
        <aside className="rail" aria-label="Guest lists">
          <button
            type="button"
            className="rail-collapse"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((o) => !o)}
          >
            {railOpen ? (
              "‹ Hide lists"
            ) : (
              <>
                <span>Lists ›</span>
                {openCount > 0 && (
                  <span className="badge" aria-label={`${openCount} open requests`}>
                    {openCount}
                  </span>
                )}
              </>
            )}
          </button>
          <Rail
            room={room}
            waitlist={waitlist}
            done={done}
            highlight={controls}
            onWalkIn={() => openWalkIn()}
            onAddReservation={() => setMode("reservation")}
            onSeatWaiting={(w) => openWalkIn({ size: w.partySize, needs: w.needs, waitId: w.id })}
            onRemoveWaiting={(id) => setWaitlist((w) => w.filter((x) => x.id !== id))}
            onSelectTables={(ids) => {
              setSelected(ids);
              if (mode !== "walkin") setMode("details");
            }}
            onFinish={finish}
            openRequest={mode === "request" ? openRequest : null}
            onOpenRequest={(id) => {
              setOpenRequest(id);
              setMode("request");
            }}
          />
        </aside>

        <section className="floor-col" aria-label="Floor plan">
          <FloorPlan
            key={proposal ? "preview" : reqTables.length ? `req-${request?.id}` : "live"}
            initialTab={
              proposal ? focusTab : reqTables.length ? tabForTables(room, reqTables) : undefined
            }
            room={proposal?.variant ?? room}
            selected={proposal ? [] : selected}
            highlight={highlight}
            onToggle={proposal ? () => undefined : toggle}
            onMove={proposal ? () => undefined : move}
            changes={proposal?.changes}
            fitKey={hasSheet ? "sheet" : "full"}
          />
          <CoversStrip room={room} />
          <details
            className="legend-key"
            open={room.tables.some((t) => t.status === "occupied") || undefined}
          >
            <summary className="small">Key ▸</summary>
            <Legend />
          </details>
        </section>

        <aside className="side-col" aria-labelledby="panel-title">
          <div className="panel-head">
            <h2 id="panel-title">
              {PANEL_TITLE[mode]}{" "}
              {(mode === "assistant" || mode === "shift" || mode === "request") && <ProposedTag />}
            </h2>
            {(mode !== "details" || selected.length > 0) && (
              <button
                type="button"
                className="link-btn"
                onClick={() => (mode !== "details" ? setMode("details") : setSelected([]))}
              >
                Close
              </button>
            )}
          </div>
          <div className="tabpanel" hidden={mode !== "details"}>
            <SelectionBar
              room={room}
              selected={selected}
              onCombine={combine}
              onSplit={split}
              onClear={() => setSelected([])}
            />
            <TableDetails room={room} selected={selected} onFinish={finish} />
          </div>
          {mode === "walkin" && (
            <div className="tabpanel">
              <WalkInSheet
                room={room}
                fit={fit}
                highlight={controls}
                draft={draft}
                selected={selected}
                onDraft={setDraft}
                onSelect={setSelected}
                onSeat={seat}
                onWaitlist={addToWaitlist}
              />
            </div>
          )}
          {/* Kept mounted so the conversation survives switching panels. */}
          <div className="tabpanel" hidden={mode !== "assistant"}>
            <AgentPanel
              room={room}
              highlight={controls}
              onApplyRows={combineRows}
              onSelectTables={(ids, size) => openWalkIn({ ids, size })}
              onOpenShift={() => setMode("shift")}
            />
          </div>
          {mode === "request" && request && (
            <div className="tabpanel">
              <RequestSheet
                key={request.id}
                request={request}
                roomId={room.id}
                now={
                  night && request.bookRoomId === room.id
                    ? { day: night.day, clock: room.clock }
                    : null
                }
              />
            </div>
          )}
          {mode === "reservation" && (
            <div className="tabpanel">
              <ReservationSheet
                clock={room.clock}
                onAdd={(r) => {
                  const res = run(
                    () => ({
                      ...room,
                      reservations: [...room.reservations, { ...r, id: `N${nextId.current++}` }],
                    }),
                    `Booked party of ${r.partySize} at ${clock12(r.time)}`,
                  );
                  if (res.ok) setMode("details");
                }}
              />
            </div>
          )}
          {mode === "shift" && (
            <div className="tabpanel">
              <TonightPanel
                layouts={layouts}
                autoGenerate={focusRequest && !applied ? { from: "17:00", to: "22:00" } : undefined}
                focusId={focusRequest}
                applied={applied?.proposal ?? null}
                nightLabel={night?.label ?? room.name}
                nightDay={night?.day}
                onUndoApply={onUndoApply}
                onUndoAccept={
                  focusRequest
                    ? () => {
                        const r = requests.book?.requests.find((x) => x.id === focusRequest);
                        if (!r) return;
                        onUndoApply?.();
                        requestsActions.reopen(r);
                        requestsActions.viewNight(r);
                      }
                    : undefined
                }
                proposal={proposal}
                highlight={controls}
                onProposal={setProposal}
                onEdit={(r, name) =>
                  onEditLayout({
                    room: r,
                    name,
                    layoutId: null,
                    date: today(),
                    shift: proposal ? `${proposal.window.from}–${proposal.window.to}` : undefined,
                  })
                }
                onApply={(p) => {
                  setProposal(null);
                  onApplied?.(p, layouts.active.room, {
                    name: tonightName(p.window.from, p.window.to, night?.day),
                    date: night ? nightDate(night.day) : today(),
                    shift: `${p.window.from}–${p.window.to}`,
                  });
                }}
              />
              <details className="layouts-details">
                <summary>Layouts ▸</summary>
                <LayoutsList
                  layouts={layouts}
                  onEdit={(r, name, id) => onEditLayout({ room: r, name, layoutId: id })}
                />
              </details>
              {!shownPlan && (
                <details className="buildplan-details">
                  <summary>Large-party build plan for the layout in use (read-only)</summary>
                  <BuildPlan room={room} highlight={controls} />
                </details>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
