import { useRef, useState, type ReactNode } from "react";
import {
  applyCombine,
  applyMove,
  applySplit,
  comboOf,
  tableById,
  type Room,
  type TonightProposal,
} from "../domain";
import type { EditRequest } from "./LayoutHost";
import { LayoutsList } from "./layouts/LayoutsList";
import { tonightName, type LayoutsApi } from "./layouts/useLayouts";
import { POSITIONING, TonightPanel } from "./Tonight/TonightPanel";
import { AgentPanel } from "./AgentPanel/AgentPanel";
import { BuildPlan } from "./BuildPlan/BuildPlan";
import { ConsoleBar, type PanelMode } from "./ConsoleBar";
import { CoversStrip } from "./CoversStrip";
import { FloorPlan } from "./FloorPlan/FloorPlan";
import { Legend } from "./FloorPlan/Legend";
import { SelectionBar } from "./FloorPlan/SelectionBar";
import { TableDetails } from "./FloorPlan/TableDetails";
import type { Highlight, HighlightControls } from "./highlight";
import { finishParty, seatParty, type DoneEntry, type WaitEntry } from "./lib/service";
import { Rail } from "./Rail/Rail";
import { WalkInSheet, type WalkInDraft } from "./WalkIn/WalkInSheet";

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const PANEL_TITLE: Record<PanelMode, string> = {
  details: "Table details",
  walkin: "Walk-in",
  assistant: "Assistant",
  shift: "Shift setup",
};

/** Owns the edited room and the session's waitlist / done lists. Remounted per fixture. */
interface PlannerProps {
  fixture: Room;
  roomSelect: ReactNode;
  layouts: LayoutsApi;
  onEditLayout: (req: EditRequest) => void;
}

