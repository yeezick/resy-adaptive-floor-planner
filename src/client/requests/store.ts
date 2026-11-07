// Session store for large-party requests: the list, each request's AI triage, and the manager's decision.
// Nothing here books anything until the manager presses Accept, and Accept only adds the party to that night's
// book in this browser session (fictional data; no guest is contacted).
import { useSyncExternalStore } from "react";
import type { GuestRequest, RequestBook } from "../../domain/requests";
import { checkRequest, DEMO_WEEK_ISO, toReservation, walkInRequest } from "../../domain/requests";
import { activeScenario, RECORDED_CHAT, RECORDED_TRIAGE } from "../scenarios";
import { resolveTurn, type TurnResult } from "../../domain/floorTurn";
import { type FloorChange, type LayoutOp, type Reservation, type Room } from "../../domain";
import type { RequestChatResult, TriageResult } from "../../shared/api";
import type { ProposalStatus } from "./chatReply";
import {
  adjusted,
  baseConstraints,
  changeDelta,
  checkAdjusted,
  ESCALATED_NOTE,
  mergeTurn,
  type ChatConstraints,
} from "../../domain/requestChat";
import {
  fetchRequests,
  fetchRoom,
  postDecision,
  postRequestChat,
  postTriage,
  type ClientError,
} from "../api";
import { demoIso, demoStamp, receivedBy, setDemoNight } from "../lib/demoClock";
import { NIGHTS } from "../nights";
import { MAX_NOTE_CHARS } from "../../domain/activity";
import { REQUEST_CHAT_HARD_MS, TOO_LONG } from "../lib/wait";
import { layoutsStore } from "../layouts/useLayouts";
import { nightDate } from "../nights";
import { partyName } from "../lib/names";

export type DeclineReason = "fit" | "policy" | "other";

export type Decision =
  | { kind: "pending" }
  | { kind: "accepted"; at: string; iso: string; tables: string[] }
  | { kind: "declined"; at: string; iso: string; reason: DeclineReason; note?: string }
  | { kind: "replied"; at: string; iso: string; edited: boolean };

export type TriageState =
  | { status: "loading" }
  /** Taken at the host stand in this session: the host is talking to the guest, so no AI triage runs. */
  | { status: "host" }
  | { status: "ok"; result: TriageResult; at: string }
  | { status: "error"; error: ClientError; at: string };

/** One in-request chat turn. The manager's text stays in this browser session; the log keeps a hash. */
export interface ChatTurn {
  id: string;
  /** ISO time the manager sent it. */
  at: string;
  message: string;
  status: "loading" | "ok" | "error";
  result?: RequestChatResult;
  error?: ClientError;
  /** The planner's answer after this turn, one line (set by the sheet once it re-runs). */
  outcome?: string;
  /** What the turn changed ("tables 30–50", "party of 26"). */
  changed?: string[];
  /** The constraints just before this turn (to show what this turn alone changed). */
  before?: ChatConstraints;
  /** Answered on this device from the capacity check (no model call), e.g. "one room" or "from storage". */
  local?: boolean;
  /** Wall-clock ms when it was sent (the working line counts seconds from here). */
  sentMs?: number;
  /** The constraints this turn's own answer leads to (its capacity sentence is worked out from these). */
  after?: ChatConstraints;
  /** The AI's question back, verbatim, when it asked one. */
  clarify?: string;
  /** The manager asked the chat to accept: the accept line follows, from the proposal's status. */
  acceptAsk?: boolean;
  /** Answered on this device with no model call (a refusal, the accept line, a plan-state answer). */
  device?: boolean;
  /** Said before the change: code's answer to a question asked with it ("No single room fits 24 …"). */
  lead?: string;
}

/** A floor change the chat proposed, checked by the engine on the request's night (nothing applied yet). */
export interface FloorProposal {
  ops: LayoutOp[];
  /** The night's layout in use it was made from. */
  base: Room;
  edited: Room;
  changes: FloorChange[];
  crew: string[];
  crewMinutes: number;
}

/** A floor change the manager applied: a new one-day layout for the request's night (Undo removes it). */
export interface AppliedFloor {
  layoutId: string;
  prevActiveId: string;
  /** The night's base fixture (the layouts store is keyed by it). */
  fixture: Room;
  changes: string[];
}

