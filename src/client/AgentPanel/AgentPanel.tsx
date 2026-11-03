import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Room } from "../../domain";
import {
  MAX_HISTORY_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  type AgentRequest,
  type AgentResponse,
} from "../../shared/api";
import { postAgent, type ClientError } from "../api";
import type { HighlightControls } from "../highlight";
import { partyFromMessage } from "../lib/service";
import { friendlyError } from "./errors";
import { Metrics } from "./Metrics";
import { RecommendationCard } from "./RecommendationCard";

export type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; res: AgentResponse }
  | { id: number; role: "error"; error: ClientError };

const EXAMPLES: Record<string, string[]> = {
  "dinner-peak": [
    "Party of 8 just walked in — where, and how soon?",
    "One guest uses a wheelchair, party of 4",
    "Party of 3 wants a booth",
    "Couple asking for a quiet table with a view",
  ],
  "demo-night": [
    "Generate tonight's layout for 17:00–22:00 — what can't we fit?",
    "Where does the 24-top at 18:00 go, and what do we pull from storage?",
    "Party of 6 walked in at 17:15 — where?",
  ],
  "next-day": [
    "Plan tonight's large-party builds 17:00–20:00",
    "Do we have enough extenders and chairs for tonight?",
    "Party of 4 with a stroller at 18:00 — what works?",
  ],
};
const MAX_HISTORY = 10;

interface Props {
  room: Room;
  highlight: HighlightControls;
  onApplyRows: (rows: string[][]) => void;
  onSelectTables: (ids: string[], partySize: number) => void;
  onOpenShift: () => void;
}

/** What a recommendation can turn into — always a confirmable host action, never a seat. */
export interface RecActions {
  onApplyRows: (rows: string[][]) => void;
  onSelectTables: (ids: string[], partySize: number) => void;
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

export function AgentPanel({ room, highlight, ...actions }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const examples = EXAMPLES[room.id] ?? EXAMPLES["dinner-peak"] ?? [];

  const send = async () => {
    const message = input.trim();
    if (!message || pending || message.length > MAX_MESSAGE_CHARS) return;
    const history = toHistory(turns);
    const userTurn: Turn = { id: nextId.current++, role: "user", text: message };
    setTurns((t) => [...t, userTurn]);
    setInput("");
    setPending(true);
    const result = await postAgent({ roomId: room.id, room, message, history });
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
  const pickExample = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  return (
    <div className="agent">
      <p className="principle" role="note">
        <strong>Recommend, never auto-seat</strong> — you approve every change.
      </p>

      <div className="transcript" aria-live="polite" aria-busy={pending}>
        {turns.length === 0 && (
          <p className="muted small">
            Ask where to seat a party. The agent reads the current floor (including your edits) and
            ranks options; nothing changes until you apply it.
          </p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={t.id} className="bubble user">
              {t.text}
            </div>
          ) : t.role === "error" ? (
            <ErrorTurn key={t.id} error={t.error} />
          ) : (
            <AssistantTurn
              key={t.id}
              turnId={t.id}
              res={t.res}
              room={room}
              highlight={highlight}
              actions={actions}
              partyHint={partyHint(turns, i)}
            />
          ),
        )}
        {pending && <div className="bubble assistant muted">Thinking…</div>}
      </div>

      <div className="chips" aria-label="Example prompts">
        {examples.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => pickExample(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="agent-input" className="sr-only">
          Message to the floor agent
        </label>
        <textarea
          id="agent-input"
          ref={inputRef}
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          rows={3}
          placeholder="e.g. Party of 6 at the door, one in a wheelchair"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby="agent-count"
        />
        <div className="composer-foot">
          <span
            id="agent-count"
            className={`small ${input.length >= MAX_MESSAGE_CHARS ? "warn-text" : "muted"}`}
          >
            {input.length}/{MAX_MESSAGE_CHARS}
          </span>
          <button type="submit" className="primary" disabled={pending || !input.trim()}>
            {pending ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>
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
}

/** Party size from the most recent host message before turn i. */
function partyHint(turns: Turn[], i: number): number | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const t = turns[j];
    if (t?.role === "user") return partyFromMessage(t.text);
  }
  return undefined;
}

function AssistantTurn({ turnId, res, room, highlight, actions, partyHint }: AssistantProps) {
  const recs = [...res.recommendations].sort((a, b) => a.rank - b.rank);
  return (
    <div className="bubble assistant">
      {res.answer && <p className="answer">{res.answer}</p>}
      {res.clarifyingQuestion && (
        <p className="clarify">
          <span className="pill">Question</span> {res.clarifyingQuestion}
        </p>
      )}
      {recs.length > 0 && (
        <div className="recs">
          {recs.map((r) => (
            <RecommendationCard
              key={r.rank}
              rec={r}
              hlKey={`rec-${turnId}-${r.rank}`}
              room={room}
              highlight={highlight}
              actions={actions}
              partySize={partyHint ?? r.seats}
            />
          ))}
        </div>
      )}
      <Metrics res={res} />
    </div>
  );
}
