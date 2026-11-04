import { useState, type ReactNode } from "react";
import type { Room, TonightProposal } from "../domain";
import { LayoutEditor } from "./Editor/LayoutEditor";
import { useLayouts } from "./layouts/useLayouts";
import { Planner } from "./Planner";

export interface EditRequest {
  room: Room;
  name: string;
  /** Layout to overwrite on Save; null = always save as a new layout. */
  layoutId: string | null;
  date?: string;
  shift?: string;
}

/** A tonight plan the manager applied: kept here so the planner (remounted on Apply) shows it as applied. */
export interface AppliedPlan {
  layoutId: string;
  /** The layout in use before Apply (Undo restores it). */
  prevActiveId: string;
  proposal: TonightProposal;
  /** The layout the plan was generated from (the read-only build plan re-plans this, not the result). */
  baseRoom: Room;
}

/** Owns the named layouts for one fixture and swaps between the console and the editor. */
export function LayoutHost({
  fixture,
  roomSelect,
  focusRequest,
  focusView,
  focusApply = false,
}: {
  fixture: Room;
  roomSelect: ReactNode;
  focusRequest?: string;
  focusView?: "plan" | "request";
  /** Accepted from the review screen: apply the crew plan without a second step. */
  focusApply?: boolean;
}) {
  const layouts = useLayouts(fixture);
  const [editing, setEditing] = useState<EditRequest | null>(null);
  const [applied, setApplied] = useState<AppliedPlan | null>(null);

  if (editing) {
    const canOverwrite = editing.layoutId !== null && editing.layoutId !== "base";
    return (
      <LayoutEditor
        key={`${editing.layoutId ?? "new"}#${editing.name}`}
        plans={layouts.layouts}
        currentId={editing.layoutId}
        onOpenPlan={(l) =>
          setEditing({ room: l.room, name: l.name, layoutId: l.id, date: l.date, shift: l.shift })
        }
        initial={editing.room}
        name={editing.name}
        canOverwrite={canOverwrite}
        onCancel={() => setEditing(null)}
        onSave={(room, name, asNew) => {
          layouts.save(room, {
            name,
            id: asNew ? undefined : (editing.layoutId ?? undefined),
            date: editing.date,
            shift: editing.shift,
          });
          setEditing(null);
        }}
      />
    );
  }

  return (
    <Planner
      key={`${layouts.active.id}#${layouts.version}`}
      fixture={layouts.active.room}
      roomSelect={roomSelect}
      layouts={layouts}
      onEditLayout={setEditing}
      focusRequest={focusRequest}
      focusView={focusView}
      focusApply={focusApply}
      applied={applied?.layoutId === layouts.active.id ? applied : null}
      onApplied={(p, baseRoom, meta) => {
        const prevActiveId = layouts.active.id;
        const l = layouts.save(p.variant, meta);
        setApplied({ layoutId: l.id, prevActiveId, proposal: p, baseRoom });
      }}
      onUndoApply={() => {
        if (!applied) return;
        layouts.remove(applied.layoutId, applied.prevActiveId);
        setApplied(null);
      }}
    />
  );
}
