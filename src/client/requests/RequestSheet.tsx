import { useEffect, useMemo, useState } from "react";
import { partyFits, type Room } from "../../domain";
import { PartyFitCard } from "../Fit/PartyFitCard";
import {
  checkRequest,
  draftReply,
  SERVICE,
  toReservation,
  type GuestRequest,
} from "../../domain/requests";
import { fetchRoom } from "../api";
import { duration, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import {
  decisionOf,
  requestsActions,
  useRequests,
  type DeclineReason,
  type TriageState,
} from "./store";

export const SOURCE_LABEL: Record<GuestRequest["source"], string> = {
  "guest-form": "Web form",
  "ai-agent": "AI agent",
};

export function ProposedTag() {
  return <span className="proposed-tag">Proposed feature</span>;
}

export function VerdictChip({ t }: { t: TriageState | undefined }) {
  if (!t || t.status === "loading") return <span className="verdict verdict-wait">Triaging…</span>;
  if (t.status === "error") return <span className="verdict verdict-unsure">Needs a person</span>;
  const v = t.result.escalated ? "unsure" : t.result.verdict;
  const label = v === "real" ? "Real" : v === "junk" ? "Likely junk" : "Needs a person";
  return <span className={`verdict verdict-${v}`}>{label}</span>;
}

const loadRoom = (id: string) => fetchRoom(id);

const DECLINE: { id: DeclineReason; label: string; hint: string }[] = [
  { id: "fit", label: "Fit", hint: "we can't seat them that night" },
  { id: "policy", label: "Policy", hint: "minimums, buyouts, house rules, junk" },
  { id: "other", label: "Other", hint: "anything else" },
];

/** One request: the AI triage, the solver's fit check and the manager's actions. Nothing accepts by itself. */
export function RequestSheet({
  request: r,
  roomId,
}: {
  request: GuestRequest;
  /** The night on screen; when it isn't this request's night, offer to switch. */
  roomId: string;
}) {
  const s = useRequests();
  const t = s.triage[r.id];
  const decision = decisionOf(s, r.id);
  const roomRes = useAsync(r.bookRoomId, loadRoom);
  const [mode, setMode] = useState<"none" | "decline" | "reply">("none");
  const [reason, setReason] = useState<DeclineReason>("fit");

  // The night's book, plus parties the manager already accepted for it (other than this one).
  const room: Room | null = useMemo(() => {
    if (!roomRes?.ok) return null;
    const extra = (s.accepted[r.bookRoomId] ?? []).filter((x) => x.id !== r.id);
    return { ...roomRes.data, reservations: [...roomRes.data.reservations, ...extra] };
  }, [roomRes, s.accepted, r.bookRoomId, r.id]);
  const fit = useMemo(() => (room ? checkRequest(room, r) : null), [room, r]);
  const draft = useMemo(() => (fit ? draftReply(r, fit) : ""), [fit, r]);
  const cost = useMemo(() => {
    if (!room || !fit?.ok) return null;
    const withR = { ...room, reservations: [...room.reservations, toReservation(r)] };
    return (
      partyFits(withR, fit.plan.builds, SERVICE.from, {
        privateOnly: r.privateRoom ? [r.id] : [],
      }).find((f) => f.reservationId === r.id) ?? null
    );
  }, [room, fit, r]);
  const [reply, setReply] = useState<string | null>(null);
  useEffect(() => {
    if (!fit) return;
    requestsActions.noteFit(
      r.id,
      fit.ok
        ? [
            `Fits: ${fit.build.tables.join(" + ")} · ${fit.build.area} · seats ${fit.build.seats}, build by ${fit.build.buildBy}`,
            ...(cost
              ? [
                  `Hold from ${cost.hold.from} · ~${cost.hold.coversLost} covers lost`,
                  `Section ${cost.sections.join(" + ")}${cost.spansSections ? " (spans two)" : ""}`,
                  `Aisle: ${cost.aisle.checked.length} joins ${cost.aisle.ok ? "clear" : "fail"}`,
                  ...cost.aisle.rejected.map((x) => `Rejected ${x.reason}`),
                ]
              : []),
          ]
        : [`Can't fit: ${fit.reason}`],
      fit.ok ? fit.build.tables : [],
    );
  }, [fit, cost, r.id]);
  const junk = t?.status === "ok" && t.result.verdict === "junk" && !t.result.escalated;

  return (
    <div className="request-sheet">
      <div className="req-head">
        <div>
          <div className="req-title">
            Party of {r.partySize} · {r.day} {r.time}
          </div>
          <div className="muted small">
            {SOURCE_LABEL[r.source]} · received {r.receivedAt}
            {r.occasion ? ` · ${r.occasion}` : ""}
          </div>
        </div>
        <ProposedTag />
      </div>

      <section className="req-block" aria-label="AI triage">
        <div className="req-block-head">
          <h3 className="section-title">AI triage</h3>
          <VerdictChip t={t} />
        </div>
        {t?.status === "ok" && (
          <>
            <ul className="req-summary">
              {t.result.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="small">
              <span className="muted">Why: </span>
              {t.result.reason}
            </p>
            <div className="metrics small" aria-label="Triage cost and latency">
              <span>
                {usd(t.result.metrics.costUsd)}
                {t.result.cached ? " (cached view, no new call)" : ""}
              </span>
              <span>{duration(t.result.metrics.latencyMs)}</span>
              <span>{t.result.model}</span>
              <span>{t.result.promptVersion}</span>
              {t.result.validatorRejects > 0 && (
                <span>{t.result.validatorRejects} validator reject(s)</span>
              )}
            </div>
          </>
        )}
        {t?.status === "error" && (
          <div className="small">
            <p className="warn-text">AI triage unavailable: {t.error.message}</p>
            <p className="muted">Read the request below and decide yourself.</p>
            <button type="button" onClick={() => requestsActions.retryTriage(r)}>
              Retry triage
            </button>
          </div>
        )}
        <details className="small req-message">
          <summary>Guest's message</summary>
          <p>{r.message}</p>
          <p className="muted">
            Shown here only. The activity log keeps the AI's summary, never the guest's words.
          </p>
        </details>
      </section>

      <section className="req-block" aria-label="Fit check">
        <div className="req-block-head">
          <h3 className="section-title">Fit check · {r.day}</h3>
          {fit && (
            <span className={`verdict ${fit.ok ? "verdict-real" : "verdict-unsure"}`}>
              {fit.ok ? "Fits" : "Can't fit"}
            </span>
          )}
        </div>
        {!roomRes && <p className="muted small">Loading {r.day}'s book…</p>}
        {roomRes && !roomRes.ok && <p className="warn-text small">{roomRes.error.message}</p>}
        {fit?.ok && roomId !== r.bookRoomId && (
          <button
            type="button"
            className="link-btn small"
            onClick={() => requestsActions.viewNight(r)}
          >
            Show on {r.day}'s floor →
          </button>
        )}
        {fit?.ok && (
          <div className="small">
            <p>
              <strong>{fit.build.tables.join(" + ")}</strong> · {fit.build.area} · seats{" "}
              {fit.build.seats} for {fit.build.partySize}, build by {fit.build.buildBy}
            </p>
            <p className="muted">
              {[
                fit.build.extenders && `${fit.build.extenders} extender(s)`,
                fit.build.spareTables && `${fit.build.spareTables} spare table(s)`,
                fit.build.extraChairs && `${fit.build.extraChairs} chair(s)`,
              ]
                .filter(Boolean)
                .join(", ") || "No storage needed"}
              . Every booking already on {r.day} keeps its seats.
            </p>
            {cost && (
              <ul className="fit-list">
                <PartyFitCard f={cost} title="Cost of saying yes" />
              </ul>
            )}
          </div>
        )}
        {fit && !fit.ok && <p className="small cant-fit-line">{fit.reason}</p>}
        <p className="muted small">From the planner, not the AI: the AI never picks tables.</p>
      </section>

      {decision.kind === "pending" ? (
        <div className="req-actions">
          <div className="btn-row">
            <button
              type="button"
              className="primary"
              disabled={!fit?.ok || junk}
              title={junk ? "Triaged as junk" : !fit?.ok ? "It doesn't fit that night" : undefined}
              onClick={() => fit?.ok && requestsActions.accept(r, fit.build.tables)}
            >
              Accept → open {r.day}'s plan
            </button>
            <button
              type="button"
              aria-expanded={mode === "decline"}
              onClick={() => {
                setReason(junk ? "policy" : "fit");
                setMode(mode === "decline" ? "none" : "decline");
              }}
            >
              Decline
            </button>
            <button
              type="button"
              aria-expanded={mode === "reply"}
              disabled={junk}
              onClick={() => setMode(mode === "reply" ? "none" : "reply")}
            >
              Reply
            </button>
          </div>
          {mode === "decline" && (
            <fieldset className="decline">
              <legend className="small">Why decline? (logged — the sprint's key metric)</legend>
              {DECLINE.map((d) => (
                <label key={d.id} className="radio">
                  <input
                    type="radio"
                    name={`decline-${r.id}`}
                    checked={reason === d.id}
                    onChange={() => setReason(d.id)}
                  />
                  <span>
                    <strong>{d.label}</strong> <span className="muted">— {d.hint}</span>
                  </span>
                </label>
              ))}
              <button type="button" onClick={() => requestsActions.decline(r, reason)}>
                Decline for {reason}
              </button>
            </fieldset>
          )}
          {mode === "reply" && (
            <div className="reply">
              <label className="small" htmlFor={`reply-${r.id}`}>
                Draft reply — edit before sending. Drafted from the fit check; it never promises a
                booking.
              </label>
              <textarea
                id={`reply-${r.id}`}
                rows={6}
                value={reply ?? draft}
                onChange={(e) => setReply(e.target.value)}
              />
              <button
                type="button"
                onClick={() => requestsActions.reply(r, reply !== null && reply !== draft)}
              >
                Mark as sent
              </button>
              <p className="muted small">Prototype: nothing is sent to anyone.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="req-decided small" role="status">
          <strong>
            {decision.kind === "accepted"
              ? `Accepted ${decision.at} · ${decision.tables.join(" + ")}`
              : decision.kind === "declined"
                ? `Declined for ${decision.reason} · ${decision.at}`
                : `Replied ${decision.at}${decision.edited ? " · draft edited" : ""}`}
          </strong>
          <button type="button" className="link-btn" onClick={() => requestsActions.reopen(r)}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
