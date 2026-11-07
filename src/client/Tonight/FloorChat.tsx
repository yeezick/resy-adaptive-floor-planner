// Shift setup's "Tell the AI": change tonight's floor in words, with no request open ("take 62 out and bring two
// 4-tops into the Library"). The AI only returns operations; the floor engine on this device places and checks
// them and the proposal is drawn on the floor. Apply saves a new one-day layout for the night (the layout in use
// is kept; the base never changes); Undo removes it.
import { useState, useSyncExternalStore } from "react";
import { nightMoves } from "../../domain/floorEdit";
import { proposeLayoutEdit, type LayoutEdit, type Room } from "../../domain";
import { postFloorChat } from "../api";
import { floorRefusal, floorReplyText, type ProposalStatus } from "../requests/chatReply";
import { partyName } from "../lib/names";
import { Working } from "../lib/wait";
import type { LayoutsApi } from "../layouts/useLayouts";
import "../requests/chat15.css";

export interface ShiftFloorProposal {
  roomId: string;
  edit: LayoutEdit & { ok: true; edited: Room };
  moved: string[];
}

interface ShiftFloorState {
  /** The proposal on screen (nothing applied yet). */
  proposal: ShiftFloorProposal | null;
  /** The last change applied here, per night: Undo restores the layout that was in use. */
  applied: Record<string, { layoutId: string; prevActiveId: string; changes: string[] }>;
  /**
   * The last answer, per night (kept across the planner's remount on Apply). A proposal's reply keeps only its
   * base ("I'd change the floor (2 changes)"); where the change is now is rendered from `status`.
   */
  reply: Record<
    string,
    { message: string; text: string; warn?: boolean; status?: ProposalStatus } | undefined
  >;
  /** A layout save remounts the night's planner: reopen Shift setup there (once). */
  reopen: string | null;
}

let state: ShiftFloorState = { proposal: null, applied: {}, reply: {}, reopen: null };
const listeners = new Set<() => void>();
const set = (next: Partial<ShiftFloorState>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};
export const shiftFloorStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  /** Tests only. */
  reset: () => set({ proposal: null, applied: {}, reply: {}, reopen: null }),
  /** After Apply / Undo on this night, the remounted planner opens on Shift setup (then clears it). */
  wantsReopen: (roomId: string): boolean => state.reopen === roomId,
  clearReopen(): void {
    if (state.reopen) state = { ...state, reopen: null };
  },
};
export function useShiftFloor(): ShiftFloorState {
  return useSyncExternalStore(shiftFloorStore.subscribe, shiftFloorStore.get);
}

