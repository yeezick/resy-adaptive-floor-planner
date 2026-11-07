import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  clock12,
  times12,
  impactsOf,
  joinReadiness,
  partyFits,
  readinessTarget,
  readinessPill,
  tablesPhrase,
  planBuilds,
  toHHMM,
  toMinutes,
  type Room,
} from "../../domain";
import { CoversSummary } from "../Fit/ImpactsCard";
import {
  checkRequest,
  draftReply,
  needsOverview,
  requestVia,
  requestWhen,
  SERVICE,
  toReservation,
  type GuestRequest,
} from "../../domain/requests";
import { fetchRoom } from "../api";
import { duration, normalTimes, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import {
  baseConstraints,
  changeList,
  checkAdjusted,
  type AdjustedFit,
  type ChatConstraints,
} from "../../domain/requestChat";
import {
  bookedVsWalkIns,
  coverTrade,
  crewFootnote,
  listAnd,
  planLine,
  takeItLine,
} from "../../domain/wording";
import { keepAboveFooter, RequestChat } from "./RequestChat";
import { capacityCheckText } from "./chatReply";
import { editImpact, type EditImpact } from "../../domain/floorEdit";
import { layoutsStore } from "../layouts/useLayouts";
import { SourceFeedback } from "../activity/SourceFeedback";
import { RequestReview } from "../Review/RequestReview";
import {
  currentRequest,
  decisionOf,
  requestsActions,
  useRequests,
  type DeclineReason,
  type FloorProposal,
  type TriageState,
} from "./store";
import { partyName } from "../lib/names";
import "./request15.css";
import { MAX_NOTE_CHARS } from "../../domain/activity";

export { SOURCE_LABEL, SOURCE_SHORT } from "../../domain/requests";

export { ProposedTag } from "../ProposedTag";

/** The triage verdict as the manager reads it; a manager override wins over the AI's verdict. */
export function verdictOf(
  t: TriageState | undefined,
  override?: { verdict: "real" | "junk" },
): "real" | "junk" | "unsure" | null {
  if (override) return override.verdict;
  if (!t || t.status !== "ok") return null;
  return t.result.escalated ? "unsure" : t.result.verdict;
}

export function VerdictChip({
  t,
  override,
}: {
  t: TriageState | undefined;
  override?: { verdict: "real" | "junk" };
}) {
  if (!override) {
    if (!t || t.status === "loading")
      return <span className="verdict verdict-wait">Triaging…</span>;
    if (t.status === "host") return <span className="verdict verdict-neutral">At the stand</span>;
    if (t.status === "error") return <span className="verdict verdict-unsure">Needs a person</span>;
  }
  const v = verdictOf(t, override) ?? "unsure";
  const label =
    v === "real"
      ? override
        ? "Real (manager)"
        : "Looks real"
      : v === "junk"
        ? override
          ? "Junk (manager)"
          : "Likely junk"
        : "Needs a person";
  return (
    <span className={`verdict ${v === "real" ? "verdict-neutral" : `verdict-${v}`}`}>{label}</span>
  );
}

const loadRoom = (id: string) => fetchRoom(id);

const DECLINE: { id: DeclineReason; label: string; hint: string }[] = [
  { id: "fit", label: "No capacity fit", hint: "we can't seat them that night" },
  { id: "policy", label: "Policy", hint: "minimums, buyouts, house rules, junk" },
  { id: "other", label: "Other", hint: "anything else" },
];

/** One request: the AI triage, the solver's capacity fit and the manager's actions. Nothing accepts by itself. */
export function RequestSheet({
  request: guest,
  roomId,
  now = null,
}: {
  request: GuestRequest;
  /** The night on screen; when it isn't this request's night, offer to switch. */
  roomId: string;
  /** The console's night: its weekday and floor clock ("now" for the relative time). */
  now?: { day: string; clock: string } | null;
}) {
  const s = useRequests();
  const r0 = guest;
  const t = s.triage[r0.id];
  const decision = decisionOf(s, r0.id);
  const roomRes = useAsync(r0.bookRoomId, loadRoom);
  const [mode, setMode] = useState<"none" | "decline" | "reply">("none");
  const [reason, setReason] = useState<DeclineReason | null>(null);
  // the manager's own note on a decline (optional); it can also go into the draft reply
  const [note, setNote] = useState("");

  // The request's night as it stands: its layout in use (a one-day layout when one exists, else the book room),
  // with the night's book plus parties the manager already accepted for it (other than this one).
  const book = roomRes?.ok ? roomRes.data : null;
  const inUse = useSyncExternalStore(layoutsStore.subscribe, () =>
    book ? layoutsStore.active(book).room : null,
  );
  const room: Room | null = useMemo(() => {
    if (!book || !inUse) return null;
    const extra = (s.accepted[r0.bookRoomId] ?? []).filter((x) => x.id !== r0.id);
    return { ...inUse, reservations: [...book.reservations, ...extra] };
  }, [book, inUse, s.accepted, r0.bookRoomId, r0.id]);
  // The manager's changes (in-request chat or the controls): the planner re-runs for the adjusted party.
  const constraints = s.adjust[r0.id];
  const adj = useMemo(
    () => (room && constraints ? checkAdjusted(room, r0, constraints) : null),
    [room, r0, constraints],
  );
  const r = adj?.request ?? r0;
  // A change the chat proposed: shown as a diff, applied only when the manager presses Apply.
  const proposal = s.proposals[r0.id];
  const proposedAdj = useMemo(
    () =>
      room && proposal
        ? checkAdjusted(
            proposal.floor ? { ...proposal.floor.edited, reservations: room.reservations } : room,
            r0,
            proposal.constraints,
          )
        : null,
    [room, r0, proposal],
  );
  // a floor change: the request re-planned on the edited floor, and every booking whose tables change
  const floorImpact = useMemo(
    () =>
      room && proposal?.floor
        ? editImpact(
            room,
            { ...proposal.floor.edited, reservations: room.reservations },
            r0,
            proposal.constraints,
            partyName,
          )
        : null,
    [room, r0, proposal],
  );
  const floorDone = s.floorApplied[r0.id];
  const original = useMemo(() => (room ? checkRequest(room, r0) : null), [room, r0]);
  const changedBy = s.changedBy[r0.id];
  const fit = useMemo(() => adj?.fit ?? (room ? checkRequest(room, r0) : null), [adj, room, r0]);
  // the reply promises only an answer time: one hour after the floor clock of the request's night
  const confirmMin = roomRes?.ok ? toMinutes(roomRes.data.clock) + 60 : null;
  const confirmBy = confirmMin !== null && confirmMin < 24 * 60 ? toHHMM(confirmMin) : undefined;
  const draft = useMemo(
    () => (fit ? times12(draftReply(r, fit, confirmBy)) : ""),
    [fit, r, confirmBy],
  );
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
  // Accept opens "Review and confirm" first; its one button holds the tables and applies the crew plan
  const [reviewing, setReviewing] = useState(false);
  // what a proposed chat change would do to covers and the hold (before → after, in the diff)
  const impactOf = (req: GuestRequest, f: typeof fit) => {
    if (!room || !f?.ok) return null;
    const withR = { ...room, reservations: [...room.reservations, toReservation(req)] };
    const pf = partyFits(withR, f.plan.builds, SERVICE.from, {
      privateOnly: req.privateRoom ? [req.id] : [],
    }).find((x) => x.reservationId === req.id);
    if (!pf) return null;
    const trade = coverTrade(pf.partySize, pf.hold.coversLost);
    return `${bookedVsWalkIns(trade)}${pf.hold.tables.length ? ` · held ${times12(`${pf.hold.from}–${pf.hold.until}`)}` : ""}`;
  };
  // The chat about this request: closed until Discuss (or until it has turns, e.g. a reopened request).
  const [chatOpen, setChatOpen] = useState(() => (s.chat[r0.id]?.length ?? 0) > 0);
  // Large parties already planned for the night whose tables change, named, with from → to tables.
  const movedDetail = useMemo(
    () => (room && fit?.ok && fit.moved.length ? movedLines(room, r, fit.plan, fit.moved) : []),
    [room, r, fit],
  );
  useEffect(() => {
    if (!fit) return;
    requestsActions.noteFit(
      r.id,
      fit.ok
        ? [
            `Capacity fit: ${tablesPhrase(fit.build.tables)} · ${fit.build.area} · seats ${fit.build.seats}, build by ${fit.build.buildBy}`,
            ...(cost
              ? [
                  `Hold from ${cost.hold.from} · walk-in capacity held: up to ~${cost.hold.coversLost} (est.)`,
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
  const override = s.overrides[r0.id];
  const verdict = verdictOf(t, override);
  const junk = verdict === "junk";
  const overview = t?.status === "ok" ? t.result.summary : [needsOverview(r)];

  const [focusChat, setFocusChat] = useState(0);
  const discuss = () => {
    setChatOpen(true);
    setFocusChat((n) => n + 1);
  };
  // once the chat is open (rendered), focus its box without moving the window
  useEffect(() => {
    if (!focusChat || !chatOpen) return;
    const box = document.getElementById(`chat-${r0.id}`);
    box?.scrollIntoView({ block: "nearest" });
    box?.focus({ preventScroll: true });
    // the sheet's footer is sticky: "nearest" can leave the box under it
    keepAboveFooter(box);
  }, [focusChat, chatOpen, r0.id]);
  const holdFrom = cost?.hold.tables.length ? cost.hold.from : null;
  const sent = s.replies[r0.id];
  // Decline: bring the reasons into view and onto the first one, so the choice is never below the fold
  const declineRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (mode !== "decline") return;
    const el = declineRef.current;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.querySelector("input")?.focus({ preventScroll: true });
  }, [mode]);
  const declineLabel =
    reason === null
      ? "Pick a reason to decline"
      : `Decline: ${reason === "fit" ? "no capacity fit" : reason}`;

  // the one request card: summary, needs, the rule's recommendation; Plan, pros/cons and covers behind More
  const [more, setMore] = useState(false);
  // opening More brings its first lines into view (the card sits above the footer)
  useEffect(() => {
    if (more) document.getElementById(`more-${r0.id}`)?.scrollIntoView({ block: "nearest" });
  }, [more, r0.id]);
  const summary = overview[0] ?? needsOverview(r);
  const needsText = t?.status === "ok" ? (t.result.summary[1] ?? null) : null;
  const hasNeeds = r.needs.length > 0;
  const access = r.needs.includes("accessible") || r.needs.includes("stroller");
  const takeIt =
    fit?.ok && cost
      ? takeItLine(coverTrade(cost.partySize, cost.hold.coversLost), { fit: true, cancelled: 0 })
      : null;
  const impacts = useMemo(
    () =>
      room && cost && fit?.ok
        ? impactsOf(room, {
            fit: cost,
            needs: r.needs,
            // a party the re-plan left on the same tables didn't move
            moved: movedDetail.length ? fit.moved : [],
            movedDetail,
          })
        : null,
    [room, cost, fit, r.needs, movedDetail],
  );

  const fitPill = fit ? (
    <span
      className={`verdict ${fit.ok ? "verdict-real" : "verdict-unsure"} fit-pill`}
      title={fit.ok ? "Ready time is estimated from each table's meal phase" : undefined}
    >
      {fit.ok && ready ? readinessPill(ready) : fit.ok ? "capacity fit ✓" : "no capacity fit"}
    </span>
  ) : null;

  if (reviewing && room && decision.kind === "pending")
    return (
      <div className="request-sheet decision">
        <RequestReview
          request={r0}
          room={room}
          now={now}
          fromRequest={overview.map((l) => normalTimes(l))}
          impact={impactOf(r, fit)}
          onBack={() => setReviewing(false)}
          onAccept={(tables) => requestsActions.accept(currentRequest(s, r0), tables)}
        />
      </div>
    );

  return (
    <div className="request-sheet decision">
      <div className="req-head">
        <h2 className="req-title">
          {r.contact} · party of {r.partySize} · {requestWhen(r, now)}
        </h2>
      </div>

      <section className="req-block req-card ai-card" aria-label="Request">
        <div className="field req-via small">
          {/* the triage verdict rides on the label line, so the value line keeps the full width */}
          <span className="req-via-head">
            <span className="field-label muted">Request</span>
            <VerdictChip t={t} override={override} />
          </span>
          {/* who and through what, then when it arrived */}
          <span className="req-via-line">
            <span className="field-value">{requestVia(r)}</span>
            <span className="muted"> · received {times12(r.receivedAt)}</span>
          </span>
        </div>
        <ul className="req-overview" aria-label="What the party needs">
          <li>{normalTimes(summary)}</li>
        </ul>
        {t?.status === "host" && (
          <p className="muted small">
            Taken at the host stand, so no AI triage: the host is talking to the guest.
          </p>
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
        {needsText && (
          <div className="field req-needs">
            <span className="field-label muted">{hasNeeds ? "Needs" : "Notes"}</span>
            <span className="field-value">
              {access && <AccessIcon />}
              {normalTimes(needsText)}
            </span>
          </div>
        )}
        <div className="field req-message">
          <span className="field-label muted">
            {r.source === "walk-in" ? "Host's note" : "Guest message"}
          </span>
          <q className="field-value">{r.message}</q>
        </div>

        <div className={`req-decision${takeIt ? " field" : ""}`}>
          {/* the fixed rule (fit ✓ and cancelled = 0), never model text, with the one capacity-fit pill beside it */}
          {takeIt ? (
            <>
              <span className="field-label muted">Recommendation</span>
              <p className="take-it field-value" role="note">
                <span className="take-it-text">{takeIt}</span> {fitPill}
              </p>
            </>
          ) : fit && !fit.ok ? (
            <p className="small cant-fit-line">
              {times12(adj ? adj.line : fit.reason)} {fitPill}
            </p>
          ) : (
            fitPill
          )}
        </div>
        {!roomRes && <p className="muted small">Loading {r.day}'s book…</p>}
        {roomRes && !roomRes.ok && <p className="warn-text small">{roomRes.error.message}</p>}
        {proposal && proposedAdj && fit && (
          <ChatDiff
            request={r0}
            before={constraints ?? baseConstraints(r0)}
            after={proposal.constraints}
            fitBefore={fit.ok}
            result={proposedAdj}
            floor={proposal.floor}
            floorImpact={floorImpact}
            onApply={() => {
              // the chat keeps its box in view as the sheet changes (RequestChat)
              requestsActions.applyProposal(r0.id, book ?? undefined);
            }}
            onDiscard={() => {
              requestsActions.discardProposal(r0.id);
            }}
            impact={{
              before: impactOf(r, fit),
              after: impactOf(proposedAdj.request, proposedAdj.fit),
            }}
          />
        )}
        {constraints && (changeList(r0, constraints).length > 0 || floorDone) && (
          <div className="field changed-line small" role="status">
            <span className="field-label muted">
              {changedBy === "chat" ? "Changed in chat" : "Changed by hand"}
            </span>
            <span className="field-value">
              {floorDone && (
                <span className="changed-floor">
                  Floor: {floorDone.changes.join(" · ")}
                  {changeList(r0, constraints).length ? " · " : " "}
                </span>
              )}
              {listAnd(changeList(r0, constraints).map((x) => times12(x)))}{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => requestsActions.resetConstraints(r0.id)}
              >
                Revert
              </button>
            </span>
          </div>
        )}
        {constraints && (changeList(r0, constraints).length > 0 || floorDone) && original && (
          <div className="field original-fit small">
            <span className="field-label muted">Original request</span>
            <span className="field-value">
              {original.ok ? "capacity fit ✓" : "no capacity fit"}
            </span>
          </div>
        )}
        {fit?.ok && roomId !== r.bookRoomId && (
          <button
            type="button"
            className="link-btn small"
            onClick={() => requestsActions.viewNight(r)}
          >
            Show on {r.day}'s floor →
          </button>
        )}

        <div className="triage-row small">
          {/* one row: rate the AI triage, open More, mark it as junk */}
          {t?.status === "ok" && !override && (
            <SourceFeedback rowId={`row-${t.result.traceId}`} what="AI triage" compact />
          )}
          <button
            type="button"
            className="link-btn more-toggle"
            aria-expanded={more}
            aria-controls={`more-${r0.id}`}
            onClick={() => setMore((v) => !v)}
          >
            {more ? "Less ▾" : "More ▸"}
          </button>
          <span className="spacer" />
          {(verdict === "real" || verdict === "junk") && (
            <span className="override">
              {override && <span className="muted">You marked this as {override.verdict}. </span>}
              <button
                type="button"
                className="link-btn junk-btn"
                onClick={() =>
                  requestsActions.overrideTriage(r0.id, verdict === "junk" ? "real" : "junk")
                }
              >
                Mark as {verdict === "junk" ? "real" : "junk"}
              </button>
            </span>
          )}
        </div>

        {/* pros, then cons: in view without expanding (one column at every width) */}
        {impacts && (
          <div className="req-impacts small">
            <div className="field req-pros">
              <span className="field-label is-pro">Pros</span>
              <ul className="field-value" aria-label="Pros">
                {impacts.pros.map((p) => (
                  <li key={p}>{times12(p)}</li>
                ))}
              </ul>
            </div>
            <div className="field req-cons">
              <span className="field-label is-con">Cons</span>
              <ul className="field-value" aria-label="Cons">
                {impacts.cons.length ? (
                  impacts.cons.map((c) => <li key={c}>{times12(c)}</li>)
                ) : (
                  <li className="muted">None</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {more && (
          <div className="req-more small" id={`more-${r0.id}`}>
            {fit?.ok && (
              <div className="field req-plan">
                <span className="field-label muted">Plan</span>
                <span className="field-value">{times12(planLine(fit.build))}</span>
              </div>
            )}
            {fit?.ok && cost && (
              <div className="field req-covers">
                <span className="field-label muted">Booked vs walk-ins</span>
                <CoversSummary f={cost} moved={movedDetail.length ? fit.moved.length : 0} />
              </div>
            )}
            {t?.status === "ok" && (
              <div className="field">
                <span className="field-label muted">Why</span>
                <span className="field-value">{t.result.reason}</span>
              </div>
            )}
            {cost && cost.aisle.rejected.length > 0 && (
              <div className="field fit-other">
                <span className="field-label muted">Other layouts considered</span>
                <ul className="field-value">
                  {cost.aisle.rejected.map((x) => (
                    <li key={x.tables.join()}>Not used: {times12(x.reason)}</li>
                  ))}
                </ul>
              </div>
            )}
            {constraints?.notes.length ? (
              <div className="field">
                <span className="field-label muted">Crew notes</span>
                <span className="field-value">{constraints.notes.join(", ")}</span>
              </div>
            ) : null}
            <p className="muted">
              The guest's words are shown here only; the activity log keeps the AI's summary. Tables
              come from the capacity check; the AI can't pick or add tables.
            </p>
            {t?.status === "ok" && (
              <details className="how-made">
                <summary>How this was made</summary>
                <div className="metrics" aria-label="Triage cost and latency">
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
              </details>
            )}
            {fit?.ok && <p className="muted crew-foot">{times12(crewFootnote(fit.build))}</p>}
          </div>
        )}
      </section>

      {decision.kind === "pending" && room && (
        <div className="req-chat-wrap" hidden={!chatOpen}>
          <RequestChat request={r0} room={room} fit={fit} cost={cost} />
          <button type="button" className="link-btn small" onClick={() => setChatOpen(false)}>
            Hide chat
          </button>
        </div>
      )}

      {decision.kind === "pending" && mode === "decline" && (
        <fieldset className="decline" ref={declineRef}>
          <legend className="small">Why decline?</legend>
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
          <label className="decline-note small">
            <span>Add a note for the guest or the log</span>
            <textarea
              rows={2}
              maxLength={MAX_NOTE_CHARS}
              placeholder="Optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </fieldset>
      )}
      {decision.kind === "pending" && mode === "reply" && (
        <div className="reply">
          <label className="small" htmlFor={`reply-${r.id}`}>
            Draft reply — edit before sending. Drafted from the capacity check; it never promises a
            booking.
          </label>
          <textarea
            id={`reply-${r.id}`}
            rows={6}
            value={reply ?? draft}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="btn-row">
            <button
              type="button"
              onClick={() => {
                requestsActions.reply(r, reply !== null && reply !== draft);
                setMode("none");
              }}
            >
              Mark as sent
            </button>
            {note.trim() && (
              <button
                type="button"
                title="Add your decline note to the end of the reply"
                disabled={(reply ?? draft).trimEnd().endsWith(note.trim())}
                onClick={() => setReply(`${(reply ?? draft).trimEnd()}\n\n${note.trim()}`)}
              >
                Insert note
              </button>
            )}
          </div>
          {note.trim() && (reply ?? draft).trimEnd().endsWith(note.trim()) && (
            <p className="muted small">Your note is added as you wrote it.</p>
          )}
          <p className="muted small">Prototype: nothing is sent to anyone.</p>
        </div>
      )}

      {decision.kind === "pending" ? (
        <div className="req-actions decision-footer">
          {sent && (
            <p className="req-sent small" role="status">
              Reply marked sent · {times12(sent.at)}
              {sent.edited ? " · draft edited" : ""} · still open: accept or decline when the guest
              answers{" "}
              <button type="button" className="link-btn" onClick={() => requestsActions.unsend(r)}>
                Undo
              </button>
            </p>
          )}
          {fit?.ok && mode !== "decline" && (
            <p className="feedforward small">
              Accept holds {tablesPhrase(fit.build.tables)}
              {holdFrom ? ` from ${clock12(holdFrom)}` : ""}
              {movedDetail.length
                ? ` · ${movedDetail
                    .map((m) =>
                      m.replace(/^Moves /, "moves ").replace(/ from tables [^ ]+ to /, " to "),
                    )
                    .join(" · ")}`
                : ""}{" "}
              · no guest message is sent
            </p>
          )}
          <div className="btn-row">
            <button
              type="button"
              aria-expanded={mode === "decline"}
              onClick={() => {
                setReason(null);
                setMode(mode === "decline" ? "none" : "decline");
              }}
            >
              Decline
            </button>
            <button
              type="button"
              aria-expanded={mode === "reply"}
              disabled={junk}
              aria-label="Message guest"
              onClick={() => setMode(mode === "reply" ? "none" : "reply")}
            >
              Message
            </button>
            <button
              type="button"
              className="ask-ai"
              title="Discuss this request with the AI Planner"
              disabled={!room}
              onClick={discuss}
            >
              <Sparkle /> Discuss
            </button>
            {mode === "decline" ? (
              <button
                type="button"
                className="primary"
                disabled={reason === null}
                onClick={() => reason && requestsActions.decline(r, reason, note)}
              >
                {declineLabel}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={!fit?.ok || junk || !!proposal}
                title={
                  proposal
                    ? "Apply or discard the change proposed in chat first"
                    : junk
                      ? "Triaged as junk"
                      : !fit?.ok
                        ? "It doesn't fit that night"
                        : undefined
                }
                onClick={() => fit?.ok && setReviewing(true)}
              >
                Accept
              </button>
            )}
          </div>
          {proposal && (
            <p className="muted small accept-why">
              Apply or discard the change proposed in chat to accept.{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  document
                    .querySelector(".chat-diff")
                    ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
                }
              >
                Review change ↑
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="req-decided small" role="status">
          <strong>
            {decision.kind === "accepted"
              ? `Accepted ${times12(decision.at)} · ${tablesPhrase(decision.tables)}`
              : decision.kind === "declined"
                ? `Declined: ${decision.reason === "fit" ? "no capacity fit" : decision.reason} · ${times12(decision.at)}${decision.note ? ` · “${decision.note}”` : ""}`
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

/**
 * The chat's proposed change, as a diff of the request and of the capacity check:
 * "Tables: any → 30–50 · capacity fit ✓ → no capacity fit · closest: tables 57–61 and 63–66". Apply / Discard.
 */
function ChatDiff({
  request: r,
  before,
  after,
  fitBefore,
  result,
  floor,
  floorImpact,
  onApply,
  onDiscard,
  impact,
}: {
  request: GuestRequest;
  before: ChatConstraints;
  after: ChatConstraints;
  fitBefore: boolean;
  result: AdjustedFit;
  /** A floor change proposed with it (drawn on the floor): changes, crew steps. */
  floor?: FloorProposal;
  floorImpact?: EditImpact | null;
  onApply: () => void;
  onDiscard: () => void;
  /** Covers and hold window before → after the change (null where it doesn't fit). */
  impact?: { before: string | null; after: string | null };
}) {
  // label on its own line, value on the next (no "Label: value" pairs)
  const rows: { label: string; value: string }[] = [];
  const range = (c: ChatConstraints) =>
    c.tableRange ? `${c.tableRange.from}–${c.tableRange.to}` : "any";
  if (range(before) !== range(after))
    rows.push({ label: "Tables", value: `${range(before)} → ${range(after)}` });
  const size = (c: ChatConstraints) => c.partySize ?? r.partySize;
  if (size(before) !== size(after))
    rows.push({ label: "Party", value: `${size(before)} → ${size(after)}` });
  const time = (c: ChatConstraints) => clock12(c.time ?? r.time);
  if (time(before) !== time(after))
    rows.push({ label: "Time", value: `${time(before)} → ${time(after)}` });
  const added = after.needs.filter((n) => !before.needs.includes(n));
  const removed = before.needs.filter((n) => !after.needs.includes(n));
  if (added.length) rows.push({ label: "Needs", value: `+ ${added.join(", ")}` });
  if (removed.length) rows.push({ label: "Needs", value: `− ${removed.join(", ")}` });
  const notes = after.notes.filter((n) => !before.notes.includes(n));
  if (notes.length) rows.push({ label: "Notes", value: `+ ${notes.join(", ")}` });
  const word = (ok: boolean) => (ok ? "capacity fit ✓" : "no capacity fit");
  const loses = fitBefore && !result.fit.ok;
  return (
    <div className="chat-diff" role="group" aria-label="Change proposed in chat">
      <p className="chat-diff-title small">
        <span className="ai-label">
          <span aria-hidden="true">✦</span> Proposed changes
        </span>{" "}
        <span className="muted">· nothing changes until you apply them</span>
      </p>
      {floor && (
        <div className="chat-diff-floor small">
          <div className="field">
            <span className="field-label muted">Floor</span>
            <ul className="field-value" aria-label="Floor changes">
              {floor.changes.map((c) => (
                <li key={c.text}>{c.text}</li>
              ))}
            </ul>
          </div>
          {floorImpact && (
            <div className="field">
              <span className="field-label muted">Capacity check</span>
              <span className="field-value">
                {floorImpact.planBefore === floorImpact.planAfter ? (
                  times12(capacityCheckText(floorImpact.planBefore, floorImpact.planAfter))
                ) : (
                  <>
                    {times12(floorImpact.planBefore)} →{" "}
                    <strong>{times12(floorImpact.planAfter)}</strong>
                  </>
                )}
              </span>
            </div>
          )}
          {floorImpact && (
            <div className="field">
              <span className="field-label muted">Bookings moved</span>
              <ul className="field-value" aria-label="Bookings moved">
                {floorImpact.bookingsMoved.length ? (
                  floorImpact.bookingsMoved.map((b) => <li key={b}>{times12(b)}</li>)
                ) : (
                  <li>None</li>
                )}
              </ul>
            </div>
          )}
          <div className="field">
            <span className="field-label muted">Crew · ~{floor.crewMinutes} min (est.)</span>
            <ol className="field-value" aria-label="Crew steps">
              {floor.crew.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <ol className="chat-diff-rows small">
        {rows.map((x) => (
          <li key={`${x.label}-${x.value}`}>
            <span className="field-label muted">{x.label}</span>
            <span className="field-value">{x.value}</span>
          </li>
        ))}
      </ol>
      {impact && (impact.before || impact.after) && impact.before !== impact.after && (
        <p className="chat-diff-impact small">
          <span className="field-label muted">Covers and hold</span>
          <span className="field-value">
            {impact.before ?? "no fit"} → {impact.after ?? "no fit"}
          </span>
        </p>
      )}
      {!floor && (
        <p className="chat-diff-check small">
          <span className="field-label muted">Capacity check</span>
          <span className="field-value">
            {word(fitBefore)} →{" "}
            <span className={`verdict ${result.fit.ok ? "verdict-real" : "verdict-unsure"}`}>
              {word(result.fit.ok)}
            </span>
            {result.fit.ok ? (
              <span> · {tablesPhrase(result.fit.build.tables)}</span>
            ) : result.closest ? (
              <span className="muted"> · closest: {times12(result.closest)}</span>
            ) : null}
          </span>
        </p>
      )}
      {loses && (
        <p className="warn-text small">Applying this leaves the request with no capacity fit.</p>
      )}
      <div className="btn-row">
        <button type="button" className="tonal" onClick={onApply}>
          {loses ? "Apply (no capacity fit)" : "Apply"}
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** "Moves Okafor (10) from tables 63–66 to tables 27–29" for each large party the fit moves. */
function movedLines(
  room: Room,
  r: GuestRequest,
  after: { builds: readonly { reservationId: string; partySize: number; tables: string[] }[] },
  moved: readonly string[],
): string[] {
  const before = planBuilds(
    { ...room, reservations: room.reservations.filter((x) => x.id !== r.id) },
    SERVICE.from,
    SERVICE.to,
  );
  const out: string[] = [];
  for (const id of moved) {
    const a = before.builds.find((b) => b.reservationId === id);
    const b = after.builds.find((x) => x.reservationId === id);
    const who = `${partyName(id)} (${a?.partySize ?? b?.partySize ?? "?"})`;
    if (!a || !b) {
      out.push(`Moves ${who} to other tables`);
      continue;
    }
    const added = b.tables.filter((t) => !a.tables.includes(t));
    const kept = a.tables.every((t) => b.tables.includes(t));
    // same tables: nothing moved for this party; a superset: it keeps its tables and takes more
    if (kept && !added.length) continue;
    out.push(
      kept
        ? `${who} also takes ${tablesPhrase(added)}`
        : `Moves ${who} from ${tablesPhrase(a.tables)} to ${tablesPhrase(b.tables)}`,
    );
  }
  return out;
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

/** Accessibility needs (wheelchair, stroller): a small person-in-wheelchair mark beside the Needs line. */
function AccessIcon() {
  return (
    <svg className="access-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8.5" cy="2.5" r="1.5" fill="currentColor" />
      <path
        d="M8 5v4h3.5l1.5 4M8 7h3M6 7.2a4 4 0 1 0 5.6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
