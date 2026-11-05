import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clock12,
  times12,
  applyCombine,
  checkTableSet,
  applyMove,
  applySplit,
  comboOf,
  ELAPSED_EST_MIN,
  findTablesForParty,
  joinReadiness,
  joinBadge,
  readinessPill,
  tableById,
  type Room,
  type LayoutChange,
  type TonightProposal,
} from "../domain";
import type { AppliedPlan, EditRequest } from "./LayoutHost";
import { LayoutsList } from "./layouts/LayoutsList";
import { tonightName, type LayoutsApi } from "./layouts/useLayouts";
import { TonightPanel } from "./Tonight/TonightPanel";
import { FloorChat, shiftFloorStore, useShiftFloor } from "./Tonight/FloorChat";
import { AgentPanel } from "./AgentPanel/AgentPanel";
import { BuildPlan } from "./BuildPlan/BuildPlan";
import { ConsoleBar, type PanelMode } from "./ConsoleBar";
import { CoversStrip } from "./CoversStrip";
import { FloorPlan } from "./FloorPlan/FloorPlan";
import { dividerKey, tabForTables } from "./FloorPlan/geometry";
import { SelectionBar } from "./FloorPlan/SelectionBar";
import { TableDetails } from "./FloorPlan/TableDetails";
import type { Highlight, HighlightControls } from "./highlight";
import {
  finishParty,
  PHASE_LABEL,
  revertAction,
  seatParty,
  setPhase,
  type DoneEntry,
  type WaitEntry,
} from "./lib/service";
import { planHolds } from "./lib/holds";
import { Rail } from "./Rail/Rail";
import { RequestSheet } from "./requests/RequestSheet";
import { ProposedTag } from "./ProposedTag";
import {
  currentRequest,
  decisionOf,
  pendingCount,
  requestsActions,
  useRequests,
} from "./requests/store";
import { setDemoNight } from "./lib/demoClock";
import { ReservationSheet } from "./WalkIn/ReservationSheet";
import { WalkInSheet, type WalkInDraft } from "./WalkIn/WalkInSheet";
import { WalkInReview, type WalkInConfirm, type WalkInReviewDraft } from "./Review/WalkInReview";
import { activityActions } from "./activity/store";
import { tablesPhrase } from "../domain/wording";
import { activeScenario } from "./scenarios";
import { NIGHTS, nightDate } from "./nights";
import { partyName, surname } from "./lib/names";

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const PANEL_TITLE: Record<PanelMode, string> = {
  details: "Table details",
  walkin: "Walk-in",
  assistant: "✦ AI Planner",
  shift: "Shift setup",
  reservation: "Add reservation",
  request: "Large-party request",
  review: "Review and confirm",
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
  /** Apply the crew plan as soon as it is generated (Accept already confirmed it). */
  focusApply?: boolean;
  /** The tonight plan applied to the layout in use, if this session applied it. */
  applied?: AppliedPlan | null;
  onApplied?: (
    p: TonightProposal,
    baseRoom: Room,
    meta: { name: string; date?: string; shift?: string },
  ) => void;
  onUndoApply?: () => void;
}

/** The divider walls a set of tables opens: one per pair of neighbouring rooms it spans. */
function openedBy(room: Room, tables: readonly string[]): string[] {
  const areas = [...new Set(tables.map((id) => room.tables.find((t) => t.id === id)?.area))]
    .map((n) => room.areas.find((a) => a.name === n))
    .filter((a): a is NonNullable<typeof a> => !!a?.suite)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const out: string[] = [];
  for (let i = 1; i < areas.length; i++)
    out.push(
      dividerKey((areas[i - 1] as { name: string }).name, (areas[i] as { name: string }).name),
    );
  return out;
}