export function FloorChat({
  room,
  layouts,
  day,
  date,
}: {
  /** The night as it stands: its layout in use with the night's book. */
  room: Room;
  layouts: LayoutsApi;
  day?: string;
  date?: string;
}) {
  const s = useShiftFloor();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const proposal = s.proposal?.roomId === room.id ? s.proposal : null;
  const applied = s.applied[room.id];
  const reply = s.reply[room.id];
  const answer = (message: string, t: string, warn = false) =>
    set({ reply: { ...state.reply, [room.id]: { message, text: t, warn } } });
  /** What became of the night's proposed change, for its reply (one reply per night). */
  const status = (next: ProposalStatus) => {
    const r = state.reply[room.id];
    return r?.status ? { reply: { ...state.reply, [room.id]: { ...r, status: next } } } : {};
  };

  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setText("");
    set({ proposal: null });
    const refused = floorRefusal(m);
    if (refused) return answer(m, refused);
    setBusy(Date.now());
    const res = await postFloorChat({ message: m, roomId: room.id });
    setBusy(null);
    if (!res.ok) return answer(m, res.error.message, true);
    const out = res.data.output;
    if (!out)
      return answer(
        m,
        res.data.note ?? "I couldn't turn that into a floor change. Nothing changed.",
      );
    if (!out.ops.length)
      return answer(m, out.clarify ?? "Nothing to change on the floor. Nothing changed.");
    const e = proposeLayoutEdit(room, out.ops, { nameOf: partyName });
    if (!e.ok || !e.edited) {
      const lines = [...e.rejects.map((x) => x.text), ...e.notes];
      const question = lines.length === 1 && lines[0]?.endsWith("?");
      return answer(m, question ? (lines[0] as string) : `${lines.join(" ")} Nothing changed.`);
    }
    const edit = e as ShiftFloorProposal["edit"];
    set({
      proposal: { roomId: room.id, edit, moved: nightMoves(room, edit.edited, partyName) },
      reply: {
        ...state.reply,
        [room.id]: {
          message: m,
          text: `I'd change the floor (${e.changes.length} change${e.changes.length === 1 ? "" : "s"})`,
          status: "pending",
        },
      },
    });
  };

  const apply = () => {
    if (!proposal) return;
    const prev = layouts.active;
    const changes = proposal.edit.changes.map((c) => c.text);
    set({ proposal: null, reopen: room.id, ...status("applied") });
    const l = layouts.save(proposal.edit.edited, {
      name: `${day ?? "Tonight"} plan — floor change`,
      date,
    });
    set({
      applied: { ...state.applied, [room.id]: { layoutId: l.id, prevActiveId: prev.id, changes } },
    });
  };
  const undo = () => {
    if (!applied) return;
    const { [room.id]: _gone, ...rest } = state.applied;
    set({ applied: rest, reopen: room.id, ...status("undone") });
    layouts.remove(applied.layoutId, applied.prevActiveId);
  };

  return (
    <section className="floor-chat" aria-label="Tell the AI">
      <h3 className="section-title">Tell the AI</h3>
      <p className="muted small">
        Change tonight's floor in words, e.g. “take 62 out and bring two 4-tops into the Library”.
        Nothing changes until you apply it.
      </p>
      {reply && (
        <div className="floor-chat-turn small">
          <p className="chat-me">{reply.message}</p>
          <p className={`chat-out${reply.warn ? " warn-text" : ""}`}>
            {reply.status ? floorReplyText(reply.text, reply.status) : reply.text}
          </p>
        </div>
      )}
      {busy !== null && (
        <p className="chat-out small">
          <Working since={busy} />
        </p>
      )}
      {proposal && (
        <div className="chat-diff" role="group" aria-label="Floor change proposed in Shift setup">
          <p className="chat-diff-title small">
            <span className="ai-label">
              <span aria-hidden="true">✦</span> Proposed floor change
            </span>{" "}
            <span className="muted">· nothing changes until you apply it</span>
          </p>
          <div className="chat-diff-floor small">
            <div className="field">
              <span className="field-label muted">Floor</span>
              <ul className="field-value" aria-label="Floor changes">
                {proposal.edit.changes.map((c) => (
                  <li key={c.text}>{c.text}</li>
                ))}
              </ul>
            </div>
            <div className="field">
              <span className="field-label muted">Bookings moved</span>
              <ul className="field-value" aria-label="Bookings moved">
                {proposal.moved.length ? (
                  proposal.moved.map((b) => <li key={b}>{b}</li>)
                ) : (
                  <li>None</li>
                )}
              </ul>
            </div>
            <div className="field">
              <span className="field-label muted">
                Crew · ~{proposal.edit.crewMinutes} min (est.)
              </span>
              <ol className="field-value" aria-label="Crew steps">
                {proposal.edit.crew.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="tonal" onClick={apply}>
              Apply
            </button>
            <button type="button" onClick={() => set({ proposal: null, ...status("discarded") })}>
              Discard
            </button>
          </div>
        </div>
      )}
      {applied && !proposal && (
        <p className="applied-bar small" role="status">
          <span>Floor changed: {applied.changes.join(" · ")}</span>{" "}
          <button type="button" className="link-btn" onClick={undo}>
            Undo
          </button>
        </p>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor={`floor-chat-${room.id}`}>
          Tell the AI about tonight's floor
        </label>
        <textarea
          id={`floor-chat-${room.id}`}
          rows={2}
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-form-foot">
          <span className="spacer" />
          <button type="submit" className="tonal" disabled={!text.trim() || busy !== null}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
