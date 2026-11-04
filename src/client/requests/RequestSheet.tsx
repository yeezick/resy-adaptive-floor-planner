import { useEffect, useMemo, useState } from "react";
import {
  clock12,
  crewNote,
  times12,
  joinReadiness,
  partyFits,
  readinessChip,
  readinessTarget,
  tableReady,
  readinessPill,
  tableNo,
  tablesPhrase,
  toMinutes,
  type Room,
} from "../../domain";
import { ImpactsCard } from "../Fit/ImpactsCard";
import {
  checkRequest,
  draftReply,
  needsOverview,
  requestHeader,
  SERVICE,
  SOURCE_LABEL,
  toReservation,
  type GuestRequest,
} from "../../domain/requests";
import { fetchRoom } from "../api";
import { duration, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useElapsedMinutes } from "../lib/useDemoClock";
import { checkAdjusted } from "../../domain/requestChat";
import { RequestChat } from "./RequestChat";
import {
  decisionOf,
  requestsActions,
  useRequests,
  type DeclineReason,
  type TriageState,
} from "./store";

export { SOURCE_LABEL, SOURCE_SHORT } from "../../domain/requests";

export function ProposedTag() {
  return <span className="proposed-tag">Proposed feature</span>;
}

export function VerdictChip({ t }: { t: TriageState | undefined }) {
  if (!t || t.status === "loading") return <span className="verdict verdict-wait">Triaging…</span>;
  if (t.status === "host") return <span className="verdict verdict-real">At the stand</span>;
  if (t.status === "error") return <span className="verdict verdict-unsure">Needs a person</span>;
  const v = t.result.escalated ? "unsure" : t.result.verdict;
  const label = v === "real" ? "Real" : v === "junk" ? "Likely junk" : "Needs a person";
  return <span className={`verdict verdict-${v}`}>{label}</span>;
}

const loadRoom = (id: string) => fetchRoom(id);

const DECLINE: { id: DeclineReason; label: string; hint: string }[] = [
  { id: "fit", label: "Capacity fit", hint: "we can't seat them that night" },
  { id: "policy", label: "Policy", hint: "minimums, buyouts, house rules, junk" },
  { id: "other", label: "Other", hint: "anything else" },
];

