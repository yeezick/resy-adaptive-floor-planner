import { useEffect, useState } from "react";
import {
  baseConstraints,
  changeList,
  type AdjustedFit,
  type ChatConstraints,
} from "../../domain/requestChat";
import { NEEDS, SERVICE, type GuestRequest } from "../../domain/requests";
import { listAnd } from "../../domain/wording";
import { toHHMM, toMinutes } from "../../domain/time";
import { requestsActions, useRequests } from "./store";
import { ProposedTag } from "./RequestSheet";

const SLOTS = (() => {
  const out: string[] = [];
  for (let m = toMinutes(SERVICE.from); m <= toMinutes(SERVICE.to); m += 15) out.push(toHHMM(m));
  return out;
})();

const EXAMPLES = [
  "find another space between tables 30–50",
  "headcount is now 26",
  "they need a high chair and a quiet corner",
  "can we push it to 19:00?",
];

/**
 * Chat scoped to ONE request, plus the same changes as manual controls. The AI only turns a message into
 * constraints; the planner re-runs and the card above shows the new option and its cost.
 */
export function RequestChat({
  request: r,
  result,
}: {
  request: GuestRequest;
  result: AdjustedFit | null;
}) {
  const s = useRequests();
  const c = s.adjust[r.id] ?? baseConstraints(r);
  const turns = s.chat[r.id] ?? [];
  const [text, setText] = useState("");
  const busy = turns.some((t) => t.status === "loading");
  const setC = (next: Partial<ChatConstraints>) =>
    requestsActions.setConstraints(r.id, { ...c, ...next });

  // Once the planner has re-run after a turn, record its one-line answer on that turn (and in the log).
  const pending = turns.find((t) => t.status === "ok" && t.outcome === undefined);
  useEffect(() => {
    if (!pending || !result) return;
    const clarify = pending.result?.output?.clarify;
    requestsActions.noteTurn(
      r.id,
      pending.id,
      clarify && !changeList(r, c).length ? `Question: ${clarify}` : result.line,
      changeList(r, c),
    );
  }, [pending, result, r, c]);

  const send = () => {
    const m = text.trim();
    if (!m || busy) return;
    setText("");
    void requestsActions.sendChat(r, m);
  };
  const changed = changeList(r, c);

  return (
    <section className="req-block req-chat" aria-label="Adjust this request">
      <div className="req-block-head">
        <h3 className="section-title">Adjust this request</h3>
        <ProposedTag />
      </div>
      <p className="muted small">
        Changes apply to this request only. The AI turns a message into the same settings as the
        controls below; the planner picks the tables.
      </p>

      <div className="adjust-grid small">
        <label>
          Tables from
          <input
            type="number"
            min={1}
            max={999}
            inputMode="numeric"
            value={c.tableRange?.from ?? ""}
            onChange={(e) => {
              const from = Number(e.target.value);
              if (!e.target.value) return setC({ tableRange: null });
              if (Number.isInteger(from) && from > 0)
                setC({ tableRange: { from, to: Math.max(from, c.tableRange?.to ?? from) } });
            }}
          />
        </label>
        <label>
          to
          <input
            type="number"
            min={1}
            max={999}
            inputMode="numeric"
            value={c.tableRange?.to ?? ""}
            onChange={(e) => {
              const to = Number(e.target.value);
              if (!e.target.value) return setC({ tableRange: null });
              if (Number.isInteger(to) && to > 0)
                setC({ tableRange: { from: Math.min(to, c.tableRange?.from ?? to), to } });
            }}
          />
        </label>
        <label>
          Headcount
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={c.partySize ?? r.partySize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n > 0 && n <= 500)
                setC({ partySize: n === r.partySize ? null : n });
            }}
          />
        </label>
        <label>
          Time
          <select
            value={c.time ?? r.time}
            onChange={(e) => setC({ time: e.target.value === r.time ? null : e.target.value })}
          >
            {(SLOTS.includes(r.time) ? SLOTS : [r.time, ...SLOTS]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="chips" role="group" aria-label="Needs">
        {NEEDS.map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            aria-pressed={c.needs.includes(n)}
            onClick={() =>
              setC({
                needs: c.needs.includes(n) ? c.needs.filter((x) => x !== n) : [...c.needs, n],
              })
            }
          >
            {n}
          </button>
        ))}
        {c.notes.map((n) => (
          <button
            key={n}
            type="button"
            className="chip chip-note"
            aria-label={`Remove crew note ${n}`}
            onClick={() => setC({ notes: c.notes.filter((x) => x !== n) })}
          >
            {n} ×
          </button>
        ))}
      </div>
      {changed.length > 0 && (
        <p className="small">
          <span className="muted">Changed: </span>
          {changed.join(" · ")}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => requestsActions.resetConstraints(r.id)}
          >
            Back to the guest's request
          </button>
        </p>
      )}

      <ol className="chat-log" aria-label="Request chat" aria-live="polite">
        {turns.map((t) => (
          <li key={t.id}>
            <p className="chat-me">{t.message}</p>
            <p className={`chat-out small${t.status === "error" ? " warn-text" : ""}`}>
              {t.status === "loading" || t.outcome === undefined
                ? "Checking the plan…"
                : `${t.changed?.length ? `${listAnd(t.changed)} → ` : ""}${t.outcome}`}
              {t.result && (
                <span className="muted">
                  {" "}
                  · {t.result.model} · ${t.result.metrics.costUsd.toFixed(4)}
                </span>
              )}
            </p>
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
        <input
          id={`chat-${r.id}`}
          type="text"
          maxLength={300}
          value={text}
          placeholder={`e.g. "${EXAMPLES[turns.length % EXAMPLES.length]}"`}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Checking…" : "Send"}
        </button>
      </form>
    </section>
  );
}
