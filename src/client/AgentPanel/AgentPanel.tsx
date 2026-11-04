import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Room } from "../../domain";
import {
  MAX_HISTORY_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  type AgentRequest,
  type AgentResponse,
  type Recommendation,
} from "../../shared/api";
import { postAgent, type ClientError } from "../api";
import type { HighlightControls } from "../highlight";
import { partyFromMessage } from "../lib/service";
import { friendlyError } from "./errors";
import { Metrics } from "./Metrics";
import { activityActions } from "../activity/store";
import { RecommendationCard } from "./RecommendationCard";
import { plainTables, tablesPhrase } from "../../domain/wording";
import { times12 } from "../../domain/time";
import { SourceFeedback } from "../activity/SourceFeedback";
import { activeScenario, RECORDED_WALKIN } from "../scenarios";
import "./agent15.css";
import type { WalkInReviewDraft } from "../Review/WalkInReview";
import { actionSentence, fixCopy, needsFromMessage, reasonTag, resolveOption } from "./options";

export type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; res: AgentResponse }
  | { id: number; role: "error"; error: ClientError }
  /** Answered on this device from the options on screen ("option 1", "table 41"); no model call. */
  | { id: number; role: "local"; text: string; ref: number; ranks: number[] };

const MAX_HISTORY = 10;
/** A request that takes longer than this gets a plain error (the host is mid-service). */
const TIMEOUT_MS = 8000;

interface Props {
  room: Room;
  highlight: HighlightControls;
  /** An option's action: opens the review screen pre-filled (nothing changes until the host confirms there). */
  onPick: (d: WalkInReviewDraft) => void;
  onOpenShift: () => void;
  /** Result lines of options the host acted on, by card key ("rec-<turn>-<rank>"). */
  done: Readonly<Record<string, { text: string; undo: () => void }>>;
  /** Tables already promised or seated in this session, with the demo clock time. */
  taken: ReadonlyMap<string, string>;
  /** The panel is on screen (kept mounted when hidden so the thread survives). */
  visible: boolean;
  /** Started with "New chat": no recorded opening thread. */
  fresh?: boolean;
  /** This thread's id (ratings on replies answered on this device are keyed by it + the message index). */
  threadId: string;
}

/** What a recommendation can turn into — always a confirmable host action, never a seat. */
export interface RecActions {
  onPick: (rec: Recommendation, partySize: number) => void;
  onOpenShift: () => void;
}

/**
 * The most recent turns that fit the server's history caps: at most MAX_HISTORY turns,
 * each cut to MAX_TURN_CHARS, MAX_HISTORY_CHARS in total. Stops at the first turn that
 * doesn't fit so the history stays a contiguous, most-recent slice.
 */
export function toHistory(turns: Turn[]): AgentRequest["history"] {
  const all: AgentRequest["history"] = [];
  for (const t of turns) {
    if (t.role === "user") all.push({ role: "user", text: t.text });
    else if (t.role === "local") all.push({ role: "assistant", text: t.text });
    else if (t.role === "assistant") {
      const text = [t.res.answer, t.res.clarifyingQuestion].filter(Boolean).join("\n");
      all.push({ role: "assistant", text });
    }
  }
  const out: AgentRequest["history"] = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0 && out.length < MAX_HISTORY; i--) {
    const turn = all[i];
    if (!turn) continue;
    const text = turn.text.slice(0, MAX_TURN_CHARS);
    if (used + text.length > MAX_HISTORY_CHARS) break;
    used += text.length;
    out.unshift({ role: turn.role, text });
  }
  return out;
}

/** A scenario URL opens the assistant mid-conversation with a recorded answer (no model call). */
function scenarioTurns(room: Room): Turn[] {
  const sc = activeScenario();
  if (sc?.panel !== "assistant" || sc.roomId !== room.id) return [];
  return [
    { id: -2, role: "user", text: RECORDED_WALKIN.message },
    { id: -1, role: "assistant", res: RECORDED_WALKIN.response },
  ];
}

