import { useEffect, useMemo, useRef, useState } from "react";
import {
  baseConstraints,
  changeDelta,
  changeList,
  type AdjustedFit,
} from "../../domain/requestChat";
import type { GuestRequest } from "../../domain/requests";
import type { PartyFit, RequestFit, Room } from "../../domain";
import { times12 } from "../../domain/time";
import { currentRequest, requestsActions, useRequests } from "./store";
import { localAnswer, notedLine, turnSentence } from "./chatReply";
import { oneRoomPlan, oneRoomSentence } from "../../domain/alternatives";
import "./chat15.css";

const EXAMPLES = [
  "can we put all 22 in one room?",
  "bring tables from the back if we have them",
  "headcount is now 26",
  "can we push it to 7:00 PM?",
];

/**
 * Chat scoped to ONE request, in plain language. The AI only turns a message into constraints; the planner
 * re-runs and a change waits as "Proposed changes" (Apply / Discard). Questions the capacity check can answer
 * alone (one room, storage, a need already set) are answered here. Every manual setting is on the review
 * screen after Accept.
 */
export function RequestChat({
  request: r,
  result,
  room = null,
  fit = null,
  cost = null,
  focusSeq = 0,
}: {
  request: GuestRequest;
  result: AdjustedFit | null;
  /** The night's book, for answers the capacity check gives by itself. */
  room?: Room | null;
  fit?: RequestFit | null;
  cost?: PartyFit | null;
  /** Bumped when the chat opens: the message box takes focus. */
  focusSeq?: number;
}) {
  const s = useRequests();
  const c = s.adjust[r.id] ?? baseConstraints(r);
  const turns = s.chat[r.id] ?? [];
  const [text, setText] = useState("");
  const [micHint, setMicHint] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = turns.some((t) => t.status === "loading");

  // Once the planner has re-run after a turn, record its one-line answer on that turn (and in the log).
  const pending = turns.find((t) => t.status === "ok" && t.outcome === undefined);
  // the turn's answer is what its proposal would do (the proposal, if one is waiting; else the current state)
  const proposed = s.proposals[r.id]?.constraints ?? c;
  useEffect(() => {
    if (!pending || !result) return;
    const clarify = pending.result?.output?.clarify;
    requestsActions.noteTurn(
      r.id,
      pending.id,
      clarify && !changeList(r, proposed).length ? `Question: ${clarify}` : result.line,
      changeDelta(r, pending.before ?? baseConstraints(r), proposed),
    );
  }, [pending, result, r, proposed]);
  useEffect(() => {
    if (focusSeq) box.current?.focus({ preventScroll: true });
  }, [focusSeq]);
  // an answer that takes too long ends in a plain error, never a spinner (the store marks it on the turn)
  const loadingId = turns.find((t) => t.status === "loading")?.id;
  useEffect(() => {
    if (!loadingId) return;
    const t = window.setTimeout(() => requestsActions.timeoutTurn(r.id, loadingId), 8000);
    return () => window.clearTimeout(t);
  }, [loadingId, r.id]);

  const send = () => {
    const m = text.trim();
    if (!m || busy) return;
    setText("");
    const current = currentRequest(s, r);
    const local = room ? localAnswer(m, { room, request: current, fit, cost }) : null;
    if (local) return requestsActions.answerLocal(r, m, times12(local.text), local.alt);
    void requestsActions.sendChat(r, m);
  };
  const noted = notedLine(currentRequest(s, r), cost);
  // A plan split across rooms: offer the one-room answer (storage included) up front, worked out after paint.
  // keyed by the request state it was worked out for, so a stale line never shows for a changed request
  const [offer, setOffer] = useState<{ key: string; text: string } | null>(null);
  const split = fit?.ok && fit.build.area.includes(" + ") ? fit.build.area : null;
  // keyed on the applied changes, so typing in the box never re-runs the per-room check
  const adjustKey = JSON.stringify(s.adjust[r.id] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const req = useMemo(() => currentRequest(s, r), [adjustKey, r]);
  useEffect(() => {
    if (!room || !split) return;
    const t = window.setTimeout(() => {
      const plan = oneRoomPlan(room, req);
      setOffer({
        key: `${r.id}#${adjustKey}#${split}`,
        text: plan.ok
          ? `This plan spans ${split}. ${oneRoomSentence(req, plan, { area: split })}`
          : `This plan spans ${split}. ${oneRoomSentence(req, plan, null)}`,
      });
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, split, req]);
  const offerText = offer?.key === `${r.id}#${adjustKey}#${split}` ? offer.text : null;

  return (
    <section className="req-block req-chat" aria-label="Adjust this request">
      <div className="req-block-head">
        <h3 className="section-title">Discuss this request</h3>
      </div>

      <ol className="chat-log" aria-label="AI Planner chat" aria-live="polite">
        {(noted || (split && offerText)) && (
          <li className="chat-noted">
            {noted && <p className="chat-out small">{noted}</p>}
            {split && offerText && <p className="chat-out small chat-offer">{offerText}</p>}
          </li>
        )}
        {turns.map((t) => (
          <li key={t.id}>
            <p className="chat-me">{t.message}</p>
            <p className={`chat-out small${t.status === "error" ? " warn-text" : ""}`}>
              {t.status === "loading" || t.outcome === undefined
                ? "Checking the plan…"
                : times12(turnSentence(t))}
            </p>
            {t.result && (
              <details className="how-made small">
                <summary>How this was made</summary>
                <span className="muted">
                  {t.result.model} · ${t.result.metrics.costUsd.toFixed(4)}
                </span>
              </details>
            )}
          </li>
        ))}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor={`chat-${r.id}`}>
          Message about this request
        </label>
        <textarea
          id={`chat-${r.id}`}
          ref={box}
          rows={3}
          maxLength={300}
          value={text}
          placeholder={`e.g. "${EXAMPLES[turns.length % EXAMPLES.length]}"`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-form-foot">
          <button
            type="button"
            className="mic-btn"
            aria-disabled="true"
            aria-label="Dictate (future idea)"
            title="Future: dictate instead of typing — hands are busy on the floor"
            onClick={() => setMicHint((v) => !v)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect
                x="5.5"
                y="1.5"
                width="5"
                height="8.5"
                rx="2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {micHint && (
            <span className="small muted mic-hint">
              Future: dictate instead of typing — hands are busy on the floor
            </span>
          )}
          <span className="spacer" />
          <button type="submit" className="tonal" disabled={busy || !text.trim()}>
            {busy ? "Checking…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