/** What the request chat needs from the sheet to answer floor changes on this device. */
export interface ChatContext {
  /** The request's night as it stands: its layout in use with the night's book. */
  room: Room;
  /** Rooms and tables of the request's current plan. */
  planArea: string | null;
  planTables: readonly string[];
}

export interface RequestsState {
  book: RequestBook | null;
  error: ClientError | null;
  triage: Record<string, TriageState>;
  decisions: Record<string, Decision>;
  /** Accepted parties by the room fixture that holds their night's book. */
  accepted: Record<string, Reservation[]>;
  /** The solver's fit check per request, as shown to the manager (for the activity log). */
  fits: Record<string, string[]>;
  /** Tables the fit check would use, per request (outlined on that night's floor). */
  fitTables: Record<string, string[]>;
  /** Per request: the hold start its readiness is projected to, or null for a request for now. */
  fitReadyAt: Record<string, string | null>;
  /** The manager's changes to a request (chat or manual controls); absent = as the guest asked. */
  adjust: Record<string, ChatConstraints>;
  chat: Record<string, ChatTurn[]>;
  /** A change the chat proposed and the manager hasn't applied yet (nothing changes until Apply). */
  proposals: Record<
    string,
    {
      constraints: ChatConstraints;
      floor?: FloorProposal;
      /** The turns whose reply points at this proposal (or whose accept line refers to it). */
      turns: string[];
    }
  >;
  /** Per turn id: what became of the change its reply points at (rendered, never written into the turn). */
  turnStatus: Record<string, ProposalStatus>;
  /** Floor changes applied from the chat, per request. */
  floorApplied: Record<string, AppliedFloor>;
  /** Who made the request's current changes: the chat (applied) or the manual controls. */
  changedBy: Record<string, "chat" | "controls">;
  /** The manager's correction of an AI triage verdict, per request ("Wrong? Mark as junk"). */
  overrides: Record<string, { verdict: "real" | "junk"; iso: string }>;
  /** "Message guest → Mark as sent": the reply is logged, and the request stays open for Accept or Decline. */
  replies: Record<string, { at: string; iso: string; edited: boolean }>;
  /** An alternative the chat named, outlined on the request's floor until the next turn. */
  alt: Record<string, { tables: string[]; label: string }>;
  /** Set by Accept: the planner opens this night and shows the party's plan. */
  openPlan: {
    roomId: string;
    requestId: string;
    seq: number;
    view: "plan" | "request";
    /** Accept from the review screen: the crew plan is applied in the same confirm. */
    apply?: boolean;
  } | null;
}

/**
 * A chat action (an answer, Apply, Discard, Revert) asks the chat to bring its message box back into view while the
 * sheet settles around it; nothing else does (a Decline opened by hand keeps its own scroll).
 */
const anchorAt = new Map<string, number>();
export const chatAnchor = {
  request(requestId: string): void {
    anchorAt.set(requestId, Date.now());
  },
  /** Within ~1.5 s of a chat action on this request. */
  wanted(requestId: string): boolean {
    return Date.now() - (anchorAt.get(requestId) ?? -Infinity) < 1500;
  },
};

/** Set what became of the change these turns point at. */
function mark(turns: readonly string[], status: ProposalStatus): void {
  if (!turns.length) return;
  const next = { ...state.turnStatus };
  for (const t of turns) next[t] = status;
  set({ turnStatus: next });
}

/** A turn whose accept line refers to the change still waiting (when there is one). */
function linkToPending(requestId: string, turnId: string): void {
  const p = state.proposals[requestId];
  if (!p || p.turns.includes(turnId)) return;
  set({ proposals: { ...state.proposals, [requestId]: { ...p, turns: [...p.turns, turnId] } } });
  mark([turnId], "pending");
}

/** Replace (or add) one turn by id. */
function put(requestId: string, t: ChatTurn): void {
  const list = state.chat[requestId] ?? [];
  set({
    chat: {
      ...state.chat,
      [requestId]: list.some((x) => x.id === t.id)
        ? list.map((x) => (x.id === t.id ? t : x))
        : [...list, t],
    },
  });
}