export function AgentPanel({
  room,
  highlight,
  onPick,
  onOpenShift,
  done,
  taken,
  visible,
  fresh = false,
  threadId,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>(() => (fresh ? [] : scenarioTurns(room)));
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [micHint, setMicHint] = useState(false);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const demo = activeScenario() !== null;

  // Back from Table details or the review screen: the thread is where the host left it, the box is ready.
  useLayoutEffect(() => {
    if (!visible) return;
    if (logRef.current) logRef.current.scrollTop = scrollTop.current;
    inputRef.current?.focus({ preventScroll: true });
  }, [visible]);
  // a new turn scrolls into view from its top (the opening thread stays at its start)
  const seen = useRef(turns.length);
  useEffect(() => {
    const el = logRef.current;
    if (!el || !visible || turns.length + Number(pending) === seen.current) return;
    seen.current = turns.length + Number(pending);
    const last = el.lastElementChild as HTMLElement | null;
    if (!last) return;
    el.scrollTop += last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    scrollTop.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, pending]);

  // back from the review screen: the card with the new result line is in view
  const doneCount = Object.keys(done).length;
  useLayoutEffect(() => {
    const el = logRef.current;
    const card = el?.querySelector<HTMLElement>(
      ".rec-card.is-done:last-of-type, .rec-card.is-done",
    );
    if (!el || !card || !visible) return;
    const cardBox = card.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (cardBox.bottom > box.bottom || cardBox.top < box.top)
      el.scrollTop += cardBox.bottom - box.bottom + 12;
    scrollTop.current = el.scrollTop;
  }, [doneCount, visible]);

  /** The latest answer with options, and its party size + needs from the host's message before it. */
  const latest = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t?.role === "assistant" && t.res.recommendations.length) return { turn: t, index: i };
    }
    return null;
  })();
  const pick = (turnId: number, res: AgentResponse, rec: Recommendation, size: number, i: number) =>
    onPick({
      key: `rec-${turnId}-${rec.rank}`,
      traceId: res.traceId,
      tables: rec.tables,
      waitMin: rec.waitMin,
      size,
      needs: needsFromMessage(hostText(turns, i)),
    });

  const send = async () => {
    const message = input.trim();
    if (!message || pending || message.length > MAX_MESSAGE_CHARS) return;
    const userTurn: Turn = { id: nextId.current++, role: "user", text: message };
    setInput("");
    // "go ahead with option 1", "the fastest one", "table 41": answered here from the options on screen
    if (latest) {
      const recs = latest.turn.res.recommendations.filter(
        (r) => !done[`rec-${latest.turn.id}-${r.rank}`],
      );
      const r = resolveOption(message, recs);
      if (r.kind !== "none") {
        const size = partyHint(turns, latest.index) ?? recs[0]?.seats ?? 2;
        const text =
          r.kind === "one"
            ? (() => {
                const rec = recs.find((x) => x.rank === r.rank) as Recommendation;
                return `Option #${rec.rank}: ${actionSentence(rec, size)}. Review it, then confirm; nothing changes until you do.`;
              })()
            : `Which one? ${r.ranks
                .map((n) => {
                  const rec = recs.find((x) => x.rank === n) as Recommendation;
                  return `#${n} ${tablesPhrase(rec.tables)}`;
                })
                .join(", ")}.`;
        setTurns((t) => [
          ...t,
          userTurn,
          {
            id: nextId.current++,
            role: "local",
            text,
            ref: latest.turn.id,
            ranks: r.kind === "one" ? [r.rank] : r.ranks,
          },
        ]);
        return;
      }
    }
    const history = toHistory(turns);
    setTurns((t) => [...t, userTurn]);
    setPending(true);
    const timeout = new Promise<{ ok: false; error: ClientError }>((resolve) =>
      window.setTimeout(
        () =>
          resolve({
            ok: false,
            error: {
              code: "timeout",
              message: "The AI Planner took too long. Try again, or pick a table yourself.",
            } as ClientError,
          }),
        TIMEOUT_MS,
      ),
    );
    const result = await Promise.race([
      postAgent({ roomId: room.id, room, message, history }),
      timeout,
    ]);
    void activityActions.recordAssistant(room.id, message, result);
    const id = nextId.current++;
    setTurns((t) => [
      ...t,
      result.ok
        ? { id, role: "assistant", res: result.data }
        : { id, role: "error", error: result.error },
    ]);
    setPending(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="agent">
      {demo && (
        <p className="principle info-callout" role="note">
          <span className="info-icon" aria-hidden="true">
            ⓘ
          </span>{" "}
          <span>
            <strong>Recommend, never auto-seat</strong> — you approve every change.
          </span>
        </p>
      )}

      <div
        className="transcript"
        ref={logRef}
        aria-live="polite"
        aria-busy={pending}
        onScroll={(e) => (scrollTop.current = e.currentTarget.scrollTop)}
      >
        {turns.length === 0 && (
          <p className="muted small">
            Tell the AI Planner who is at the door. It reads the current floor (including your
            edits) and ranks options; nothing changes until you confirm one.
          </p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={t.id} className="bubble user">
              {t.text}
            </div>
          ) : t.role === "error" ? (
            <ErrorTurn key={t.id} error={t.error} />
          ) : t.role === "local" ? (
            <LocalTurn
              key={t.id}
              turn={t}
              index={i}
              threadId={threadId}
              source={turns.find((x) => x.id === t.ref)}
              done={done}
              onPick={(res, rec) =>
                pick(
                  t.ref,
                  res,
                  rec,
                  partyHint(
                    turns,
                    turns.findIndex((x) => x.id === t.ref),
                  ) ?? rec.seats,
                  turns.findIndex((x) => x.id === t.ref),
                )
              }
            />
          ) : (
            <AssistantTurn
              key={t.id}
              turnId={t.id}
              res={t.res}
              room={room}
              highlight={highlight}
              done={done}
              taken={taken}
              actions={{
                onPick: (rec, size) => pick(t.id, t.res, rec, size, i),
                onOpenShift,
              }}
              partyHint={partyHint(turns, i)}
            />
          ),
        )}
        {pending && (
          <div className="bubble assistant muted" role="status">
            Checking {room.tables.length} tables, meal phases and holds…
          </div>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="agent-input" className="sr-only">
          Message to the AI Planner
        </label>
        <textarea
          id="agent-input"
          ref={inputRef}
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          rows={3}
          placeholder={
            turns.length
              ? "Reply, or say which option: “option 1”"
              : "e.g. Party of 6 at the door, one in a wheelchair"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-foot">
          <button
            type="button"
            className="mic-btn"
            aria-disabled="true"
            aria-label="Dictate (future idea)"
            aria-describedby="mic-hint"
            title="Future: dictate instead of typing — hands are busy on the floor"
            onClick={() => setMicHint((v) => !v)}
          >
            <MicIcon />
          </button>
          <span id="mic-hint" className={`small muted mic-hint${micHint ? "" : " sr-only"}`}>
            Future: dictate instead of typing — hands are busy on the floor
          </span>
          {input.length > MAX_MESSAGE_CHARS * 0.8 && (
            <span className={`small ${input.length >= MAX_MESSAGE_CHARS ? "warn-text" : "muted"}`}>
              {input.length}/{MAX_MESSAGE_CHARS}
            </span>
          )}
          <span className="spacer" />
          <button type="submit" className="tonal" disabled={pending || !input.trim()}>
            {pending ? "Asking…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The host's message right before turn i (for the needs it names). */
function hostText(turns: Turn[], i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    const t = turns[j];
    if (t?.role === "user") return t.text;
  }
  return "";
}

/** A reply answered from the options on screen: the action as a button (it opens the review screen). */
function LocalTurn({
  turn,
  index,
  threadId,
  source,
  done,
  onPick,
}: {
  turn: Extract<Turn, { role: "local" }>;
  index: number;
  threadId: string;
  source: Turn | undefined;
  done: Props["done"];
  onPick: (res: AgentResponse, rec: Recommendation) => void;
}) {
  const res = source?.role === "assistant" ? source.res : null;
  return (
    <div className="bubble assistant">
      <p className="answer">{turn.text}</p>
      {res && (
        <div className="btn-row local-actions">
          {turn.ranks.map((n) => {
            const rec = res.recommendations.find((r) => r.rank === n);
            if (!rec) return null;
            const key = `rec-${source?.id}-${n}`;
            return done[key] ? (
              <span key={n} className="ok-text small">
                {done[key].text}
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className={turn.ranks.length === 1 ? "primary" : "outline"}
                onClick={() => onPick(res, rec)}
              >
                {turn.ranks.length === 1
                  ? turn.text.replace(/^Option #\d+: /, "").replace(/\. Review it.*$/, "")
                  : `#${n} ${tablesPhrase(rec.tables)} · ${rec.waitMin ? `~${rec.waitMin} min` : "free now"}`}
              </button>
            );
          })}
        </div>
      )}
      <SourceFeedback rowId={`row-${threadId}-${index}`} what="AI Planner reply" compact />
    </div>
  );
}

