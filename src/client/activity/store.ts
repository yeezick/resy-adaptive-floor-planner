// Activity log inputs for this session, from what is already logged: triage results and manager decisions (the
// requests store), assistant responses and what the host applied from them (recorded here), plus a fictional
// seed for earlier this week. Read-only to the Activity screen.
import { useMemo, useSyncExternalStore } from "react";
import weekJson from "../../../fixtures/activity/week.json";
import {
  ActivitySeed,
  buildActivity,
  type ActivityRow,
  type AssistantEvent,
  type ManagerAction,
  type TriageEvent,
} from "../../domain/activity";
import type { AgentResponse } from "../../shared/api";
import { decisionOf, useRequests, type RequestsState } from "../requests/store";
import { tableNumbers } from "../../domain/wording";

const SEED: ActivitySeed = ActivitySeed.parse(weekJson);

interface State {
  assistant: AssistantEvent[];
  applied: ManagerAction[];
}
let state: State = { assistant: [], applied: [] };
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
    const at = new Date().toISOString();
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
  /** The host applied (or started seating from) a recommendation. */
  recordApplied(traceId: string, applied: string) {
    set({
      applied: [
        ...state.applied,
        { refId: traceId, at: new Date().toISOString(), kind: "applied", applied },
      ],
    });
  },
};

/** "Tue 09:12" → this week's date at that time (local), as ISO. */
export function weekdayToIso(label: string, now = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [day, hm] = label.split(" ");
  const [h, m] = (hm ?? "00:00").split(":").map(Number);
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() - days.indexOf(day ?? "Mon") + 7) % 7));
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

export function liveEvents(s: RequestsState): { events: TriageEvent[]; actions: ManagerAction[] } {
  const events: TriageEvent[] = [];
  const actions: ManagerAction[] = [];
  for (const r of s.book?.requests ?? []) {
    const t = s.triage[r.id];
    if (!t || t.status === "loading" || t.status === "host") continue;
    // When it arrived this week, but never later than when its triage finished (the AI action).
    const received = weekdayToIso(r.receivedAt);
    const at = received < t.at ? received : t.at;
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
      actions.push({ refId: r.id, at: d.iso, kind: "declined", reason: d.reason });
    else if (d.kind === "replied")
      actions.push({ refId: r.id, at: d.iso, kind: "replied", edited: d.edited });
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
