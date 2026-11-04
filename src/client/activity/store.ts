// Activity log inputs for this session, from what is already logged: triage results and manager decisions (the
// requests store), assistant responses and what the host applied from them (recorded here), plus a fictional
// seed for earlier this week. Read-only to the Activity screen.
import { DEMO_WEEK_ISO } from "../../domain/requests";
import { useMemo, useSyncExternalStore } from "react";
import weekJson from "../../../fixtures/activity/week.json";
import {
  ActivitySeed,
  buildActivity,
  type ActivityRow,
  type AssistantEvent,
  type ManagerAction,
  type RequestChatEvent,
  type TriageEvent,
} from "../../domain/activity";
import { DEMO_MANAGER, FeedbackRecord, noteRow, rateRow, type Rating } from "../../domain/feedback";
import type { AgentResponse } from "../../shared/api";
import { activeScenario, RECORDED_FEEDBACK } from "../scenarios";
import { decisionOf, useRequests, type RequestsState } from "../requests/store";
import { tableNumbers } from "../../domain/wording";
import { demoStamp } from "../lib/demoClock";

const SEED: ActivitySeed = ActivitySeed.parse(weekJson);

interface State {
  assistant: AssistantEvent[];
  applied: ManagerAction[];
  /** 👍 / 👎 per activity-log row (this manager). Notes are hash + length only. */
  feedback: FeedbackRecord[];
  /** Why a 👎 (reason chips), per row: categorical, so stored as is (session only). */
  reasons: Record<string, FeedbackReason[]>;
}

