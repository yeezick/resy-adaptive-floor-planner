import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Thumb } from "./Thumb";
import {
  activityCounts,
  filterActivity,
  type ActivityFilter,
  type ActivityKind,
  type ActivityRow,
  type RowDecision,
} from "../../domain/activity";
import { duration, normalTimes, usd } from "../lib/format";
import { ProposedTag } from "../ProposedTag";
import { startRequests, useRequests } from "../requests/store";
import {
  DEMO_MANAGER,
  feedbackOf,
  filterByFeedback,
  type FeedbackFilter,
  type FeedbackRecord,
  type Rating,
} from "../../domain/feedback";
import { activityActions, useActivity, useFeedback, useFeedbackReasons } from "./store";
import { SOURCE_LABEL as REQUEST_SOURCE } from "../../domain/requests";
import { clock12, times12 } from "../../domain/time";
import { namesIn } from "../lib/names";

const KIND_LABEL: Record<ActivityKind, string> = {
  request: "Request triage",
  escalation: "Escalated to a person",
  "assistant-question": "AI Planner question",
  recommendation: "Recommendation",
  "assistant-answer": "AI Planner answer",
  refusal: "Refusal",
  "request-chat": "AI Planner chat",
};
const SOURCE_LABEL = { ...REQUEST_SOURCE, host: "Host" } as const;

