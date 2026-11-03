import { useState, type ReactNode } from "react";
import type { Room } from "../domain";
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

/** Owns the named layouts for one fixture and swaps between the console and the editor. */
export function LayoutHost({
  fixture,
  roomSelect,
  focusRequest,
}: {
  fixture: Room;
  roomSelect: ReactNode;
  focusRequest?: string;
}) {
  const layouts = useLayouts(fixture);
  const [editing, setEditing] = useState<EditRequest | null>(null);

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
    />
  );
}