function ErrorTurn({ error }: { error: ClientError }) {
  const f = friendlyError(error);
  return (
    <div className="bubble error-bubble" role="alert">
      <strong>{f.title}</strong>
      <div className="small">{f.body}</div>
    </div>
  );
}

interface AssistantProps {
  turnId: number;
  res: AgentResponse;
  room: Room;
  highlight: HighlightControls;
  actions: RecActions;
  partyHint: number | undefined;
  done: Props["done"];
  taken: Props["taken"];
}

/** Party size from the most recent host message before turn i. */
function partyHint(turns: Turn[], i: number): number | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const t = turns[j];
    if (t?.role === "user") return partyFromMessage(t.text);
  }
  return undefined;
}

/** The answer's first sentence; the rest behind "More ▸" (display only). */
function AnswerLead({ text }: { text: string }) {
  // split after the first sentence of at least ~20 characters (so "e.g." never ends the lead)
  const m = /^(.{20,}?[.!?])(\s+)([\s\S]+)$/.exec(text);
  if (!m) return <p className="answer">{text}</p>;
  return (
    <div className="answer">
      <p className="answer-lead">{m[1]}</p>
      <details className="more small">
        <summary>More ▸</summary>
        <p>{m[3]}</p>
      </details>
    </div>
  );
}