const TYPES: { id: NonNullable<ActivityFilter["type"]>; label: string }[] = [
  { id: "request", label: "Request triage" },
  { id: "request-chat", label: "AI Planner chat" },
  { id: "junk", label: "Junk" },
  { id: "escalation", label: "Escalations" },
  { id: "recommendation", label: "Recommendations" },
  { id: "assistant-question", label: "Questions" },
  { id: "validator-reject", label: "Capacity check rejects" },
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

/** Who acted on a row, in order: the AI step, then Capacity check (if it rejected an option), then a person. */
export function actorsOf(r: ActivityRow): string[] {
  const out = [
    r.kind === "request" || (r.kind === "escalation" && r.source !== "host")
      ? "AI triage"
      : "AI Planner",
  ];
  if (r.kind === "request-chat" || (r.source === "host" && r.flags.includes("validator-reject")))
    out.push("Capacity check");
  if (r.flags.includes("override") || (r.decision.kind !== "pending" && r.decision.kind !== "none"))
    out.push("Manager");
  return out;
}

/** "Capacity check rejected 1 AI option" from the row's record. */
function rejectLine(r: ActivityRow): string {
  const m = r.record.aiOutput.map((x) => /rejected (\d+)/.exec(x)).find(Boolean);
  const n = m ? Number(m[1]) : 1;
  return r.source === "host"
    ? `Capacity check rejected ${n} AI option${n === 1 ? "" : "s"}`
    : `${n} AI triage answer${n === 1 ? "" : "s"} failed the format check and ${n === 1 ? "was" : "were"} retried`;
}

/** A row has AI output to rate (a failed call has none). */
function isAiOutput(r: ActivityRow): boolean {
  return (
    r.model !== "—" && !/^(Triage failed|AI Planner failed|AI Planner chat failed)/.test(r.what)
  );
}

export function fmtAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${clock12(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)}`;
}

export function DecisionChip({ d }: { d: RowDecision }) {
  switch (d.kind) {
    case "accepted":
      return <span className="verdict verdict-neutral">Accepted</span>;
    case "declined":
      return (
        <span
          className={`verdict ${d.reason === "policy" ? "verdict-policy" : d.reason === "fit" ? "verdict-fit" : "verdict-wait"}`}
        >
          Declined · {d.reason === "fit" ? "no capacity fit" : d.reason}
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
  const feedback = useFeedback();
  const [fbFilter, setFbFilter] = useState<FeedbackFilter | undefined>(undefined);
  // The row whose optional note box is open (after a thumb click).
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const shown = useMemo(
    () => filterByFeedback(filterActivity(rows, filter), feedback, DEMO_MANAGER, fbFilter),
    [rows, filter, feedback, fbFilter],
  );
  const counts = activityCounts(rows);
  const inbox = new Set((useRequests().book?.requests ?? []).map((r) => r.id));
  const pendingRows = rows.filter((r) => r.source !== "host" && r.decision.kind === "pending");
  const openNow = pendingRows.filter((r) => inbox.has(r.refId)).length;
  const olderPending = pendingRows.filter((r) => !inbox.has(r.refId)).length;
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
            Read-only, built from the triage, AI Planner and decision logs. Guest and host text is
            kept only as a hash — you see the AI's own summary.
          </p>
        </div>
        <div className="totals activity-counts" aria-label="This week">
          <Count label="Requests logged this week" value={counts.requests} />
          <Count label="Accepted" value={counts.accepted} />
          <Count label="Declined · no capacity fit" value={counts.declined.fit} />
          <Count label="Declined · policy" value={counts.declined.policy} />
          <Count label="Declined · other" value={counts.declined.other} />
          <Count label="Pending" value={counts.pending} />
          {counts.pending > 0 && (
            <p className="muted small totals-note">
              Pending = {openNow} open in Requests
              {olderPending > 0 ? ` + ${olderPending} from earlier this week` : ""}
            </p>
          )}
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
            <option value="fit">No capacity fit</option>
            <option value="policy">Policy</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field-inline">
          <span>Feedback</span>
          <select
            value={fbFilter ?? ""}
            onChange={(e) =>
              setFbFilter((e.target.value || undefined) as FeedbackFilter | undefined)
            }
          >
            <option value="">Any</option>
            <option value="up">👍 Helpful</option>
            <option value="down">👎 Not helpful</option>
            <option value="unrated">Unrated</option>
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
              <th scope="col">Actor</th>
              <th scope="col">Source</th>
              <th scope="col">Party · date</th>
              <th scope="col">What happened</th>
              <th scope="col">Manager decision</th>
              <th scope="col">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.id}>
                <tr className={open === r.id ? "is-open" : undefined} onClick={() => setOpen(r.id)}>
                  <td className="mono">{fmtAt(r.at)}</td>
                  <td className="actor">{actorsOf(r).join(" → ")}</td>
                  <td>{SOURCE_LABEL[r.source]}</td>
                  <td>
                    {r.partySize ? `${r.partySize}` : "—"}
                    {r.when ? ` · ${times12(r.when)}` : ""}
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
                      {normalTimes(times12(namesIn(r.what)))}
                      {r.flags.includes("validator-reject") && (
                        <span className="what-sub muted">{rejectLine(r)}</span>
                      )}
                    </button>
                  </td>
                  <td>
                    <DecisionChip d={r.decision} />
                  </td>
                  <td>
                    {isAiOutput(r) ? (
                      <FeedbackCell
                        fb={feedbackOf(feedback, r.id, DEMO_MANAGER)}
                        onRate={(rating) => {
                          activityActions.rate(r.id, rating);
                          setNoteFor(r.id);
                        }}
                      />
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
                {noteFor === r.id && (
                  <tr className="fb-note-row">
                    <td colSpan={7}>
                      <NoteBox rowId={r.id} onDone={() => setNoteFor(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
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

function FeedbackCell({
  fb,
  onRate,
}: {
  fb: FeedbackRecord | undefined;
  onRate: (r: Rating) => void;
}) {
  const thumb = (rating: Rating, icon: ReactNode, label: string) => (
    <button
      type="button"
      className={`fb-thumb${fb?.rating === rating ? " is-on" : ""}`}
      aria-pressed={fb?.rating === rating}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onRate(rating);
      }}
    >
      {icon}
    </button>
  );
  return (
    <span className="fb-cell">
      {thumb("up", <Thumb />, "Helpful")}
      {thumb("down", <Thumb down />, "Not helpful")}
      {fb && (
        <span className="fb-rated small" title="Saved to this log only (prototype)">
          rated
          {fb.notes.length ? ` · ${fb.notes.length} note${fb.notes.length === 1 ? "" : "s"}` : ""}
        </span>
      )}
    </span>
  );
}

/** Optional note after a thumb: appended to the same feedback entry, kept as a hash + length only. */
function NoteBox({ rowId, onDone }: { rowId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="fb-note"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        void activityActions.note(rowId, text);
        onDone();
      }}
    >
      <label className="small" htmlFor={`fb-note-${rowId}`}>
        Add a note (optional) — kept as a fingerprint in this prototype
      </label>
      <input
        id={`fb-note-${rowId}`}
        type="text"
        maxLength={300}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" disabled={!text.trim()}>
        Add note
      </button>
      <button type="button" className="link-btn" onClick={onDone}>
        Skip
      </button>
      <span className="muted small fb-ack">Rating saved to this log only (prototype).</span>
    </form>
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
  const down = feedbackOf(useFeedback(), r.id, DEMO_MANAGER)?.rating === "down";
  const allReasons = useFeedbackReasons()[r.id] ?? [];
  const reasons = down ? allReasons : [];
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
              <dd title={v.startsWith("sha256") ? v : undefined}>
                {v.startsWith("sha256 not-sent")
                  ? "Guest message not stored (privacy)"
                  : v.startsWith("sha256")
                    ? "Not stored (privacy): fingerprint only"
                    : times12(k === "Request" ? namesIn(v) : v)}
              </dd>
            </div>
          ))}
        </dl>
        <h3 className="section-title">AI output</h3>
        <ul className="plain">
          {r.record.aiOutput.map((x) => (
            <li key={x}>
              {times12(
                x.replace(
                  /^Validator rejected (\d+) answer\(s\) first$/,
                  (_m, n: string) =>
                    `Capacity check rejected ${n} AI option${n === "1" ? "" : "s"} first`,
                ),
              )}
            </li>
          ))}
        </ul>
        <h3 className="section-title">Capacity check</h3>
        {r.record.solverOptions.length ? (
          <ul className="plain">
            {r.record.solverOptions.map((x) => (
              <li key={x}>{times12(x)}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">None — no tables were proposed.</p>
        )}
        <h3 className="section-title">What was applied</h3>
        <p>
          {r.record.applied
            ? times12(r.record.applied)
            : "Nothing. The AI never books or seats; only a person can."}
        </p>
        <h3 className="section-title">Manager decision</h3>
        <p>
          <DecisionChip d={r.decision} />{" "}
          {"at" in r.decision && <span className="muted">{fmtAt(r.decision.at)}</span>}
        </p>
        {reasons.length > 0 && (
          <>
            <h3 className="section-title">Why not helpful</h3>
            <p>{reasons.join(" · ")}</p>
          </>
        )}
        <h3 className="section-title">Cost and latency</h3>
        <p className="muted">
          {usd(r.costUsd)} · {r.latencyMs ? duration(r.latencyMs) : "—"} · {r.model}
        </p>
      </div>
    </aside>
  );
}
