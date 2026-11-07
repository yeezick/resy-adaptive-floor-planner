import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { checkAdjusted } from "../../domain/requestChat";
import type { GuestRequest } from "../../domain/requests";
import type { PartyFit, RequestFit, Room } from "../../domain";
import { times12 } from "../../domain/time";
import { plainTables } from "../../domain/wording";
import { chatAnchor, currentRequest, requestsActions, useRequests, type ChatTurn } from "./store";
import { Working } from "../lib/wait";
import { ACCEPT_ASK, localAnswer, notedLine, turnSentence, type ProposalStatus } from "./chatReply";
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
  room = null,
  fit = null,
  cost = null,
  focusSeq = 0,
}: {
  request: GuestRequest;
  /** The night's book, for answers the capacity check gives by itself. */
  room?: Room | null;
  fit?: RequestFit | null;
  cost?: PartyFit | null;
  /** Bumped when the chat opens: the message box takes focus. */
  focusSeq?: number;
}) {
  const s = useRequests();
  const turns = useMemo(() => s.chat[r.id] ?? [], [s.chat, r.id]);
  const [text, setText] = useState("");
  const [micHint, setMicHint] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The newest turn stays in view (on send and on each answer) unless the manager scrolled up to read.
  const log = useRef<HTMLOListElement>(null);
  const pinnedToEnd = useRef(true);

  // Once a model turn has its own constraints, work out ITS capacity sentence (from those constraints only)
  // and record it on that turn by id, for the chat and the activity log.
  useEffect(() => {
    if (!room) return;
    for (const t of turns) {
      if (t.status !== "ok" || t.local || t.outcome !== undefined || !t.after) continue;
      const line = checkAdjusted(room, r, t.after).line;
      requestsActions.noteTurn(
        r.id,
        t.id,
        t.clarify && !t.changed?.length ? `Question: ${t.clarify}` : line,
        t.changed ?? [],
      );
    }
  }, [turns, room, r]);
  useEffect(() => {
    if (focusSeq) box.current?.focus({ preventScroll: true });
  }, [focusSeq]);

  const send = () => {
    const m = text.trim();
    pinnedToEnd.current = true;
    // Send stays open while a turn is pending: each message is its own turn and gets its own answer
    if (!m) return;
    setText("");
    const current = currentRequest(s, r);
    const local = room ? localAnswer(m, { room, request: current, fit, cost }) : null;
    if (local)
      return requestsActions.answerLocal(r, m, times12(local.text), local.alt, {
        accept: !!local.accept,
      });
    // a change mixed with "accept it": the proposal, then the accept line (A1); an injection phrase alone with a
    // change gets no accept line
    void requestsActions.sendChat(
      r,
      m,
      room
        ? {
            room,
            planArea: fit?.ok ? fit.build.area : null,
            planTables: fit?.ok ? fit.build.tables : [],
          }
        : undefined,
      { accept: ACCEPT_ASK.test(m) },
    );
  };
  const lastTurn = turns[turns.length - 1];
  const turnKey = `${turns.length}#${lastTurn?.status ?? ""}#${lastTurn?.outcome ?? ""}`;
  useEffect(() => {
    const el = log.current;
    if (el && pinnedToEnd.current) el.scrollTop = el.scrollHeight;
    // the thread grows with each turn: keep the message box above the sheet's sticky footer
    keepAboveFooter(box.current);
  }, [turnKey]);
  // After a chat action (an answer, Apply, Discard, Revert — which remounts the night) the box stays in view while
  // the sheet settles: measured right after the DOM changes, then twice more on timers for content that lands a
  // moment later. No animation frames: a throttled browser pane may not run them (T31).
  const p = s.proposals[r.id];
  const anchorKey = [
    turnKey,
    p ? (p.floor ? "floor" : "constraints") : "",
    s.floorApplied[r.id]?.layoutId ?? "",
    JSON.stringify(s.adjust[r.id] ?? null),
    room ? "room" : "",
    fit ? (fit.ok ? fit.build.tables.join() : "no-fit") : "",
  ].join("|");
  useLayoutEffect(() => {
    if (!chatAnchor.wanted(r.id)) return;
    keepAboveFooter(box.current);
    const later = [150, 600].map((ms) => window.setTimeout(() => keepAboveFooter(box.current), ms));
    return () => later.forEach((t) => window.clearTimeout(t));
  }, [anchorKey, r.id]);
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

      <ol
        className="chat-log"
        aria-label="AI Planner chat"
        aria-live="polite"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {(noted || (split && offerText)) && (
          <li className="chat-noted">
            {noted && <p className="chat-out small">{noted}</p>}
            {split && offerText && <p className="chat-out small chat-offer">{offerText}</p>}
          </li>
        )}
        {turns.map((t) => (
          <li key={t.id}>
            <p className="chat-me">{t.message}</p>
            <ChatReply turn={t} proposal={s.turnStatus[t.id]} />
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
          onFocus={(e) => keepAboveFooter(e.currentTarget)}
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
          <button type="submit" className="tonal" disabled={!text.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

/** One turn's reply: working (dots + seconds), then that turn's own answer. */
function ChatReply({ turn: t, proposal }: { turn: ChatTurn; proposal?: ProposalStatus }) {
  const text = turnSentence(t, proposal);
  if (text === null)
    return (
      <p className="chat-out small">
        <Working since={t.sentMs ?? null} />
      </p>
    );
  return (
    <p className={`chat-out small${t.status === "error" ? " warn-text" : ""}`}>
      {times12(plainTables(text))}
    </p>
  );
}

/**
 * Keep the message box in view and fully above the sheet's sticky footer (iPad, 1180×820): scroll the sheet so
 * the box's bottom clears the footer's top by 8 px, or, when the box sits above the visible part of the sheet,
 * so its top shows again.
 */
export function keepAboveFooter(el: HTMLElement | null): void {
  if (!el) return;
  const footer = el.closest(".request-sheet")?.querySelector<HTMLElement>(".decision-footer");
  const box = el.getBoundingClientRect();
  const top = footer?.getBoundingClientRect().top ?? window.innerHeight;
  // the nearest scrolling ancestor takes the difference
  let p: HTMLElement | null = el.parentElement;
  while (
    p &&
    !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))
  )
    p = p.parentElement;
  const overlap = box.bottom + 8 - top;
  if (overlap > 0) {
    if (p) p.scrollTop += overlap;
    else el.scrollIntoView({ block: "center" });
    return;
  }
  const above = (p ? p.getBoundingClientRect().top : 0) - box.top;
  if (above > 0) {
    if (p) p.scrollTop -= above + 8;
    else el.scrollIntoView({ block: "center" });
  }
}
