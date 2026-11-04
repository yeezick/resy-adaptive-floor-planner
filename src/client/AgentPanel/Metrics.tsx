import type { AgentResponse } from "../../shared/api";
import { duration, usd } from "../lib/format";

export function Metrics({ res }: { res: AgentResponse }) {
  const m = res.metrics;
  return (
    <details className="metrics how-made small">
      <summary>How this was made</summary>
      <p className="metrics-line">
        <span>{usd(m.costUsd)}</span>
        <span>{duration(m.latencyMs)}</span>
        <span>
          {m.toolTurns} tool turn{m.toolTurns === 1 ? "" : "s"}
        </span>
        <span>
          {m.validatorRejects} validator reject{m.validatorRejects === 1 ? "" : "s"}
        </span>
        <span>{res.promptVersion}</span>
        <span>{res.model}</span>
      </p>
      <dl className="kv">
        <dt>Trace</dt>
        <dd className="mono">{res.traceId}</dd>
        <dt>Tools</dt>
        <dd>
          {res.toolCalls.length
            ? res.toolCalls.map((t, i) => (
                <span key={i} className={t.ok ? "" : "warn-text"}>
                  {i ? ", " : ""}
                  {t.name}
                  {t.ok ? "" : " (failed)"}
                </span>
              ))
            : "none"}
        </dd>
        {res.validator.notes.length > 0 && (
          <>
            <dt>Validator</dt>
            <dd>
              <ul className="plain">
                {res.validator.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>Calls</dt>
        <dd>
          {m.calls.map((c) => (
            <div key={`${c.traceId}-${c.role}-${c.latencyMs}`}>
              {c.role} · {c.inputTokens} in / {c.outputTokens} out
              {c.cacheReadTokens ? ` · ${c.cacheReadTokens} cached` : ""} · {usd(c.costUsd)} ·{" "}
              {duration(c.latencyMs)}
            </div>
          ))}
        </dd>
      </dl>
    </details>
  );
}