let state: RequestsState = {
  book: null,
  error: null,
  triage: {},
  decisions: {},
  accepted: {},
  fits: {},
  fitTables: {},
  fitReadyAt: {},
  adjust: {},
  chat: {},
  overrides: {},
  proposals: {},
  turnStatus: {},
  changedBy: {},
  floorApplied: {},
  replies: {},
  alt: {},
  openPlan: null,
};
const listeners = new Set<() => void>();
let started = false;
let seq = 0;
/** Requests the host created at the stand this session (the server has no record of them). */
const local = new Set<string>();
let walkInSeq = 0;

/** Log a decision on the server, except for host-stand requests the server has never seen. */
function logDecision(id: string, d: Parameters<typeof postDecision>[1]): void {
  if (!local.has(id)) void postDecision(id, d);
}

function set(next: Partial<RequestsState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/**
 * When the AI triage of a fixture request ran, on the demo clock: when the request arrived (the recorded call
 * took about a second).
 */
function triagedAt(r: GuestRequest): string {
  return demoIso(r.receivedAt);
}

/** The demo's recorded triage for a fixture request (no model call), or null for one with no recording. */
function recorded(r: GuestRequest): TriageState | null {
  const rec = RECORDED_TRIAGE[r.id];
  return rec ? { status: "ok", result: { ...rec, cached: true }, at: triagedAt(r) } : null;
}

async function triage(r: GuestRequest): Promise<void> {
  set({ triage: { ...state.triage, [r.id]: { status: "loading" } } });
  const res = await postTriage(r.id);
  set({
    triage: {
      ...state.triage,
      [r.id]: res.ok
        ? { status: "ok", result: res.data, at: triagedAt(r) }
        : { status: "error", error: res.error, at: triagedAt(r) },
    },
  });
}

/**
 * Load the requests once. The demo's fixture requests open with their recorded triage (the same output every
 * time, no model call); any request without a recording is triaged live on arrival.
 */
export function startRequests(): void {
  if (started) return;
  started = true;
  void fetchRequests().then((res) => {
    if (!res.ok) return set({ error: res.error });
    set({ book: res.data });
    if (activeScenario()) return void applyScenario(res.data);
    const triageMap: Record<string, TriageState> = {};
    for (const r of res.data.requests) {
      const rec = recorded(r);
      if (rec) triageMap[r.id] = rec;
    }
    set({ triage: { ...state.triage, ...triageMap } });
    for (const r of res.data.requests) if (!triageMap[r.id]) void triage(r);
  });
}

/**
 * A named demo state (?scenario=…): recorded triage for every request, then the scenario's own state. No model
 * call and no decision is sent to the server.
 */
async function applyScenario(book: RequestBook): Promise<void> {
  const sc = activeScenario();
  if (!sc) return;
  const triageMap: Record<string, TriageState> = {};
  for (const r of book.requests) triageMap[r.id] = recorded(r) ?? { status: "loading" };
  set({ triage: triageMap });
  const r = sc.request ? book.requests.find((x) => x.id === sc.request?.id) : undefined;
  if (!sc.request || !r) return;
  if (sc.request.accept) {
    const room = await fetchRoom(r.bookRoomId);
    if (!room.ok) return;
    const fit = checkRequest(room.data, r);
    if (!fit.ok) return;
    // stamped on the request's own night (the planner hasn't opened it yet)
    setDemoNight(r.bookRoomId, room.data.clock);
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "accepted", ...demoStamp(), tables: fit.build.tables },
      },
      accepted: { ...state.accepted, [r.bookRoomId]: [toReservation(r)] },
      openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "plan", apply: true },
    });
    return;
  }
  const output = RECORDED_CHAT.result.output;
  if (sc.request.chat && RECORDED_CHAT.requestId === r.id && output) {
    set({
      proposals: {
        ...state.proposals,
        [r.id]: { constraints: mergeTurn(baseConstraints(r), output), turns: ["turn-scenario-1"] },
      },
      turnStatus: { ...state.turnStatus, "turn-scenario-1": "pending" },
      chat: {
        ...state.chat,
        [r.id]: [
          {
            id: "turn-scenario-1",
            // on the Friday book's planning clock, in the demo week
            at: new Date(`${DEMO_WEEK_ISO.Fri}T15:00:00`).toISOString(),
            message: RECORDED_CHAT.message,
            status: "ok",
            before: baseConstraints(r),
            result: RECORDED_CHAT.result,
            // the recorded turn carries its own answer, like a live one
            after: mergeTurn(baseConstraints(r), output),
            changed: changeDelta(r, baseConstraints(r), mergeTurn(baseConstraints(r), output)),
            ...(output.clarify ? { clarify: output.clarify } : {}),
          },
        ],
      },
    });
    // Off the floor (the activity log), no sheet re-runs the planner: record its answer here so the turn has a row.
    if (sc.path) {
      const room = await fetchRoom(r.bookRoomId);
      if (room.ok) {
        const c = mergeTurn(baseConstraints(r), output);
        const a = checkAdjusted(room.data, r, c);
        requestsActions.noteTurn(
          r.id,
          "turn-scenario-1",
          a.line,
          changeDelta(r, baseConstraints(r), c),
        );
      }
    }
  }
  set({ openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: sc.request.view } });
}

