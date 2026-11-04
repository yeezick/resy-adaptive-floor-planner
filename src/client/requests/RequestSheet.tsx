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
  planBuilds,
  toHHMM,
  toMinutes,
  type Room,
} from "../../domain";
import { ImpactsCard } from "../Fit/ImpactsCard";
import {
  checkRequest,
  draftReply,
  needsOverview,
  requestWhen,
  SERVICE,
  SOURCE_LABEL,
  toReservation,
  type GuestRequest,
} from "../../domain/requests";
import { fetchRoom } from "../api";
import { duration, normalTimes, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useElapsedMinutes } from "../lib/useDemoClock";
import {
  baseConstraints,
  changeList,
  checkAdjusted,
  type AdjustedFit,
  type ChatConstraints,
} from "../../domain/requestChat";
import { listAnd } from "../../domain/wording";
import { RequestChat } from "./RequestChat";
import { SourceFeedback } from "../activity/SourceFeedback";
import {
  decisionOf,
  requestsActions,
  useRequests,
  type DeclineReason,
  type TriageState,
} from "./store";
import { partyName } from "../lib/names";

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

/** Where an AI-agent request came from, in full (shown in the expanded triage detail). */
const SOURCE_DETAIL: Partial<Record<GuestRequest["source"], string>> = {
  "ai-agent": "via a chat app or MCP",
};

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
  // A change the chat proposed: shown as a diff, applied only when the manager presses Apply.
  const proposal = s.proposals[r0.id];
  const proposedAdj = useMemo(
    () => (room && proposal ? checkAdjusted(room, r0, proposal.constraints) : null),
    [room, r0, proposal],
  );
  const original = useMemo(() => (room ? checkRequest(room, r0) : null), [room, r0]);
  const changedBy = s.changedBy[r0.id];
  const fit = useMemo(() => adj?.fit ?? (room ? checkRequest(room, r0) : null), [adj, room, r0]);
  const elapsed = useElapsedMinutes();
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
  }, [focusChat, chatOpen, r0.id]);
  const holdFrom = cost?.hold.tables.length ? cost.hold.from : null;

  return (
    <div className="request-sheet decision">
      <div className="req-head">
        <h2 className="req-title">
          {r.contact} · party of {r.partySize} · {requestWhen(r, now, elapsed)}
        </h2>
        <div className="muted small">
          <span className={`source-label source-${r.source}`}>{SOURCE_LABEL[r.source]}</span> ·
          received {times12(r.receivedAt)}
        </div>
      </div>

      <section className="req-block ai-card" aria-label="AI triage">
        <div className="req-block-head">
          <h3 className="section-title ai-label">
            <span aria-hidden="true">✦</span> AI triage
          </h3>
          <VerdictChip t={t} override={override} />
        </div>
        <ul className="req-overview" aria-label="What the party needs">
          {overview.map((line) => (
            <li key={line}>{normalTimes(line)}</li>
          ))}
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
        <div className="triage-row small">
          {t?.status === "ok" && !override && (
            <SourceFeedback rowId={`row-${t.result.traceId}`} what="AI triage" compact />
          )}
          {(verdict === "real" || verdict === "junk") && (
            <span className="override">
              <span className="muted">
                {override ? `You marked this as ${override.verdict}. ` : "Wrong? "}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  requestsActions.overrideTriage(r0.id, verdict === "junk" ? "real" : "junk")
                }
              >
                Mark as {verdict === "junk" ? "real" : "junk"}
              </button>
            </span>
          )}
          <details className="how-made">
            <summary>Detail ▸</summary>
            {t?.status === "ok" && (
              <p>
                <span className="muted">Why: </span>
                {t.result.reason}
              </p>
            )}
            <p className="muted">
              {SOURCE_LABEL[r.source]}
              {SOURCE_DETAIL[r.source] ? ` ${SOURCE_DETAIL[r.source]}` : ""}
            </p>
            <p className="req-message">
              <span className="muted">
                {r.source === "walk-in" ? "Host's note: " : "Guest's message: "}
              </span>
              {r.message}
            </p>
            <p className="muted">
              Shown here only. The activity log keeps the AI's summary, never the guest's words.
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
          </details>
        </div>
      </section>

      <section className="req-block" aria-label="Capacity fit">
        <div className="req-block-head">
          <h3 className="section-title">Capacity check</h3>
          {fit && (
            <span
              className={`verdict ${fit.ok ? "verdict-real" : "verdict-unsure"} fit-pill`}
              title={fit.ok ? "Ready time is estimated from each table's meal phase" : undefined}
            >
              {fit.ok && ready
                ? readinessPill(ready)
                : fit.ok
                  ? "capacity fit ✓"
                  : "no capacity fit"}
            </span>
          )}
        </div>
        {proposal && proposedAdj && fit && (
          <ChatDiff
            request={r0}
            before={constraints ?? baseConstraints(r0)}
            after={proposal.constraints}
            fitBefore={fit.ok}
            result={proposedAdj}
            onApply={() => requestsActions.applyProposal(r0.id)}
            onDiscard={() => requestsActions.discardProposal(r0.id)}
          />
        )}
        {constraints && changeList(r0, constraints).length > 0 && (
          <p className="changed-line small" role="status">
            <span>
              {changedBy === "chat" ? "Changed in chat" : "Changed by hand"}:{" "}
              {listAnd(changeList(r0, constraints).map((x) => times12(x)))}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => requestsActions.resetConstraints(r0.id)}
            >
              Revert
            </button>
          </p>
        )}
        {constraints && changeList(r0, constraints).length > 0 && original && (
          <p className="original-fit small">
            Original request: {original.ok ? "capacity fit ✓" : "no capacity fit"}
          </p>
        )}
        {!roomRes && <p className="muted small">Loading {r.day}'s book…</p>}
        {roomRes && !roomRes.ok && <p className="warn-text small">{roomRes.error.message}</p>}
        {fit?.ok && (
          <p className="fit-summary small">
            {tablesPhrase(fit.build.tables)} · {fit.build.area} · seats {fit.build.seats} · build by{" "}
            {clock12(fit.build.buildBy)}
          </p>
        )}
        {fit && !fit.ok && (
          <p className="small cant-fit-line">{times12(adj ? adj.line : fit.reason)}</p>
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
        {fit?.ok && cost && room && (
          <ImpactsCard
            room={room}
            f={cost}
            build={fit.build}
            needs={r.needs}
            moved={fit.moved}
            movedDetail={movedDetail}
          />
        )}
        {fit?.ok && (
          <details className="small more">
            <summary>Build and tables ▸</summary>
            <p className="crew-note">
              {crewNote(fit.build)}
              {constraints?.notes.length ? ` Also: ${constraints.notes.join(", ")}.` : ""}
            </p>
            <p className="muted">Every booking already on {r.day} still has a table.</p>
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
          </details>
        )}
        {cost && cost.aisle.rejected.length > 0 && (
          <details className="small more">
            <summary>Other layouts considered ▸</summary>
            <ul>
              {cost.aisle.rejected.map((x) => (
                <li key={x.tables.join()}>Not used: {times12(x.reason)}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="muted small">
          Tables come from Capacity check; the AI reads the request and can't pick or add tables.
        </p>
      </section>

      {decision.kind === "pending" && room && (
        <div className="req-chat-wrap" hidden={!chatOpen}>
          <RequestChat request={r0} result={proposedAdj ?? adj} />
          <button type="button" className="link-btn small" onClick={() => setChatOpen(false)}>
            Hide chat
          </button>
        </div>
      )}

      {decision.kind === "pending" && mode === "decline" && (
        <fieldset className="decline">
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
          <button
            type="button"
            disabled={reason === null}
            onClick={() => reason && requestsActions.decline(r, reason)}
          >
            {reason === null
              ? "Pick a reason to decline"
              : `Decline: ${reason === "fit" ? "no capacity fit" : reason}`}
          </button>
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
          <button
            type="button"
            onClick={() => requestsActions.reply(r, reply !== null && reply !== draft)}
          >
            Mark as sent
          </button>
          <p className="muted small">Prototype: nothing is sent to anyone.</p>
        </div>
      )}

      {decision.kind === "pending" ? (
        <div className="req-actions decision-footer">
          {fit?.ok && (
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
          <button
            type="button"
            className="ask-ai text-btn"
            title="Discuss this request with the AI Planner"
            disabled={!room}
            onClick={discuss}
          >
            <Sparkle /> Discuss
          </button>
          <div className="btn-row">
            <span className="spacer" />
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
              onClick={() => setMode(mode === "reply" ? "none" : "reply")}
            >
              Message guest
            </button>
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
              onClick={() => fit?.ok && requestsActions.accept(r, fit.build.tables)}
            >
              Accept
            </button>
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
                ? `Declined: ${decision.reason === "fit" ? "no capacity fit" : decision.reason} · ${times12(decision.at)}`
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
  onApply,
  onDiscard,
}: {
  request: GuestRequest;
  before: ChatConstraints;
  after: ChatConstraints;
  fitBefore: boolean;
  result: AdjustedFit;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const rows: string[] = [];
  const range = (c: ChatConstraints) =>
    c.tableRange ? `${c.tableRange.from}–${c.tableRange.to}` : "any";
  if (range(before) !== range(after)) rows.push(`Tables: ${range(before)} → ${range(after)}`);
  const size = (c: ChatConstraints) => c.partySize ?? r.partySize;
  if (size(before) !== size(after)) rows.push(`Party: ${size(before)} → ${size(after)}`);
  const time = (c: ChatConstraints) => clock12(c.time ?? r.time);
  if (time(before) !== time(after)) rows.push(`Time: ${time(before)} → ${time(after)}`);
  const added = after.needs.filter((n) => !before.needs.includes(n));
  const removed = before.needs.filter((n) => !after.needs.includes(n));
  if (added.length) rows.push(`Needs: + ${added.join(", ")}`);
  if (removed.length) rows.push(`Needs: − ${removed.join(", ")}`);
  const notes = after.notes.filter((n) => !before.notes.includes(n));
  if (notes.length) rows.push(`Notes: + ${notes.join(", ")}`);
  const word = (ok: boolean) => (ok ? "capacity fit ✓" : "no capacity fit");
  const loses = fitBefore && !result.fit.ok;
  return (
    <div className="chat-diff" role="group" aria-label="Change proposed in chat">
      <p className="chat-diff-title small">
        <span className="ai-label">
          <span aria-hidden="true">✦</span> Proposed in chat
        </span>{" "}
        <span className="muted">· nothing changes until you apply it</span>
      </p>
      <ul className="chat-diff-rows small">
        {rows.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="chat-diff-check small">
        <span className="muted">Capacity check: </span>
        {word(fitBefore)} →{" "}
        <span className={`verdict ${result.fit.ok ? "verdict-real" : "verdict-unsure"}`}>
          {word(result.fit.ok)}
        </span>
        {result.fit.ok ? (
          <span> · {tablesPhrase(result.fit.build.tables)}</span>
        ) : result.closest ? (
          <span className="muted"> · closest: {times12(result.closest)}</span>
        ) : null}
      </p>
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
  return moved.map((id) => {
    const a = before.builds.find((b) => b.reservationId === id);
    const b = after.builds.find((x) => x.reservationId === id);
    const who = `${partyName(id)} (${a?.partySize ?? b?.partySize ?? "?"})`;
    return a && b
      ? `Moves ${who} from ${tablesPhrase(a.tables)} to ${tablesPhrase(b.tables)}`
      : `Moves ${who} to other tables`;
  });
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