/** One request: the AI triage, the solver's capacity fit and the manager's actions. Nothing accepts by itself. */
export function RequestSheet({
  request: guest,
  roomId,
}: {
  request: GuestRequest;
  /** The night on screen; when it isn't this request's night, offer to switch. */
  roomId: string;
}) {
  const s = useRequests();
  const r0 = guest;
  const t = s.triage[r0.id];
  const decision = decisionOf(s, r0.id);
  const roomRes = useAsync(r0.bookRoomId, loadRoom);
  const [mode, setMode] = useState<"none" | "decline" | "reply">("none");
  const [reason, setReason] = useState<DeclineReason>("fit");

  // The night's book, plus parties the manager already accepted for it (other than this one).
  const room: Room | null = useMemo(() => {
    if (!roomRes?.ok) return null;
    const extra = (s.accepted[r0.bookRoomId] ?? []).filter((x) => x.id !== r0.id);
    return { ...roomRes.data, reservations: [...roomRes.data.reservations, ...extra] };
  }, [roomRes, s.accepted, r0.bookRoomId, r0.id]);
  // The manager's changes (in-request chat or the controls): the planner re-runs for the adjusted party.
  const constraints = s.adjust[r0.id];
  const adj = useMemo(
    () => (room && constraints ? checkAdjusted(room, r0, constraints) : null),
    [room, r0, constraints],
  );
  const r = adj?.request ?? r0;
  const fit = useMemo(() => adj?.fit ?? (room ? checkRequest(room, r0) : null), [adj, room, r0]);
  const elapsed = useElapsedMinutes();
  const minutesAway = roomRes?.ok
    ? toMinutes(r.time) - toMinutes(roomRes.data.clock) - elapsed
    : null;
  const draft = useMemo(() => (fit ? times12(draftReply(r, fit)) : ""), [fit, r]);
  const cost = useMemo(() => {
    if (!room || !fit?.ok) return null;
    const withR = { ...room, reservations: [...room.reservations, toReservation(r)] };
    return (
      partyFits(withR, fit.plan.builds, SERVICE.from, {
        privateOnly: r.privateRoom ? [r.id] : [],
      }).find((f) => f.reservationId === r.id) ?? null
    );
  }, [room, fit, r]);
  // A future request is projected to its hold start; a request for now shows live minutes.
  const readyAt = room && cost ? readinessTarget(r.time, room.clock, cost.hold.from) : null;
  const ready = useMemo(
    () => (room && fit?.ok ? joinReadiness(room, fit.build.tables, readyAt) : null),
    [room, fit, readyAt],
  );
  const [reply, setReply] = useState<string | null>(null);
  useEffect(() => {
    if (!fit) return;
    requestsActions.noteFit(
      r.id,
      fit.ok
        ? [
            `Capacity fit: ${tablesPhrase(fit.build.tables)} · ${fit.build.area} · seats ${fit.build.seats}, build by ${fit.build.buildBy}`,
            ...(cost
              ? [
                  `Hold from ${cost.hold.from} · ~${cost.hold.coversLost} covers lost (est.)`,
                  `Section ${cost.sections.join(" + ")}${cost.spansSections ? " (spans two)" : ""}`,
                  `Aisle: ${cost.aisle.checked.length} joins ${cost.aisle.ok ? "clear" : "fail"}`,
                  ...cost.aisle.rejected.map((x) => `Rejected ${x.reason}`),
                ]
              : []),
          ]
        : [`No capacity fit: ${fit.reason}`],
      fit.ok ? fit.build.tables : [],
      readyAt,
    );
  }, [fit, cost, r.id, readyAt]);
  const junk = t?.status === "ok" && t.result.verdict === "junk" && !t.result.escalated;
  const overview = t?.status === "ok" ? t.result.summary : [needsOverview(r)];

  return (
    <div className="request-sheet">
      <div className="req-head">
        <div>
          <h2 className="req-title" title={`Countdown from ${r.day}'s clock`}>
            {times12(requestHeader(r, minutesAway))}
          </h2>
          <ul className="req-overview" aria-label="What the party needs">
            {overview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="muted small">
            <span className={`source-label source-${r.source}`}>{SOURCE_LABEL[r.source]}</span> ·
            received {times12(r.receivedAt)}
          </div>
        </div>
        <ProposedTag />
      </div>

      <section className="req-block" aria-label="AI triage">
        <div className="req-block-head">
          <h3 className="section-title">AI triage</h3>
          <VerdictChip t={t} />
        </div>
        {t?.status === "host" && (
          <p className="muted small">
            Taken at the host stand, so no AI triage: the host is talking to the guest.
          </p>
        )}
        {t?.status === "ok" && (
          <>
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
          <summary>{r.source === "walk-in" ? "Host's note" : "Guest's message"}</summary>
          <p>{r.message}</p>
          <p className="muted">
            Shown here only. The activity log keeps the AI's summary, never the guest's words.
          </p>
        </details>
      </section>

      <section className="req-block" aria-label="Capacity fit">
        <div className="req-block-head">
          <h3 className="section-title">Capacity fit · {r.day}</h3>
          {fit && (
            <span
              className={`verdict ${fit.ok ? "verdict-real" : "verdict-unsure"} fit-pill`}
              title={fit.ok ? "Ready time is estimated from each table's meal phase" : undefined}
            >
              {fit.ok && ready
                ? readinessPill(ready)
                : fit.ok
                  ? "capacity fit ✓"
                  : "No capacity fit"}
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
            <p className="crew-note">
              {crewNote(fit.build)}
              {constraints?.notes.length ? ` Also: ${constraints.notes.join(", ")}.` : ""}
            </p>
            <p className="muted">
              {fit.build.area} · seats {fit.build.seats} for {fit.build.partySize}, build by{" "}
              {clock12(fit.build.buildBy)}. Every booking already on {r.day} still has a table.
            </p>
            {ready && ready.tables.length > 0 && (
              <ul className="ready-list" aria-label="Tables in the join, and when each is free">
                {ready.tables.map((t) => {
                  const b = readinessChip(t, ready);
                  return (
                    <li key={t.id}>
                      <span className="ready-no">{tableNo(t.id)}</span>
                      <span className="muted">
                        {t.phase ?? (t.status === "reserved" ? "open, held later" : t.status)}
                      </span>
                      <span className={`ready-chip ${tableReady(t, ready) ? "is-now" : "is-wait"}`}>
                        {b}
                      </span>
                    </li>
                  );
                })}
                {!ready.ready && (
                  <li className="muted ready-key">
                    {ready.at === null
                      ? "~Xm = until free (est.)"
                      : `projected to the hold start, ${clock12(ready.at)}; est. from meal phase`}
                  </li>
                )}
              </ul>
            )}
            {cost && room && (
              <ImpactsCard
                room={room}
                f={cost}
                build={fit.build}
                needs={r.needs}
                moved={fit.moved}
              />
            )}
          </div>
        )}
        {fit && !fit.ok && (
          <p className="small cant-fit-line">{times12(adj ? adj.line : fit.reason)}</p>
        )}
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
              Accept
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
              Message guest
            </button>
            <button
              type="button"
              className="ask-ai"
              title="Discuss this request with the AI Planner"
              disabled={!room}
              onClick={() => {
                const box = document.getElementById(`chat-${r0.id}`);
                box?.scrollIntoView({ block: "center", behavior: "smooth" });
                box?.focus({ preventScroll: true });
              }}
            >
              <Sparkle /> Discuss
            </button>
          </div>
          <p className="muted small">Accept opens {r.day}'s plan with the party in it.</p>
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
                Decline for {reason === "fit" ? "capacity fit" : reason}
              </button>
            </fieldset>
          )}
          {mode === "reply" && (
            <div className="reply">
              <label className="small" htmlFor={`reply-${r.id}`}>
                Draft reply — edit before sending. Drafted from the capacity fit; it never promises
                a booking.
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
      ) : null}
      {decision.kind === "pending" && room && <RequestChat request={r0} result={adj} />}
      {decision.kind !== "pending" && (
        <div className="req-decided small" role="status">
          <strong>
            {decision.kind === "accepted"
              ? `Accepted ${times12(decision.at)} · ${tablesPhrase(decision.tables)}`
              : decision.kind === "declined"
                ? `Declined for ${decision.reason === "fit" ? "capacity fit" : decision.reason} · ${times12(decision.at)}`
                : `Replied ${times12(decision.at)}${decision.edited ? " · draft edited" : ""}`}
          </strong>
          <button type="button" className="link-btn" onClick={() => requestsActions.reopen(r)}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/** The AI affordance: a four-point sparkle in the accent colour (decorative; the button says "Discuss"). */
function Sparkle() {
  return (
    <svg className="sparkle" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.5c.4 2.9 1.7 4.2 4.6 4.6-2.9.4-4.2 1.7-4.6 4.6-.4-2.9-1.7-4.2-4.6-4.6 2.9-.4 4.2-1.7 4.6-4.6Z" />
      <path d="M12.6 10.2c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" />
    </svg>
  );
}