export function Planner({ fixture, roomSelect, layouts, onEditLayout }: PlannerProps) {
  const [room, setRoom] = useState(fixture);
  const [proposal, setProposal] = useState<TonightProposal | null>(null);
  const [edited, setEdited] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [hover, setHover] = useState<Highlight | null>(null);
  const [pinned, setPinned] = useState<Highlight | null>(null);
  const [mode, setMode] = useState<PanelMode>("details");
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [draft, setDraft] = useState<WalkInDraft>({ size: 2, needs: [] });
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const nextId = useRef(1);

  const highlight = hover ?? pinned;
  const controls: HighlightControls = {
    pinnedKey: pinned?.key ?? null,
    onHover: setHover,
    onTogglePin: (h) => setPinned((p) => (p?.key === h.key ? null : h)),
  };

  const run = (fn: () => Room, message: string): ActionResult => {
    try {
      setRoom(fn());
      setEdited(true);
      const r: ActionResult = { ok: true, message };
      setNotice(r);
      return r;
    } catch (err) {
      const r: ActionResult = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
      setNotice(r);
      return r;
    }
  };

  const combine = (ids: string[]) => {
    const r = run(() => applyCombine(room, ids), `Combined ${ids.join(" + ")}`);
    if (r.ok) setSelected([]);
    return r;
  };
  const combineRows = (rows: string[][]) =>
    run(
      () => rows.reduce((next, r) => applyCombine(next, r), room),
      `Combined ${rows.map((r) => r.join(" + ")).join("; ")}`,
    );
  const split = (ids: string[]) => {
    const combos = new Set(ids.map((id) => comboOf(room, id)).filter((c) => c !== undefined));
    run(
      () => {
        let next = room;
        for (const c of combos) next = applySplit(next, c[0] as string);
        return next;
      },
      `Split ${[...combos].map((c) => c.join(" + ")).join("; ")}`,
    );
  };
  const move = (id: string, x: number, y: number) =>
    run(() => applyMove(room, id, x, y), `Moved ${id}`);
  const toggle = (id: string) => {
    if (selected.length === 0 && mode !== "walkin") setMode("details");
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const openWalkIn = (d: Partial<WalkInDraft> & { ids?: string[] } = {}) => {
    setDraft({ size: d.size ?? 2, needs: d.needs ?? [], waitId: d.waitId });
    setSelected(d.ids ?? []);
    setMode("walkin");
  };
  const seat = (ids: string[], size: number) => {
    const r = run(() => seatParty(room, ids, size), `Seated party of ${size} at ${ids.join("+")}`);
    if (!r.ok) return;
    if (draft.waitId) setWaitlist((w) => w.filter((x) => x.id !== draft.waitId));
    setSelected([]);
    setMode("details");
  };
  const addToWaitlist = (quoteMin: number) => {
    const entry: WaitEntry = {
      id: `W${nextId.current++}`,
      partySize: draft.size,
      needs: draft.needs,
      quoteMin,
      addedAt: room.clock,
    };
    setWaitlist((w) => [...w, entry]);
    setNotice({ ok: true, message: `Party of ${draft.size} waitlisted, quoted ~${quoteMin} min` });
    setSelected([]);
    setMode("details");
  };
  const finish = (ids: string[]) => {
    const size = Math.max(...ids.map((id) => tableById(room, id)?.partySize ?? 0));
    const r = run(() => finishParty(room, ids), `Finished ${ids.join("+")} — tables open`);
    if (!r.ok) return;
    setDone((d) => [
      ...d,
      { id: `D${nextId.current++}`, partySize: size, tables: ids, finishedAt: room.clock },
    ]);
    setSelected((s) => s.filter((id) => !ids.includes(id)));
  };
  const reset = () => {
    setRoom(fixture);
    setEdited(false);
    setSelected([]);
    setPinned(null);
    setNotice({ ok: true, message: "Reset to the original room" });
  };

  return (
    <div className="console">
      <ConsoleBar
        room={room}
        roomSelect={roomSelect}
        layoutName={layouts.active.name}
        edited={edited}
        notice={notice}
        mode={mode}
        onMode={(m) => (m === "walkin" ? openWalkIn() : setMode(m))}
        onReset={reset}
      />
      <div className="console-body">
        <aside className="rail" aria-label="Guest lists">
          <Rail
            room={room}
            waitlist={waitlist}
            done={done}
            highlight={controls}
            onWalkIn={() => openWalkIn()}
            onSeatWaiting={(w) => openWalkIn({ size: w.partySize, needs: w.needs, waitId: w.id })}
            onRemoveWaiting={(id) => setWaitlist((w) => w.filter((x) => x.id !== id))}
            onSelectTables={(ids) => {
              setSelected(ids);
              if (mode !== "walkin") setMode("details");
            }}
            onFinish={finish}
          />
        </aside>

        <section className="floor-col" aria-label="Floor plan">
          {proposal && (
            <div className="preview-bar" role="status">
              <strong>Previewing tonight's layout</strong> · {proposal.window.from}–
              {proposal.window.to} · ghosts and arrows show what moves; nothing changes until you
              apply it.
              <button type="button" className="link-btn" onClick={() => setProposal(null)}>
                Exit preview
              </button>
            </div>
          )}
          <FloorPlan
            room={proposal?.variant ?? room}
            selected={proposal ? [] : selected}
            highlight={highlight}
            onToggle={proposal ? () => undefined : toggle}
            onMove={proposal ? () => undefined : move}
            changes={proposal?.changes}
          />
          <CoversStrip room={room} />
          <Legend />
        </section>

        <aside className="side-col" aria-labelledby="panel-title">
          <div className="panel-head">
            <h2 id="panel-title">{PANEL_TITLE[mode]}</h2>
            {mode !== "details" && (
              <button type="button" className="link-btn" onClick={() => setMode("details")}>
                Close
              </button>
            )}
          </div>
          <div className="tabpanel" hidden={mode !== "details"}>
            <SelectionBar
              room={room}
              selected={selected}
              onCombine={combine}
              onSplit={split}
              onClear={() => setSelected([])}
            />
            <TableDetails room={room} selected={selected} onFinish={finish} />
          </div>
          {mode === "walkin" && (
            <div className="tabpanel">
              <WalkInSheet
                room={room}
                draft={draft}
                selected={selected}
                onDraft={setDraft}
                onSelect={setSelected}
                onSeat={seat}
                onWaitlist={addToWaitlist}
              />
            </div>
          )}
          {/* Kept mounted so the conversation survives switching panels. */}
          <div className="tabpanel" hidden={mode !== "assistant"}>
            <AgentPanel
              room={room}
              highlight={controls}
              onApplyRows={combineRows}
              onSelectTables={(ids, size) => openWalkIn({ ids, size })}
              onOpenShift={() => setMode("shift")}
            />
          </div>
          {mode === "shift" && (
            <div className="tabpanel">
              <p className="positioning">{POSITIONING}</p>
              <LayoutsList
                layouts={layouts}
                onEdit={(r, name, id) => onEditLayout({ room: r, name, layoutId: id })}
              />
              <TonightPanel
                layouts={layouts}
                proposal={proposal}
                highlight={controls}
                onProposal={setProposal}
                onEdit={(r, name) =>
                  onEditLayout({
                    room: r,
                    name,
                    layoutId: null,
                    date: today(),
                    shift: proposal ? `${proposal.window.from}–${proposal.window.to}` : undefined,
                  })
                }
                onApply={(p) =>
                  layouts.save(p.variant, {
                    name: tonightName(p.window.from, p.window.to),
                    date: today(),
                    shift: `${p.window.from}–${p.window.to}`,
                  })
                }
              />
              <details className="buildplan-details">
                <summary>Large-party build plan for the layout in use (read-only)</summary>
                <BuildPlan room={room} highlight={controls} />
              </details>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