export function Planner({
  fixture,
  roomSelect,
  layouts,
  onEditLayout,
  focusRequest: focus,
  focusView,
  focusApply = false,
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
  // A hover counts only once the pointer has moved: when a panel redraws under a still cursor (e.g. after
  // Accept), the row that lands under it must not take over the floor from the party in focus.
  const [hoverArmed, setHoverArmed] = useState(!focus);
  const [armedFor, setArmedFor] = useState(focus);
  if (armedFor !== focus) {
    setArmedFor(focus);
    setHoverArmed(false);
    setHover(null);
  }
  useEffect(() => {
    if (hoverArmed) return;
    // re-armed by a pointer move or by the keyboard (focus highlights rows too)
    const arm = () => setHoverArmed(true);
    window.addEventListener("pointermove", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointermove", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [hoverArmed]);
  const [pinned, setPinned] = useState<Highlight | null>(null);
  const [mode, setMode] = useState<PanelMode>(() =>
    focusView === "request"
      ? "request"
      : focusRequest || shiftFloorStore.wantsReopen(fixture.id)
        ? "shift"
        : activeScenario()?.panel === "assistant" && activeScenario()?.roomId === fixture.id
          ? "assistant"
          : "details",
  );
  useEffect(() => shiftFloorStore.clearReopen(), []);
  const [openRequest, setOpenRequest] = useState<string | null>(
    focusView === "request" ? (focus ?? null) : null,
  );
  // A highlight pinned in one panel (e.g. "AI option 1") ends when that panel closes or another opens.
  const [pinnedFor, setPinnedFor] = useState(mode);
  if (pinnedFor !== mode) {
    setPinnedFor(mode);
    setPinned(null);
    setHover(null);
  }
  const requests = useRequests();
  // every stamp the demo writes reads the clock of the night on screen
  useEffect(() => setDemoNight(room.id, room.clock), [room.id, room.clock]);
  // The planner is a fixed-height app shell: rail, floor and sheet scroll on their own, the console bar stays.
  useEffect(() => {
    document.documentElement.classList.add("planner-shell");
    return () => document.documentElement.classList.remove("planner-shell");
  }, []);
  // iPad: an open sheet collapses the rail to a strip; the host can expand it again.
  const [railOpen, setRailOpen] = useState(false);
  // Tables whose meal phase the host set by hand (the rest come from the simulated POS feed).
  const [phaseByHost, setPhaseByHost] = useState<ReadonlySet<string>>(new Set());
  // When the host first changes a table's phase, its "seated ~N min ago" is kept as it was.
  const [seatedAgo, setSeatedAgo] = useState<ReadonlyMap<string, number>>(new Map());
  const [railFor, setRailFor] = useState(false);
  const request = requests.book?.requests.find((r) => r.id === openRequest) ?? null;

  const [notice, setNotice] = useState<ActionResult | null>(null);
  // a toast floats over the floor and clears itself; it never takes room in the bar or the panel
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), notice.ok ? 3500 : 6000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const [draft, setDraft] = useState<WalkInDraft>({ size: 2, needs: [] });
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const nextId = useRef(1);
  // The review screen before any AI Planner option commits (tables editable by tapping the floor).
  const [review, setReview] = useState<{ draft: WalkInReviewDraft; tables: string[] } | null>(null);
  // Result lines of AI options the host acted on (by card key), each with its own Undo.
  const [aiDone, setAiDone] = useState<Record<string, { text: string; undo: () => void }>>({});
  // Tables promised (waitlisted for) or seated from an AI option: older options using them read "taken".
  const [taken, setTaken] = useState<ReadonlyMap<string, string>>(new Map());
  // "New chat" starts a fresh AI Planner thread.
  const [chatSeq, setChatSeq] = useState(0);
  // Where Close / Back returns: the panel the host came from (e.g. the AI Planner under Table details).
  const [back, setBack] = useState<PanelMode[]>([]);
  const goTo = (m: PanelMode) => {
    if (m !== mode && (mode === "assistant" || mode === "request" || mode === "shift"))
      setBack((b) => [...b, mode]);
    setMode(m);
  };
  const closePanel = () => {
    const prev = back[back.length - 1];
    setBack((b) => b.slice(0, -1));
    setSelected([]);
    if (mode === "review") setReview(null);
    setMode(prev ?? "details");
  };

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
  const focusDecision = focusRequest ? decisionOf(requests, focusRequest) : null;
  const focusTables = useMemo(() => {
    if (!focusRequest) return [];
    const changed = shownPlan
      ? [
          ...new Set(
            shownPlan.changes
              .filter((c) => c.reservationId === focusRequest)
              .flatMap((c) => c.tables),
          ),
        ]
      : [];
    // nothing to move for the party: show the tables Accept held
    return changed.length
      ? changed
      : focusDecision?.kind === "accepted"
        ? focusDecision.tables
        : [];
  }, [shownPlan, focusRequest, focusDecision]);
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
  // A floor change the request chat proposed for the night on screen: drawn (before ghosted → after, arrows)
  // until the manager applies or discards it. Nothing on the floor changes until Apply.
  const shiftFloor = useShiftFloor();
  const floorProposal =
    mode === "request" && request && request.bookRoomId === room.id
      ? requests.proposals[request.id]?.floor
      : mode === "shift" && shiftFloor.proposal?.roomId === room.id
        ? shiftFloor.proposal.edit
        : undefined;
  const previewParty = request?.id ?? "floor";
  const floorPreview = useMemo(() => {
    if (!floorProposal) return null;
    const changes: LayoutChange[] = [];
    for (const c of floorProposal.changes) {
      if ((c.kind === "move" || c.kind === "swap") && c.from && c.to)
        changes.push({
          kind: "move",
          reservationId: previewParty,
          tables: c.tables,
          from: { x: c.from.x, y: c.from.y },
          to: { x: c.to.x, y: c.to.y },
          text: c.text,
        });
      if (c.kind === "from_storage")
        changes.push({
          kind: "pull-table",
          reservationId: previewParty,
          tables: c.tables,
          text: c.text,
        });
    }
    return {
      room: { ...floorProposal.edited, reservations: room.reservations },
      changes,
      moved: floorProposal.changes.filter((c) => c.from && c.to).length,
    };
  }, [floorProposal, previewParty, room.reservations]);
  const alt = request && request.bookRoomId === room.id ? requests.alt[request.id] : undefined;
  const altHighlight: Highlight | null =
    mode === "request" && alt
      ? { key: `alt-${request?.id}`, ids: alt.tables, label: alt.label, source: "fit" }
      : null;
  const reqHighlight: Highlight | null = altHighlight
    ? altHighlight
    : reqTables.length && reqReady
      ? {
          key: `req-${request?.id}`,
          ids: reqTables,
          label: `${request ? surname(request.contact) : ""} · party of ${request ? currentRequest(requests, request).partySize : ""} · ${readinessPill(reqReady)}`,
          source: "fit",
          badges: Object.fromEntries(reqReady.tables.map((t) => [t.id, joinBadge(t, reqReady)])),
          // a plan across rooms opens the divider between them: drawn open on the floor
          dividers: openedBy(room, reqTables),
        }
      : null;
  const reviewHighlight: Highlight | null =
    mode === "review" && review?.tables.length
      ? {
          key: "review",
          ids: review.tables,
          label: `Party of ${review.draft.size} · under review`,
          source: "ai",
        }
      : null;
  const highlight =
    reviewHighlight ??
    (hoverArmed ? hover : null) ??
    pinned ??
    suggested ??
    focusHighlight ??
    reqHighlight;
  const controls: HighlightControls = {
    pinnedKey: pinned?.key ?? null,
    onHover: setHover,
    onTogglePin: (h) => setPinned((p) => (p?.key === h.key ? null : h)),
  };

  /** Apply a room change; a toast says so unless the panel shows its own result line (quiet). */
  const run = (fn: () => Room, message: string, quiet = false): ActionResult => {
    try {
      setRoom(fn());
      setEdited(true);
      const r: ActionResult = { ok: true, message };
      if (!quiet) setNotice(r);
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
    // the combined set stays selected, so Split is one tap away
    return run(() => applyCombine(room, ids), `Combined ${tablesPhrase(ids)}`);
  };
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
    // on the review screen a tap changes the tables under review
    if (mode === "review" && review) {
      const tables = review.tables.includes(id)
        ? review.tables.filter((x) => x !== id)
        : [...review.tables, id];
      setReview({ ...review, tables });
      return;
    }
    if (selected.length === 0 && mode !== "walkin") goTo("details");
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const openWalkIn = (d: Partial<WalkInDraft> & { ids?: string[] } = {}) => {
    setDraft({ size: d.size ?? 2, needs: d.needs ?? [], waitId: d.waitId });
    setSelected(d.ids ?? []);
    goTo("walkin");
  };
  const openReview = (draft: WalkInReviewDraft) => {
    setReview({ draft, tables: draft.tables });
    setPinned(null);
    setHover(null);
    goTo("review");
  };
  /** The review screen's one verb: seat (combining the option's rows) or waitlist with the quote. One Undo. */
  const confirmWalkIn = (c: WalkInConfirm) => {
    if (!review) return;
    const { draft: d } = review;
    const before = room;
    let after = room;
    let waitId: string | null = null;
    const who = c.name ? `${c.name} (${c.size})` : `Party of ${c.size}`;
    let text: string;
    if (c.action === "seat") {
      const r = run(() => (after = seatParty(room, c.tables, c.size)), "", true);
      if (!r.ok) return setNotice(r);
      text = `${who} seated at ${tablesPhrase(c.tables)}`;
    } else {
      // a join option is pushed together now when its tables allow it; the party waits for it
      const check = c.tables.length > 1 ? checkTableSet(room, c.tables) : null;
      const rows = check?.ok ? check.rows.filter((x) => x.length > 1) : [];
      let joined = false;
      // only tables nobody sits at are pushed together now; busy ones wait for their party to leave
      const free = c.tables.every((id) => {
        const t = tableById(room, id);
        return !!t && (t.status === "open" || t.status === "reserved");
      });
      if (rows.length && free) {
        try {
          const next = rows.reduce((acc, row) => applyCombine(acc, row), room);
          setRoom(next);
          setEdited(true);
          after = next;
          joined = true;
        } catch {
          // tables still in use can't be pushed together yet: the waitlist row keeps the target
        }
      }
      const id = `W${nextId.current++}`;
      waitId = id;
      setWaitlist((w) => [
        ...w,
        {
          id,
          partySize: c.size,
          needs: c.needs,
          quoteMin: c.quoteMin,
          addedAt: room.clock,
          tables: c.tables,
          name: c.name || undefined,
          note: c.note || undefined,
        },
      ]);
      text = `${who} waitlisted · quoted ~${c.quoteMin} min${joined ? ` · ${tablesPhrase(c.tables)} pushed together` : ` · for ${tablesPhrase(c.tables)}`}`;
    }
    if (c.note) text += ` · note: ${c.note}`;
    if (d.traceId) activityActions.recordApplied(d.traceId, `${text} (host confirmed)`);
    // undo only this action, against the room as it is then: the host may have done more since
    const seated = c.action === "seat" ? c.tables : [];
    const undo = () => {
      setRoom((now) => revertAction(now, before, after, seated));
      if (waitId) setWaitlist((w) => w.filter((e) => e.id !== waitId));
      setAiDone(({ [d.key]: _gone, ...rest }) => rest);
      setTaken((m) => new Map([...m].filter(([id]) => !c.tables.includes(id))));
    };
    setAiDone((x) => ({ ...x, [d.key]: { text, undo } }));
    setTaken((m) => new Map([...m, ...c.tables.map((id) => [id, room.clock] as const)]));
    setReview(null);
    setPinned(null);
    setHover(null);
    // back to the thread: the result line is there (no toast, the panel stays open)
    setBack((b) => b.filter((x) => x !== "assistant"));
    setMode("assistant");
  };
  const seat = (ids: string[], size: number) => {
    const r = run(
      () => seatParty(room, ids, size),
      `Seated party of ${size} at ${tablesPhrase(ids)}`,
    );
    if (!r.ok) return;
    if (draft.waitId) setWaitlist((w) => w.filter((x) => x.id !== draft.waitId));
    closePanel();
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
    closePanel();
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
    setSeatedAgo((m) => new Map([...m].filter(([id]) => !ids.includes(id))));
  };
  const reset = () => {
    setRoom(fixture);
    setEdited(false);
    setSelected([]);
    setPinned(null);
    setSeatedAgo(new Map());
    setPhaseByHost(new Set());
    setAiDone({});
    setTaken(new Map());
    setNotice({ ok: true, message: "Reset to the original room" });
  };

  // a promised table stays "taken" while its party is seated there or still waits for it
  const takenNow = useMemo(
    () =>
      new Map(
        [...taken].filter(
          ([id]) =>
            tableById(room, id)?.status === "occupied" ||
            waitlist.some((w) => w.tables?.includes(id)),
        ),
      ),
    [taken, room, waitlist],
  );
  const night = NIGHTS[room.id];
  // Tables held by accepted large-party plans for this night (derived here; never a "blocked" status).
  const holds = useMemo(() => planHolds(room, requests), [room, requests]);
  const heldIds = useMemo(() => new Set(holds.keys()), [holds]);
  const hasSheet = mode !== "details" || selected.length > 0;
  // the expanded rail resets each time a sheet closes
  if (railFor !== hasSheet) {
    setRailFor(hasSheet);
    if (!hasSheet && railOpen) setRailOpen(false);
  }
  const openCount = pendingCount(requests, { roomId: room.id, clock: room.clock });
  return (
    <div className={`console${hasSheet ? " has-sheet" : ""}${railOpen ? " rail-open" : ""}`}>
      <ConsoleBar
        room={room}
        roomSelect={roomSelect}
        layoutName={layouts.active.name}
        edited={edited}
        mode={mode}
        onMode={(m) => {
          // a top-bar button starts over: no panel to go back to
          setBack([]);
          setReview(null);
          if (m === "walkin") {
            setDraft({ size: 2, needs: [] });
            setSelected([]);
            setMode("walkin");
          } else setMode(m);
        }}
        onReset={reset}
      />
      {proposal && (
        <div className="preview-bar" role="status">
          {focusDecision?.kind === "accepted" ? (
            <>
              <strong>Accept already held {tablesPhrase(focusDecision.tables)}.</strong> Previewing
              the crew plan for {times12(`${proposal.window.from}–${proposal.window.to}`)} · nothing
              else changes until you apply it
            </>
          ) : (
            <>
              <strong>Previewing the night's layout</strong> ·{" "}
              {times12(`${proposal.window.from}–${proposal.window.to}`)} · nothing changes until you
              apply it
            </>
          )}
          <button type="button" className="link-btn" onClick={() => setProposal(null)}>
            Exit preview
          </button>
        </div>
      )}
      {floorPreview && !proposal && (
        <div className="preview-bar floor-preview-bar" role="status">
          <strong>Previewing the floor change proposed in chat</strong> · {floorPreview.moved} table
          {floorPreview.moved === 1 ? "" : "s"} to move · nothing changes until you apply it
        </div>
      )}
      {/* always mounted, so screen readers announce each toast */}
      <div className="toast-region" aria-live="polite" role="status">
        {notice && (
          <div className={`toast small ${notice.ok ? "is-ok" : "is-warn"}`}>
            <span>{notice.message}</span>
            <button
              type="button"
              className="link-btn toast-close"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
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
                  <span className="badge">
                    <span aria-hidden="true">{openCount}</span>
                    <span className="sr-only">{openCount} open requests</span>
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
              goTo("request");
            }}
          />
        </aside>

        <section className="floor-col" aria-label="Floor plan">
          <FloorPlan
            key={
              proposal
                ? "preview"
                : floorPreview
                  ? `floor-${request?.id}`
                  : reqTables.length
                    ? `req-${request?.id}`
                    : "live"
            }
            initialTab={
              proposal || focusTables.length
                ? focusTab
                : reqTables.length
                  ? tabForTables(room, reqTables)
                  : undefined
            }
            room={proposal?.variant ?? floorPreview?.room ?? room}
            selected={proposal ? [] : selected}
            highlight={highlight}
            onToggle={proposal ? () => undefined : toggle}
            onMove={proposal ? () => undefined : move}
            changes={proposal?.changes ?? floorPreview?.changes}
            fitKey={hasSheet ? "sheet" : "full"}
            held={heldIds}
          />
          <CoversStrip room={room} />
        </section>

        <aside className="side-col" aria-labelledby="panel-title">
          <div className="panel-head">
            <h2 id="panel-title">
              {PANEL_TITLE[mode]}{" "}
              {(mode === "assistant" || mode === "shift" || mode === "request") && <ProposedTag />}
            </h2>
            {mode === "assistant" && (
              <button
                type="button"
                className="link-btn new-chat"
                onClick={() => {
                  setChatSeq((n) => n + 1);
                  setPinned(null);
                  setHover(null);
                }}
              >
                New chat
              </button>
            )}
            {(mode !== "details" || selected.length > 0) && (
              <button
                type="button"
                className="link-btn"
                onClick={() => (mode !== "details" || back.length ? closePanel() : setSelected([]))}
              >
                Close
              </button>
            )}
          </div>
          {back.length > 0 && mode !== "review" && (
            <button type="button" className="link-btn back-to" onClick={closePanel}>
              ‹ Back to {PANEL_TITLE[back[back.length - 1] as PanelMode].replace("✦ ", "")}
            </button>
          )}
          <div className="tabpanel" hidden={mode !== "details"}>
            <TableDetails
              room={room}
              selected={selected}
              onFinish={finish}
              onSeatHere={(ids) => openWalkIn({ ids })}
              holds={holds}
              phaseByHost={phaseByHost}
              seatedAgo={seatedAgo}
              onPhase={(ids, phase) => {
                const before = new Map(seatedAgo);
                for (const id of ids) {
                  const t = room.tables.find((x) => x.id === id);
                  if (t && !before.has(id)) before.set(id, ELAPSED_EST_MIN[t.phase ?? "seated"]);
                }
                const r = run(
                  () => setPhase(room, ids, phase),
                  `${tablesPhrase(ids)} set to ${PHASE_LABEL[phase].toLowerCase()}`,
                );
                if (r.ok) {
                  setPhaseByHost((s) => new Set([...s, ...ids]));
                  setSeatedAgo(before);
                }
              }}
            />
            {selected.length > 0 && (
              <details className="more small combine-split" open={selected.length > 1 || undefined}>
                <summary>Combine / split ▸</summary>
                <SelectionBar
                  room={room}
                  selected={selected}
                  onCombine={combine}
                  onSplit={split}
                  onClear={() => setSelected([])}
                />
              </details>
            )}
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
          <div className="tabpanel agent-tab" hidden={mode !== "assistant"}>
            <AgentPanel
              key={chatSeq}
              room={room}
              highlight={controls}
              onPick={openReview}
              onOpenShift={() => goTo("shift")}
              done={aiDone}
              taken={takenNow}
              visible={mode === "assistant"}
              fresh={chatSeq > 0}
              threadId={`thread-${chatSeq}`}
            />
          </div>
          {mode === "review" && review && (
            <div className="tabpanel">
              <WalkInReview
                key={review.draft.key}
                room={room}
                draft={review.draft}
                tables={review.tables}
                onBack={closePanel}
                onConfirm={confirmWalkIn}
              />
            </div>
          )}
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
                  if (res.ok) closePanel();
                }}
              />
            </div>
          )}
          {mode === "shift" && (
            <div className="tabpanel">
              <FloorChat
                room={room}
                layouts={layouts}
                day={night?.day}
                date={night ? nightDate(night.day) : today()}
              />
              <TonightPanel
                layouts={layouts}
                autoGenerate={
                  // also when a plan applied earlier doesn't have this party yet
                  focusRequest &&
                  (!applied ||
                    !applied.proposal.parties.some((p) => p.reservationId === focusRequest))
                    ? { from: "17:00", to: "22:00" }
                    : undefined
                }
                autoApply={focusApply}
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
