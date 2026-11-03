// Session store for large-party requests: the list, each request's AI triage, and the manager's decision.
// Nothing here books anything until the manager presses Accept, and Accept only adds the party to that night's
// book in this browser session (fictional data; no guest is contacted).
import { useSyncExternalStore } from "react";
import type { GuestRequest, RequestBook } from "../../domain/requests";
import { toReservation, walkInRequest } from "../../domain/requests";
import type { Reservation } from "../../domain";
import type { TriageResult } from "../../shared/api";
import { fetchRequests, postDecision, postTriage, type ClientError } from "../api";

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

/** Wall-clock time of a manager action, as "Tue 10:41". */
function stamp(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function triage(r: GuestRequest): Promise<void> {
  set({ triage: { ...state.triage, [r.id]: { status: "loading" } } });
  const res = await postTriage(r.id);
  set({
    triage: {
      ...state.triage,
      [r.id]: res.ok
        ? { status: "ok", result: res.data, at: new Date().toISOString() }
        : { status: "error", error: res.error, at: new Date().toISOString() },
    },
  });
}

/** Load the requests once and triage each on arrival. */
export function startRequests(): void {
  if (started) return;
  started = true;
  void fetchRequests().then((res) => {
    if (!res.ok) return set({ error: res.error });
    set({ book: res.data });
    for (const r of res.data.requests) void triage(r);
  });
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
        [r.id]: { kind: "accepted", at: stamp(), iso: new Date().toISOString(), tables },
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
        [r.id]: { kind: "declined", at: stamp(), iso: new Date().toISOString(), reason },
      },
    });
  },
  reply(r: GuestRequest, edited: boolean) {
    logDecision(r.id, { kind: "replied", edited });
    set({
      decisions: {
        ...state.decisions,
        [r.id]: { kind: "replied", at: stamp(), iso: new Date().toISOString(), edited },
      },
    });
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
  noteFit(id: string, lines: string[], tables: string[]) {
    if (
      (state.fits[id] ?? []).join("\n") === lines.join("\n") &&
      (state.fitTables[id] ?? []).join() === tables.join()
    )
      return;
    set({
      fits: { ...state.fits, [id]: lines },
      fitTables: { ...state.fitTables, [id]: tables },
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

export function decisionOf(s: RequestsState, id: string): Decision {
  return s.decisions[id] ?? { kind: "pending" };
}

/** Requests still waiting for a manager: the console badge. Junk counts too until someone dismisses it. */
export function pendingCount(s: RequestsState): number {
  return (s.book?.requests ?? []).filter((r) => decisionOf(s, r.id).kind === "pending").length;
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
    openPlan: null,
  };
}
