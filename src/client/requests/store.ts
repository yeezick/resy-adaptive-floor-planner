// Session store for large-party requests: the list, each request's AI triage, and the manager's decision.
// Nothing here books anything until the manager presses Accept, and Accept only adds the party to that night's
// book in this browser session (fictional data; no guest is contacted).
import { useSyncExternalStore } from "react";
import type { GuestRequest, RequestBook } from "../../domain/requests";
import { checkRequest, DEMO_WEEK_ISO, toReservation, walkInRequest } from "../../domain/requests";
import { activeScenario, RECORDED_CHAT, RECORDED_TRIAGE } from "../scenarios";
import type { Reservation } from "../../domain";
import type { RequestChatResult, TriageResult } from "../../shared/api";
import {
  adjusted,
  baseConstraints,
  changeDelta,
  checkAdjusted,
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

export type DeclineReason = "fit" | "policy" | "other";

export type Decision =
  | { kind: "pending" }
  | { kind: "accepted"; at: string; iso: string; tables: string[] }
  | { kind: "declined"; at: string; iso: string; reason: DeclineReason }
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
  proposals: Record<string, { constraints: ChatConstraints }>;
  /** Who made the request's current changes: the chat (applied) or the manual controls. */
  changedBy: Record<string, "chat" | "controls">;
  /** The manager's correction of an AI triage verdict, per request ("Wrong? Mark as junk"). */
  overrides: Record<string, { verdict: "real" | "junk"; iso: string }>;
  /** "Message guest → Mark as sent": the reply is logged, and the request stays open for Accept or Decline. */
  replies: Record<string, { at: string; iso: string; edited: boolean }>;
  /** Set by Accept: the planner opens this night and shows the party's plan. */
  openPlan: { roomId: string; requestId: string; seq: number; view: "plan" | "request" } | null;
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
  changedBy: {},
  replies: {},
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
      openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "plan" },
    });
    return;
  }
  const output = RECORDED_CHAT.result.output;
  if (sc.request.chat && RECORDED_CHAT.requestId === r.id && output) {
    set({
      proposals: {
        ...state.proposals,
        [r.id]: { constraints: mergeTurn(baseConstraints(r), output) },
      },
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
  accept(r: GuestRequest, tables: string[]) {
    logDecision(r.id, { kind: "accepted" });
    const list = (state.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id);
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "accepted", ...demoStamp(), tables },
      },
      accepted: { ...state.accepted, [r.bookRoomId]: [...list, toReservation(r)] },
      openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq, view: "plan" },
    });
  },
  decline(r: GuestRequest, reason: DeclineReason) {
    logDecision(r.id, { kind: "declined", reason });
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "declined", ...demoStamp(), reason },
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
    const { [id]: _stale, ...proposals } = state.proposals;
    set({
      adjust: { ...state.adjust, [id]: c },
      changedBy: { ...state.changedBy, [id]: "controls" },
      proposals,
    });
  },
  resetConstraints(id: string) {
    const { [id]: _gone, ...adjust } = state.adjust;
    const { [id]: _who, ...changedBy } = state.changedBy;
    const { [id]: _stale, ...proposals } = state.proposals;
    set({ adjust, changedBy, proposals });
  },
  /** Apply the chat's proposed change: only now does the request's capacity check change. */
  applyProposal(id: string) {
    const p = state.proposals[id];
    if (!p) return;
    const { [id]: _gone, ...proposals } = state.proposals;
    set({
      proposals,
      adjust: { ...state.adjust, [id]: p.constraints },
      changedBy: { ...state.changedBy, [id]: "chat" },
    });
  },
  discardProposal(id: string) {
    const { [id]: _gone, ...proposals } = state.proposals;
    set({ proposals });
  },
  /** Send one chat message about this request; a valid answer updates its constraints. */
  async sendChat(r: GuestRequest, message: string) {
    const id = `turn-${++seq}`;
    const current = state.proposals[r.id]?.constraints ?? state.adjust[r.id] ?? baseConstraints(r);
    const turn: ChatTurn = {
      id,
      at: demoStamp().iso,
      message,
      status: "loading",
      before: current,
    };
    const put = (t: ChatTurn) =>
      set({
        chat: {
          ...state.chat,
          [r.id]: [...(state.chat[r.id] ?? []).filter((x) => x.id !== id), t],
        },
      });
    put(turn);
    const res = await postRequestChat(r.id, {
      message,
      request: { partySize: r.partySize, day: r.day, time: r.time, needs: r.needs },
      constraints: current,
    });
    if (!res.ok)
      return put({ ...turn, status: "error", error: res.error, outcome: res.error.message });
    put({ ...turn, status: "ok", result: res.data });
    if (res.data.output) {
      // a proposal, shown as a diff: nothing changes until the manager presses Apply
      const latest = state.proposals[r.id]?.constraints ?? state.adjust[r.id] ?? baseConstraints(r);
      const next = mergeTurn(latest, res.data.output);
      const current = state.adjust[r.id] ?? baseConstraints(r);
      // a turn that changes nothing (or only asks a question) proposes nothing
      if (JSON.stringify(next) !== JSON.stringify(current))
        set({ proposals: { ...state.proposals, [r.id]: { constraints: next } } });
    } else put({ ...turn, status: "ok", result: res.data, outcome: res.data.note ?? undefined });
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
 * week (e.g. Fri 14:40) is not on the Thursday live floor. Off the floor (no night), all of them.
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
    changedBy: {},
    replies: {},
    openPlan: null,
  };
}
