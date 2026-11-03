// Session store for large-party requests: the list, each request's AI triage, and the manager's decision.
// Nothing here books anything until the manager presses Accept, and Accept only adds the party to that night's
// book in this browser session (fictional data; no guest is contacted).
import { useSyncExternalStore } from "react";
import type { GuestRequest, RequestBook } from "../../domain/requests";
import { toReservation } from "../../domain/requests";
import type { Reservation } from "../../domain";
import type { TriageResult } from "../../shared/api";
import { fetchRequests, postTriage, type ClientError } from "../api";

export type DeclineReason = "fit" | "policy" | "other";

export type Decision =
  | { kind: "pending" }
  | { kind: "accepted"; at: string; tables: string[] }
  | { kind: "declined"; at: string; reason: DeclineReason }
  | { kind: "replied"; at: string; edited: boolean };

export type TriageState =
  | { status: "loading" }
  | { status: "ok"; result: TriageResult }
  | { status: "error"; error: ClientError };

export interface RequestsState {
  book: RequestBook | null;
  error: ClientError | null;
  triage: Record<string, TriageState>;
  decisions: Record<string, Decision>;
  /** Accepted parties by the room fixture that holds their night's book. */
  accepted: Record<string, Reservation[]>;
  /** Set by Accept: the planner opens this night and shows the party's plan. */
  openPlan: { roomId: string; requestId: string; seq: number } | null;
}

let state: RequestsState = {
  book: null,
  error: null,
  triage: {},
  decisions: {},
  accepted: {},
  openPlan: null,
};
const listeners = new Set<() => void>();
let started = false;
let seq = 0;

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
      [r.id]: res.ok ? { status: "ok", result: res.data } : { status: "error", error: res.error },
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
    void triage(r);
  },
  accept(r: GuestRequest, tables: string[]) {
    const list = (state.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id);
    set({
      decisions: { ...state.decisions, [r.id]: { kind: "accepted", at: stamp(), tables } },
      accepted: { ...state.accepted, [r.bookRoomId]: [...list, toReservation(r)] },
      openPlan: { roomId: r.bookRoomId, requestId: r.id, seq: ++seq },
    });
  },
  decline(r: GuestRequest, reason: DeclineReason) {
    set({ decisions: { ...state.decisions, [r.id]: { kind: "declined", at: stamp(), reason } } });
  },
  reply(r: GuestRequest, edited: boolean) {
    set({ decisions: { ...state.decisions, [r.id]: { kind: "replied", at: stamp(), edited } } });
  },
  /** Undo a decision (back to pending); an accepted party leaves that night's book. */
  reopen(r: GuestRequest) {
    const { [r.id]: _gone, ...decisions } = state.decisions;
    set({
      decisions,
      accepted: {
        ...state.accepted,
        [r.bookRoomId]: (state.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id),
      },
    });
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
  state = { book: null, error: null, triage: {}, decisions: {}, accepted: {}, openPlan: null };
}
