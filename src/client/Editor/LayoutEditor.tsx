import { useState, type KeyboardEvent } from "react";
import { parseRoom, type Room, type Table } from "../../domain";
import { viewBox } from "../FloorPlan/geometry";
import { addTable, duplicate, moveTables, removeTables, setJoin, updateTable } from "./edit";
import { EditorCanvas } from "./EditorCanvas";
import { StorageEditor } from "./StorageEditor";
import { TableInspector } from "./TableInspector";

interface Props {
  initial: Room;
  name: string;
  /** False when editing the base layout: saving always makes a new layout. */
  canOverwrite: boolean;
  onCancel: () => void;
  onSave: (room: Room, name: string, asNew: boolean) => void;
}

interface History {
  past: Room[];
  present: Room;
  future: Room[];
}

const ZOOMS = [1, 1.5, 2, 3];

/** Manual twin of "Generate tonight's layout": canvas + toolbar + side panel. */
export function LayoutEditor({
  initial,
  name: initialName,
  canOverwrite,
  onCancel,
  onSave,
}: Props) {
  const [h, setH] = useState<History>({ past: [], present: initial, future: [] });
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(canOverwrite ? initialName : `${initialName} — edited`);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const room = h.present;

  const commit = (next: Room) => {
    if (next === room) return;
    setH({ past: [...h.past.slice(-49), room], present: next, future: [] });
    setError(null);
  };
  const undo = () => {
    const prev = h.past[h.past.length - 1];
    if (!prev) return;
    setH({ past: h.past.slice(0, -1), present: prev, future: [room, ...h.future] });
  };
  const redo = () => {
    const [next, ...rest] = h.future;
    if (!next) return;
    setH({ past: [...h.past, room], present: next, future: rest });
  };

  const add = () => {
    const v = viewBox(room, "main");
    const r = addTable(room, { x: v.x + v.w / 2, y: v.y + v.h / 2 });
    commit(r.room);
    setSelected([r.id]);
  };
  const dup = () => {
    const r = duplicate(room, selected);
    commit(r.room);
    setSelected(r.ids);
  };
  const del = () => {
    commit(removeTables(room, selected));
    setSelected([]);
  };
  const save = (asNew: boolean) => {
    try {
      const valid = parseRoom(JSON.parse(JSON.stringify(room)));
      if (!name.trim()) throw new Error("give the layout a name");
      onSave(valid, name.trim(), asNew);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
      e.preventDefault();
      del();
    } else if (selected.length && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 2 : 0.5;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      commit(moveTables(room, selected, dx, dy));
    }
  };

  const one = selected.length === 1 ? selected[0] : undefined;

  return (
    <div className="editor" onKeyDown={onKey}>
      <div className="editor-bar" role="toolbar" aria-label="Layout editor">
        <label className="field-inline">
          <span>Layout name</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="seg">
          <button type="button" onClick={add}>
            Add table
          </button>
          <button type="button" disabled={!selected.length} onClick={dup}>
            Duplicate
          </button>
          <button type="button" disabled={!selected.length} onClick={del}>
            Delete
          </button>
        </div>
        <div className="seg">
          <button type="button" disabled={!h.past.length} onClick={undo} aria-label="Undo">
            Undo
          </button>
          <button type="button" disabled={!h.future.length} onClick={redo} aria-label="Redo">
            Redo
          </button>
        </div>
        <div className="seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z === 1 ? "Fit" : `${z * 100}%`}
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {canOverwrite && (
            <button type="button" onClick={() => save(true)}>
              Save as new
            </button>
          )}
          <button type="button" className="primary" onClick={() => save(!canOverwrite)}>
            {canOverwrite ? "Save" : "Save as new layout"}
          </button>
        </div>
      </div>
      {error && (
        <div className="state-card error small" role="alert">
          Can't save: {error}
        </div>
      )}
      <div className="editor-body">
        <div className="floor-wrap">
          <EditorCanvas
            room={room}
            selected={selected}
            zoom={zoom}
            onSelect={setSelected}
            onMoveCommit={(ids, dx, dy) => commit(moveTables(room, ids, dx, dy))}
          />
          <p className="muted small editor-hint">
            Click to select · shift-click to add · drag a box to select many · drag to move (snaps
            to ½ grid) · arrows nudge · ⌫ deletes · ⌘Z / ⇧⌘Z undo / redo. Grey lines are joinable
            pairs.
          </p>
        </div>
        <aside className="side-col editor-side" aria-label="Selection and storage">
          <div className="tabpanel">
            {one ? (
              <TableInspector
                room={room}
                id={one}
                onPatch={(patch: Partial<Table>) => commit(updateTable(room, one, patch))}
                onJoin={(other, on) => commit(setJoin(room, one, other, on))}
              />
            ) : (
              <p className="muted small">
                {selected.length
                  ? `${selected.length} tables selected — drag to move them together, or Duplicate / Delete.`
                  : "Select a table to edit it."}
              </p>
            )}
            <StorageEditor
              inv={room.inventory}
              onChange={(inventory) => commit({ ...room, inventory })}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