export const FEEDBACK_REASONS = ["Wrong verdict", "Wrong reason", "Missed need"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

// Feedback is saved in this browser (the public demo has no accounts); a scenario starts from its fixture.
const FEEDBACK_KEY = "afp.feedback.v1";
function loadFeedback(): FeedbackRecord[] {
  if (activeScenario()?.id === "activity-log") return RECORDED_FEEDBACK;
  try {
    const raw = window.localStorage.getItem(FEEDBACK_KEY);
    return raw ? FeedbackRecord.array().parse(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}
function saveFeedback(list: FeedbackRecord[]): void {
  if (activeScenario()) return; // scenarios are fixed demo states
  try {
    window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: the rating still holds for this page load
  }
}

let state: State = {
  assistant: [],
  applied: [],
  feedback: typeof window === "undefined" ? [] : loadFeedback(),
  reasons: {},
};
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

async function sha256(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "unavailable";
  }
}

const PARTY = /\b(?:party of|for|table for)\s+(\d{1,3})\b|\b(\d{1,3})[- ]?(?:top|guests|people)\b/i;

export const activityActions = {
  /** One call per assistant response (success or failure). The host's text is kept only as hash + length. */
  async recordAssistant(
    roomId: string,
    message: string,
    res: { ok: true; data: AgentResponse } | { ok: false; error: { code: string } },
  ) {
    const m = PARTY.exec(message);
    const party = m ? Number(m[1] ?? m[2]) : null;
    const input = { sha256: await sha256(message), length: message.length };
    const at = demoStamp().iso;
    const e: AssistantEvent = res.ok
      ? {
          type: "assistant",
          refId: res.data.traceId,
          traceId: res.data.traceId,
          at,
          roomId,
          partySize: party,
          input,
          answer: res.data.answer,
          clarifyingQuestion: res.data.clarifyingQuestion,
          recommendations: res.data.recommendations.map((r) => ({
            rank: r.rank,
            tables: r.tables,
            seats: r.seats,
            waitMin: r.waitMin,
          })),
          validatorRejects: res.data.validator.rejects,
          refused: res.data.metrics.calls.some((c) => c.stopReason === "refusal"),
          model: res.data.model,
          costUsd: res.data.metrics.costUsd,
          latencyMs: res.data.metrics.latencyMs,
        }
      : {
          type: "assistant",
          refId: `err-${at}`,
          traceId: `err-${at}`,
          at,
          roomId,
          partySize: party,
          input,
          answer: "",
          clarifyingQuestion: null,
          recommendations: [],
          validatorRejects: 0,
          refused: false,
          failed: res.error.code,
          model: "—",
          costUsd: 0,
          latencyMs: 0,
        };
    set({ assistant: [...state.assistant, e] });
  },
  /** 👍 / 👎 on a row: saved at once; the other thumb changes the same entry. */
  rate(rowId: string, rating: Rating) {
    const feedback = rateRow(state.feedback, {
      rowId,
      manager: DEMO_MANAGER,
      rating,
      at: demoStamp().iso,
    });
    // a row rated helpful has no "why not" reasons
    set(rating === "up" ? { feedback, reasons: { ...state.reasons, [rowId]: [] } } : { feedback });
    saveFeedback(feedback);
  },
  /** Toggle a reason chip on a 👎 (categorical, logged with the row). */
  toggleReason(rowId: string, reason: FeedbackReason) {
    const cur = state.reasons[rowId] ?? [];
    const next = cur.includes(reason) ? cur.filter((x) => x !== reason) : [...cur, reason];
    set({ reasons: { ...state.reasons, [rowId]: next } });
  },
  /** Append an optional note to the row's entry. Only its hash + length are kept. */
  async note(rowId: string, text: string) {
    const t = text.trim();
    if (!t) return;
    const note = { sha256: await sha256(t), length: t.length };
    const feedback = noteRow(state.feedback, {
      rowId,
      manager: DEMO_MANAGER,
      note,
      at: demoStamp().iso,
    });
    set({ feedback });
    saveFeedback(feedback);
  },
  /** The host applied (or started seating from) a recommendation. */
  recordApplied(traceId: string, applied: string) {
    set({
      applied: [
        ...state.applied,
        { refId: traceId, at: demoStamp().iso, kind: "applied", applied },
      ],
    });
  },
};

/** "Tue 10:03" → that moment in the fixtures' demo week (the requests name only a weekday). */
export function weekdayToIso(label: string): string {
  const [day, hm] = label.split(" ");
  const date = DEMO_WEEK_ISO[(day ?? "Mon") as keyof typeof DEMO_WEEK_ISO] ?? DEMO_WEEK_ISO.Mon;
  return new Date(`${date}T${hm ?? "00:00"}:00`).toISOString();
}

export function liveEvents(s: RequestsState): {
  events: (TriageEvent | RequestChatEvent)[];
  actions: ManagerAction[];
} {
  const events: (TriageEvent | RequestChatEvent)[] = [];
  // in-request chat turns: one row each, once the planner has answered (or the turn failed)
  for (const r of s.book?.requests ?? []) {
    for (const t of s.chat[r.id] ?? []) {
      if (t.status === "loading" || t.outcome === undefined) continue;
      const res = t.result;
      events.push({
        type: "request-chat",
        refId: r.id,
        traceId: res?.traceId ?? `chat-failed-${t.id}`,
        at: t.at,
        partySize: r.partySize,
        when: `${r.day} ${r.time}`,
        input: res?.input ?? { sha256: "not-sent", length: t.message.length },
        changed: t.changed ?? [],
        outcome: t.outcome,
        clarify: res?.output?.clarify ?? null,
        validatorRejects: res?.validatorRejects ?? 0,
        ...(t.status === "error"
          ? { failed: t.error?.code ?? "error" }
          : res?.escalated
            ? { failed: "no usable answer" }
            : {}),
        model: res?.model ?? "—",
        costUsd: res?.metrics.costUsd ?? 0,
        latencyMs: res?.metrics.latencyMs ?? 0,
      });
    }
  }
  const actions: ManagerAction[] = [];
  for (const r of s.book?.requests ?? []) {
    const t = s.triage[r.id];
    if (!t || t.status === "loading" || t.status === "host") continue;
    // The triage runs when the request arrives (in the demo week).
    const at = weekdayToIso(r.receivedAt);
    const base = {
      type: "triage" as const,
      refId: r.id,
      at,
      source: r.source,
      partySize: r.partySize,
      when: `${r.day} ${r.time}`,
      solver: s.fits[r.id] ?? [],
    };
    events.push(
      t.status === "ok"
        ? {
            ...base,
            traceId: t.result.traceId,
            verdict: t.result.verdict,
            escalated: t.result.escalated,
            reason: t.result.reason,
            summary: t.result.summary,
            validatorRejects: t.result.validatorRejects,
            model: t.result.model,
            // what the triage cost when it ran (a cached view costs nothing more)
            costUsd: t.result.metrics.costUsd,
            latencyMs: t.result.metrics.latencyMs,
            message: t.result.input,
          }
        : {
            ...base,
            traceId: `triage-failed-${r.id}`,
            verdict: "unsure",
            escalated: true,
            failed: t.error.code,
            reason: t.error.message,
            summary: [],
            validatorRejects: 0,
            model: "—",
            costUsd: 0,
            latencyMs: 0,
            message: { sha256: "not-sent", length: r.message.length },
          },
    );
    const d = decisionOf(s, r.id);
    if (d.kind === "accepted")
      actions.push({ refId: r.id, at: d.iso, kind: "accepted", applied: tableNumbers(d.tables) });
    else if (d.kind === "declined")
      actions.push({ refId: r.id, at: d.iso, kind: "declined", reason: d.reason, note: d.note });
    else if (d.kind === "replied")
      actions.push({ refId: r.id, at: d.iso, kind: "replied", edited: d.edited });
    const sent = s.replies[r.id];
    if (sent) actions.push({ refId: r.id, at: sent.iso, kind: "replied", edited: sent.edited });
    const o = s.overrides[r.id];
    if (o) actions.push({ refId: r.id, at: o.iso, kind: "overridden", verdict: o.verdict });
  }
  return { events, actions };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useActivity(): ActivityRow[] {
  const s = useRequests();
  const local = useSyncExternalStore(subscribe, () => state);
  return useMemo(() => {
    const live = liveEvents(s);
    return buildActivity(
      [...SEED.events, ...live.events, ...local.assistant],
      [...SEED.actions, ...live.actions, ...local.applied],
    );
  }, [s, local]);
}

export function useFeedback(): FeedbackRecord[] {
  return useSyncExternalStore(subscribe, () => state).feedback;
}

/** Tests only. */
export function resetActivityStore(feedback: FeedbackRecord[] = []): void {
  state = { assistant: [], applied: [], feedback, reasons: {} };
}

export function useFeedbackReasons(): Record<string, FeedbackReason[]> {
  return useSyncExternalStore(subscribe, () => state).reasons;
}

/** Tests only. */
export function getActivityReasons(): Record<string, FeedbackReason[]> {
  return state.reasons;
}