export const requestsActions = {
  retryTriage(r: GuestRequest) {
    if (!local.has(r.id)) void triage(r);
  },
  /**
   * A large party asking in person: added to the inbox as a walk-in request and opened on its night, where it
   * gets the same capacity fit and cost as an online request. Returns the new request.
   */
  addWalkIn(input: Omit<Parameters<typeof walkInRequest>[0], "id">): GuestRequest | null {
    if (!state.book) return null;
    const id = `Q${900 + ++walkInSeq}`;
    const r = walkInRequest({ ...input, id });
    local.add(id);
    set({
      book: { ...state.book, requests: [...state.book.requests, r] },
      triage: { ...state.triage, [id]: { status: "host" } },
      openPlan: { roomId: r.bookRoomId, requestId: id, seq: ++seq, view: "request" },
    });
    return r;
  },
  /** Hold the tables and (by default) apply the night's crew plan in the same confirm. */
  accept(r: GuestRequest, tables: string[], apply = true) {
    logDecision(r.id, { kind: "accepted" });
    const list = (state.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id);
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "accepted", ...demoStamp(), tables },
      },
      accepted: { ...state.accepted, [r.bookRoomId]: [...list, toReservation(r)] },
      openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "plan", apply },
    });
  },
  /** The note is the manager's own words: kept with the decision in this session, never sent to the server log. */
  decline(r: GuestRequest, reason: DeclineReason, note?: string) {
    const clean = note?.trim().slice(0, MAX_NOTE_CHARS);
    logDecision(r.id, { kind: "declined", reason });
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "declined", ...demoStamp(), reason, ...(clean ? { note: clean } : {}) },
      },
    });
  },
  /** The reply is marked sent: logged, and the request stays open (Accept and Decline still apply). */
  reply(r: GuestRequest, edited: boolean) {
    logDecision(r.id, { kind: "replied", edited });
    set({ replies: { ...state.replies, [r.id]: { ...demoStamp(), edited } } });
  },
  /** Undo "Mark as sent" (the reply only; a later decision is undone on its own). */
  unsend(r: GuestRequest) {
    logDecision(r.id, { kind: "reopened" });
    const { [r.id]: _gone, ...replies } = state.replies;
    set({ replies });
  },
  /** The manager says the AI triage got it wrong: one tap, shown on the card and logged as an override. */
  overrideTriage(id: string, verdict: "real" | "junk") {
    set({ overrides: { ...state.overrides, [id]: { verdict, iso: demoStamp().iso } } });
  },
  /** Undo a decision (back to pending); an accepted party leaves that night's book. */
  reopen(r: GuestRequest) {
    logDecision(r.id, { kind: "reopened" });
    const { [r.id]: _gone, ...decisions } = state.decisions;
    set({
      decisions,
      accepted: {
        ...state.accepted,
        [r.bookRoomId]: (state.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id),
      },
    });
  },
  /** Manual controls: set this request's constraints directly (same fields the chat sets). */
  setConstraints(id: string, c: ChatConstraints) {
    // a manual edit supersedes a chat proposal that was built on the old constraints
    const { [id]: stale, ...proposals } = state.proposals;
    if (stale) mark(stale.turns, "replaced");
    set({
      adjust: { ...state.adjust, [id]: c },
      changedBy: { ...state.changedBy, [id]: "controls" },
      proposals,
    });
  },
  resetConstraints(id: string) {
    chatAnchor.request(id);
    const { [id]: _gone, ...adjust } = state.adjust;
    const { [id]: _who, ...changedBy } = state.changedBy;
    const { [id]: stale, ...proposals } = state.proposals;
    // every change of this request, applied or still waiting, is reverted
    const applied = (state.chat[id] ?? [])
      .map((t) => t.id)
      .filter((t) => state.turnStatus[t] === "applied");
    mark([...(stale?.turns ?? []), ...applied], "reverted");
    // Revert = Undo for a floor change too: the one-day layout goes, the previous layout is back in use
    const floor = state.floorApplied[id];
    const { [id]: _f, ...floorApplied } = state.floorApplied;
    set({ adjust, changedBy, proposals, floorApplied });
    if (floor) {
      layoutsStore.remove(floor.fixture, floor.layoutId, floor.prevActiveId);
      reopenOnNight(id);
    }
  },
  /**
   * Apply the chat's proposed change: only now does the request's capacity check change. A floor change becomes a
   * NEW one-day layout for the request's night (made from the layout in use, which is kept); the base layout is
   * never changed. `fixture` = the night's base room (its book, without accepted parties).
   */
  applyProposal(id: string, fixture?: Room) {
    const p = state.proposals[id];
    if (!p) return;
    chatAnchor.request(id);
    const { [id]: _gone, ...proposals } = state.proposals;
    mark(p.turns, "applied");
    let floorApplied = state.floorApplied;
    if (p.floor && fixture) {
      const prev = layoutsStore.active(fixture);
      const r = state.book?.requests.find((x) => x.id === id);
      const day = r?.day;
      const layout = layoutsStore.save(
        fixture,
        { ...p.floor.edited, reservations: fixture.reservations },
        {
          name: `${day ?? "Tonight"} plan — floor change`,
          date: day ? nightDate(day) : undefined,
          note: `One-day edit · from ${prev.name} · made in the request chat`,
        },
      );
      floorApplied = {
        ...state.floorApplied,
        [id]: {
          layoutId: layout.id,
          prevActiveId: prev.id,
          fixture,
          changes: p.floor.changes.map((c) => c.text),
        },
      };
    }
    set({
      proposals,
      adjust: { ...state.adjust, [id]: p.constraints },
      changedBy: { ...state.changedBy, [id]: "chat" },
      floorApplied,
    });
    // a saved layout remounts that night's planner: reopen the request there
    if (p.floor && fixture) reopenOnNight(id);
  },
  discardProposal(id: string) {
    chatAnchor.request(id);
    const { [id]: gone, ...proposals } = state.proposals;
    if (gone) mark(gone.turns, "discarded");
    set({ proposals });
  },
  /**
   * Send one chat message about this request. The answer is stored on THIS turn (by its id), never read back
   * from shared state, so two turns can't show the same reply. A slow answer is kept: if it lands after the
   * timeout line, it replaces that line.
   */
  async sendChat(
    r: GuestRequest,
    message: string,
    ctx?: ChatContext,
    opts: { accept?: boolean } = {},
  ) {
    const id = `turn-${++seq}`;
    if (state.alt[r.id]) {
      const { [r.id]: _old, ...alt } = state.alt;
      set({ alt });
    }
    const current = state.proposals[r.id]?.constraints ?? state.adjust[r.id] ?? baseConstraints(r);
    const turn: ChatTurn = {
      id,
      at: demoStamp().iso,
      message,
      status: "loading",
      before: current,
      sentMs: Date.now(),
      ...(opts.accept ? { acceptAsk: true } : {}),
    };
    put(r.id, turn);
    // an accept ask's line refers to the change waiting once this turn resolves (its own, or an earlier one)
    const settle = () => {
      if (opts.accept) linkToPending(r.id, id);
    };
    const hard = setTimeout(() => requestsActions.timeoutTurn(r.id, id), REQUEST_CHAT_HARD_MS);
    const res = await postRequestChat(r.id, {
      message,
      request: { partySize: r.partySize, day: r.day, time: r.time, needs: r.needs },
      constraints: current,
      bookRoomId: r.bookRoomId,
      ...(ctx?.planArea ? { planRooms: ctx.planArea.split(" + ").slice(0, 4) } : {}),
    });
    clearTimeout(hard);
    chatAnchor.request(r.id);
    // the turn as it stands now (it may carry the timeout line, which the answer replaces)
    const now = (state.chat[r.id] ?? []).find((x) => x.id === id);
    if (!now) return;
    if (!res.ok) {
      // a late failure never overwrites the timeout line with a second error
      if (now.status === "error") return;
      put(r.id, { ...turn, status: "error", error: res.error, outcome: res.error.message });
      return settle();
    }
    const out = res.data.output;
    if (!out) {
      // escalated (refusal or two rejected answers): the server's one-line note is the reply
      put(r.id, {
        ...turn,
        status: "ok",
        result: res.data,
        outcome: res.data.note ?? ESCALATED_NOTE,
        changed: [],
      });
      return settle();
    }
    // a proposal, shown as a diff: nothing changes until the manager presses Apply
    const latest = state.proposals[r.id]?.constraints ?? state.adjust[r.id] ?? baseConstraints(r);
    const applied = state.adjust[r.id] ?? baseConstraints(r);
    const base = {
      ...turn,
      status: "ok" as const,
      result: res.data,
      ...(out.clarify ? { clarify: out.clarify } : {}),
    };
    if (out.ops.length && !ctx) {
      put(r.id, {
        ...base,
        after: latest,
        outcome: ESCALATED_NOTE,
        changed: [],
        local: true,
      });
      return settle();
    }
    const res2: TurnResult = ctx
      ? resolveTurn(r, latest, out, { ...ctx, nameOf: partyName })
      : {
          kind: "proposal",
          constraints: mergeTurn(latest, out),
          changed: changeDelta(r, latest, mergeTurn(latest, out)),
        };
    // answered by code (plan state, the one-room closest, a rejected floor change): nothing proposed
    if (res2.kind === "answer") {
      put(r.id, { ...base, after: latest, outcome: res2.text, changed: [], local: true });
      return settle();
    }
    const next = res2.constraints;
    const fresh: FloorProposal | undefined =
      res2.floor && ctx ? { ...res2.floor, base: ctx.room } : undefined;
    // a later turn without floor changes keeps a pending floor change, and its capacity sentence uses it
    const floor = fresh ?? state.proposals[r.id]?.floor;
    // a floor change the engine accepted answers the message: a question the model added alongside is moot
    const { clarify: _moot, ...answered } = base;
    put(r.id, {
      ...(fresh ? answered : base),
      ...(res2.lead ? { lead: res2.lead } : {}),
      after: next,
      changed: res2.changed,
      // a floor change's capacity sentence is worked out on the edited floor, now
      ...(floor ? { outcome: checkAdjusted(floor.edited, r, next).line } : {}),
    });
    // a turn that changes nothing (or only asks a question) proposes nothing
    if (floor || JSON.stringify(next) !== JSON.stringify(applied)) {
      const old = state.proposals[r.id];
      // a new floor change replaces the one waiting: the turns that proposed that floor are "(replaced)"; the
      // others' changes carry on in the new proposal (it is built on the old one's constraints)
      const replaced = fresh && old?.floor ? old.turns.filter((t) => floorTurn(r.id, t)) : [];
      const turns = [...(old?.turns ?? []).filter((t) => !replaced.includes(t)), id];
      set({
        proposals: {
          ...state.proposals,
          [r.id]: { constraints: next, ...(floor ? { floor } : {}), turns },
        },
      });
      mark(replaced, "replaced");
      mark([id], "pending");
    }
    settle();
  },
  /**
   * A message the capacity check can answer by itself ("one room?", "bring tables from the back", a need that
   * is already set): logged as a turn with its answer, no model call, nothing proposed.
   */
  answerLocal(
    r: GuestRequest,
    message: string,
    answer: string,
    alt?: { tables: string[]; label: string },
    opts: { accept?: boolean } = {},
  ) {
    const id = `turn-${++seq}`;
    const turn: ChatTurn = {
      id,
      at: demoStamp().iso,
      message,
      status: "ok",
      outcome: answer,
      changed: [],
      local: true,
      device: true,
      ...(opts.accept ? { acceptAsk: true } : {}),
    };
    const { [r.id]: _old, ...alts } = state.alt;
    set({
      chat: { ...state.chat, [r.id]: [...(state.chat[r.id] ?? []), turn] },
      alt: alt ? { ...alts, [r.id]: alt } : alts,
    });
    if (opts.accept) linkToPending(r.id, id);
  },
  /** Past the hard limit: a plain line, nothing changed. A late answer still replaces it. */
  timeoutTurn(requestId: string, turnId: string) {
    const list = state.chat[requestId] ?? [];
    if (!list.some((x) => x.id === turnId && x.status === "loading")) return;
    set({
      chat: {
        ...state.chat,
        [requestId]: list.map((x) =>
          x.id === turnId
            ? {
                ...x,
                status: "error",
                outcome: TOO_LONG,
              }
            : x,
        ),
      },
    });
  },
  /** The sheet records what the planner answered after a turn (for the chat log and the activity log). */
  noteTurn(requestId: string, turnId: string, outcome: string, changed: string[]) {
    const list = state.chat[requestId] ?? [];
    const t = list.find((x) => x.id === turnId);
    if (!t || t.outcome === outcome) return;
    set({
      chat: {
        ...state.chat,
        [requestId]: list.map((x) => (x.id === turnId ? { ...x, outcome, changed } : x)),
      },
    });
  },
  noteFit(id: string, lines: string[], tables: string[], readyAt: string | null = null) {
    if (
      (state.fits[id] ?? []).join("\n") === lines.join("\n") &&
      (state.fitTables[id] ?? []).join() === tables.join() &&
      (state.fitReadyAt[id] ?? null) === readyAt
    )
      return;
    set({
      fits: { ...state.fits, [id]: lines },
      fitTables: { ...state.fitTables, [id]: tables },
      fitReadyAt: { ...state.fitReadyAt, [id]: readyAt },
    });
  },
  /** Open the request's night with the request sheet open and its fit outlined. */
  viewNight(r: GuestRequest) {
    set({ openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "request" } });
  },
  consumeOpenPlan() {
    if (state.openPlan) set({ openPlan: null });
  },
};