function AssistantTurn({
  turnId,
  res,
  room,
  highlight,
  actions,
  partyHint,
  done,
  taken,
}: AssistantProps) {
  const recs = [...res.recommendations].sort((a, b) => a.rank - b.rank);
  // once the host acts on one option, the others clear (the chosen card keeps its result line)
  const chosen = recs.find((r) => done[`rec-${turnId}-${r.rank}`]);
  const shown = chosen ? [chosen] : recs;
  const takenAt = (r: Recommendation) => r.tables.map((id) => taken.get(id)).find(Boolean);
  return (
    <div className="bubble assistant">
      {res.answer && <AnswerLead text={fixCopy(times12(plainTables(res.answer)))} />}
      {res.clarifyingQuestion && (
        <p className="clarify">
          <span className="pill">Question</span>{" "}
          {fixCopy(times12(plainTables(res.clarifyingQuestion)))}
        </p>
      )}
      {recs.length > 0 && (
        <div className="recs">
          {shown.map((r) => (
            <RecommendationCard
              primary={r.rank === recs[0]?.rank}
              key={r.rank}
              rec={r}
              hlKey={`rec-${turnId}-${r.rank}`}
              room={room}
              highlight={highlight}
              actions={actions}
              partySize={partyHint ?? r.seats}
              tag={reasonTag(room, r, recs)}
              done={done[`rec-${turnId}-${r.rank}`]}
              taken={chosen ? undefined : takenAt(r)}
            />
          ))}
          {chosen && recs.length > 1 && (
            <p className="muted small">
              {recs.length - 1} other option{recs.length === 2 ? "" : "s"} cleared
            </p>
          )}
        </div>
      )}
      <div className="reply-foot">
        <Metrics res={res} />
        {(res.answer || recs.length > 0) && (
          <SourceFeedback rowId={`row-${res.traceId}`} what="AI Planner answer" compact />
        )}
      </div>
    </div>
  );
}

/** A microphone outline (decorative). */
function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="mic-icon">
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
  );
}
