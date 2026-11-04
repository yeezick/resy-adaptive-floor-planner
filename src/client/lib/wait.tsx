// How long the two chats wait for the AI, and what they show meanwhile. The client never gives up before the
// server does: a slow answer first shows "Still working", and the hard limit sits past the server's own budget,
// so an answer the server sends always lands on its turn.
import { useEffect, useState } from "react";
import "./wait.css";

/** After this, the working line says the answer is still coming (not an error). */
export const SOFT_WAIT_MS = 8_000;
/** Request chat: the server allows 15 s per model call and one retry after a rejected answer (30 s). */
export const REQUEST_CHAT_HARD_MS = 35_000;
/** AI Planner: the server stops the whole run at 20 s. */
export const AGENT_HARD_MS = 25_000;

export const STILL_WORKING = "Still working — the answer will appear here";
export const TOO_LONG = "That took too long. Nothing changed. Try again.";

/** Whole seconds since `since` (Date.now() ms; null = since first shown), ticking once a second while shown. */
export function useElapsed(since: number | null): number {
  const [start] = useState(() => since ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - start) / 1000));
}

/** The AI is working: animated dots, then "Checking the plan · 4 s" (or "Still working…" once slow). */
export function Working({
  since,
  label = "Checking the plan",
  className = "",
}: {
  since: number | null;
  label?: string;
  className?: string;
}) {
  const s = useElapsed(since);
  const slow = s * 1000 >= SOFT_WAIT_MS;
  return (
    <span className={`ai-working ${className}`.trim()} role="status">
      <span className="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="ai-working-text">
        {slow ? STILL_WORKING : label} · {s} s
      </span>
    </span>
  );
}

/** A small spinner for a busy Send button. */
export function Spinner() {
  return <span className="btn-spinner" aria-hidden="true" />;
}