/** A turn that proposed a floor change ("the floor (5 changes)" leads what it changed). */
function floorTurn(requestId: string, turnId: string): boolean {
  const t = (state.chat[requestId] ?? []).find((x) => x.id === turnId);
  return !!t?.changed?.some((c) => c.startsWith("the floor ("));
}

/** After a layout save remounts the request's night: show that night with the request open again. */
function reopenOnNight(id: string): void {
  const r = state.book?.requests.find((x) => x.id === id);
  if (r) set({ openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "request" } });
}

export function decisionOf(s: Pick<RequestsState, "decisions">, id: string): Decision {
  return s.decisions[id] ?? { kind: "pending" };
}

/** The request as it stands now: the guest's ask with the manager's applied changes (chat or controls). */
export function currentRequest(s: Pick<RequestsState, "adjust">, r: GuestRequest): GuestRequest {
  const c = s.adjust[r.id];
  return c ? adjusted(r, c) : r;
}

/**
 * The requests a night's floor can know about: those received by its clock. A request that arrives later in the
 * week (e.g. Fri 14:40) is not on the Wednesday live floor. Off the floor (no night), all of them.
 */
export function requestsBy(
  s: Pick<RequestsState, "book">,
  night?: { roomId: string; clock: string },
): GuestRequest[] {
  const all = s.book?.requests ?? [];
  const day = night ? NIGHTS[night.roomId]?.day : undefined;
  if (!night || !day) return all;
  return all.filter((r) => receivedBy(r.receivedAt, day, night.clock));
}

/** Requests still waiting for a manager: the console badge. Junk counts too until someone dismisses it. */
export function pendingCount(s: RequestsState, night?: { roomId: string; clock: string }): number {
  return requestsBy(s, night).filter((r) => decisionOf(s, r.id).kind === "pending").length;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRequests(): RequestsState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getRequestsState(): RequestsState {
  return state;
}

/** Tests only. */
export function resetRequestsStore(): void {
  started = false;
  local.clear();
  anchorAt.clear();
  walkInSeq = 0;
  state = {
    book: null,
    error: null,
    triage: {},
    decisions: {},
    accepted: {},
    fits: {},
    fitTables: {},
    fitReadyAt: {},
    adjust: {},
    chat: {},
    overrides: {},
    proposals: {},
    turnStatus: {},
    changedBy: {},
    floorApplied: {},
    replies: {},
    alt: {},
    openPlan: null,
  };
}
