import { useEffect, useMemo, useState } from "react";
import {
  activityCounts,
  filterActivity,
  type ActivityFilter,
  type ActivityKind,
  type ActivityRow,
  type RowDecision,
} from "../../domain/activity";
import { duration, usd } from "../lib/format";
import { ProposedTag } from "../requests/RequestSheet";
import { startRequests } from "../requests/store";
import { useActivity } from "./store";
import { SOURCE_LABEL as REQUEST_SOURCE } from "../../domain/requests";

const KIND_LABEL: Record<ActivityKind, string> = {
  request: "Request triage",
  escalation: "Escalated to a person",
  "assistant-question": "Assistant question",
  recommendation: "Recommendation",
  "assistant-answer": "Assistant answer",
  refusal: "Refusal",
};
const SOURCE_LABEL = { ...REQUEST_SOURCE, host: "Host (assistant)" } as const;

const TYPES: { id: NonNullable<ActivityFilter["type"]>; label: string }[] = [
  { id: "request", label: "Request triage" },
  { id: "junk", label: "Junk" },
  { id: "escalation", label: "Escalations" },
  { id: "recommendation", label: "Recommendations" },
  { id: "assistant-question", label: "Questions" },
  { id: "validator-reject", label: "Validator rejects" },
  { id: "refusal", label: "Refusals" },
];
const DECISIONS: { id: RowDecision["kind"]; label: string }[] = [
  { id: "accepted", label: "Accepted" },
  { id: "declined", label: "Declined" },
  { id: "edited", label: "Edited" },
  { id: "replied", label: "Replied" },
  { id: "pending", label: "Pending" },
  { id: "none", label: "Nothing to decide" },
];

export function fmtAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DecisionChip({ d }: { d: RowDecision }) {
  switch (d.kind) {
    case "accepted":
      return <span className="verdict verdict-real">Accepted</span>;
    case "declined":
      return (
        <span
          className={`verdict ${d.reason === "policy" ? "verdict-policy" : d.reason === "fit" ? "verdict-fit" : "verdict-wait"}`}
        >
          Declined · {d.reason === "fit" ? "capacity fit" : d.reason}
        </span>
      );
    case "edited":
      return <span className="verdict verdict-wait">Reply edited</span>;
    case "replied":
      return <span className="verdict verdict-wait">Replied</span>;
    case "pending":
      return <span className="verdict verdict-pending">Pending</span>;
    case "none":
      return <span className="muted small">—</span>;
  }
}

export function ActivityPage() {
  useEffect(startRequests, []);
  const rows = useActivity();
  const [filter, setFilter] = useState<ActivityFilter>({});
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => filterActivity(rows, filter), [rows, filter]);
  const counts = activityCounts(rows);
  const selected = rows.find((r) => r.id === open) ?? null;
  const total = rows.reduce((n, r) => n + r.costUsd, 0);

  return (
    <div className="activity">
      <div className="activity-head">
        <div>
          <h1>
            AI activity <ProposedTag />
          </h1>
          <p className="muted small">
            Everything the AI touched this week, newest first, with what a person decided.
            Read-only, built from the triage, assistant and decision logs. Guest and host text is
            kept only as a hash — you see the AI's own summary.
          </p>
        </div>
        <div className="totals activity-counts" aria-label="This week">
          <Count label="Requests this week" value={counts.requests} />
          <Count label="Accepted" value={counts.accepted} />
          <Count label="Declined · capacity fit" value={counts.declined.fit} />
          <Count label="Declined · policy" value={counts.declined.policy} />
          <Count label="Declined · other" value={counts.declined.other} />
          <Count label="Pending" value={counts.pending} />
        </div>
      </div>

      <div className="activity-filters" role="group" aria-label="Filters">
        <label className="field-inline">
          <span>Type</span>
          <select
            value={filter.type ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                type: (e.target.value || undefined) as ActivityFilter["type"],
              }))
            }
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span>Decision</span>
          <select
            value={filter.decision ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                decision: (e.target.value || undefined) as ActivityFilter["decision"],
              }))
            }
          >
            <option value="">All</option>
            {DECISIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span>Decline reason</span>
          <select
            value={filter.reason ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                reason: (e.target.value || undefined) as ActivityFilter["reason"],
              }))
            }
          >
            <option value="">Any</option>
            <option value="fit">Capacity fit</option>
            <option value="policy">Policy</option>
            <option value="other">Other</option>
          </select>
        </label>
        <span className="muted small">
          {shown.length} of {rows.length} rows · AI spend {usd(total)}
        </span>
      </div>

      <div className="activity-body">
        <table className="data activity-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Source</th>
              <th scope="col">Party · date</th>
              <th scope="col">What the AI did</th>
              <th scope="col">Manager decision</th>
              <th scope="col" className="num">
                Cost · latency
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                className={open === r.id ? "is-open" : undefined}
                onClick={() => setOpen(r.id)}
              >
                <td className="mono">{fmtAt(r.at)}</td>
                <td>{SOURCE_LABEL[r.source]}</td>
                <td>
                  {r.partySize ? `${r.partySize}` : "—"}
                  {r.when ? ` · ${r.when}` : ""}
                </td>
                <td>
                  <button
                    type="button"
                    className="link-btn row-what"
                    aria-expanded={open === r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(r.id);
                    }}
                  >
                    <span className={`kind kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span>{" "}
                    {r.flags.includes("validator-reject") && (
                      <span className="kind kind-reject">validator reject</span>
                    )}{" "}
                    {r.what}
                  </button>
                </td>
                <td>
                  <DecisionChip d={r.decision} />
                </td>
                <td className="num mono">
                  {usd(r.costUsd)} · {r.latencyMs ? duration(r.latencyMs) : "—"}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && <RecordPanel r={selected} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`stat${warn && value ? " warn" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function RecordPanel({ r, onClose }: { r: ActivityRow; onClose: () => void }) {
  return (
    <aside className="record" aria-label="Full record">
      <div className="panel-head">
        <h2>Full record</h2>
        <button type="button" className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="record-body small">
        <p className="muted">
          {KIND_LABEL[r.kind]} · {fmtAt(r.at)} · trace <span className="mono">{r.traceId}</span>
        </p>
        <h3 className="section-title">Inputs</h3>
        <dl className="kv">
          {r.record.inputs.map(([k, v]) => (
            <div key={k} className="kv-row">
              <dt>{k}</dt>
              <dd className={v.startsWith("sha256") ? "mono" : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="section-title">AI output</h3>
        <ul className="plain">
          {r.record.aiOutput.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <h3 className="section-title">Solver options</h3>
        {r.record.solverOptions.length ? (
          <ul className="plain">
            {r.record.solverOptions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">None — no tables were proposed.</p>
        )}
        <h3 className="section-title">What was applied</h3>
        <p>{r.record.applied ?? "Nothing. The AI never books or seats; only a person can."}</p>
        <h3 className="section-title">Manager decision</h3>
        <p>
          <DecisionChip d={r.decision} />{" "}
          {"at" in r.decision && <span className="muted">{fmtAt(r.decision.at)}</span>}
        </p>
        <p className="muted">
          {usd(r.costUsd)} · {r.latencyMs ? duration(r.latencyMs) : "—"} · {r.model}
        </p>
      </div>
    </aside>
  );
}
