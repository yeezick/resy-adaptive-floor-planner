import { tableById, type LayoutChange, type Room, type Table } from "../../domain";
import { normaliseDivider, union } from "./geometry";

/** Divider keys a proposal opens (from "Open the divider A | B"). */
export function openedDividers(changes: readonly LayoutChange[]): string[] {
  return changes
    .filter((c) => c.kind === "open-divider")
    .map((c) => normaliseDivider(c.text.replace(/^Open the divider /, "")));
}

/** Ghosts and arrows drawn under the tables: where moved tables came from. */
export function ChangeUnderlay({
  room,
  changes,
}: {
  room: Room;
  changes: readonly LayoutChange[];
}) {
  return (
    <g className="changes-under" aria-hidden="true">
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
        </marker>
      </defs>
      {changes
        .filter((c) => c.kind === "join")
        .map((c) => {
          const ts = c.tables.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
          if (!ts.length) return null;
          const b = union(ts, 0.9);
          return (
            <rect
              key={`join-${c.tables.join("+")}`}
              className="change-join"
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={0.9}
            />
          );
        })}
      {changes
        .filter((c) => c.kind === "move" && c.from && c.to)
        .map((c) => {
          const t = tableById(room, c.tables[0] ?? "");
          if (!t || !c.from || !c.to) return null;
          const fx = c.from.x + t.w / 2;
          const fy = c.from.y + t.h / 2;
          const tx = c.to.x + t.w / 2;
          const ty = c.to.y + t.h / 2;
          return (
            <g key={`move-${t.id}`}>
              <rect
                className="change-ghost"
                x={c.from.x}
                y={c.from.y}
                width={t.w}
                height={t.h}
                rx={0.3}
              />
              <line
                className="change-arrow"
                x1={fx}
                y1={fy}
                x2={tx}
                y2={ty}
                markerEnd="url(#arrow)"
              />
            </g>
          );
        })}
    </g>
  );
}

/** Labels drawn over the tables: tables brought out of storage. */
export function ChangeOverlay({ room, changes }: { room: Room; changes: readonly LayoutChange[] }) {
  return (
    <g className="changes-over" aria-hidden="true">
      {changes
        .filter((c) => c.kind === "pull-table")
        .map((c) => {
          const t = tableById(room, c.tables[0] ?? "");
          if (!t) return null;
          return (
            <g key={`pull-${t.id}`} className="change-pull">
              <rect x={t.x - 0.3} y={t.y - 0.3} width={t.w + 0.6} height={t.h + 0.6} rx={0.5} />
              <text x={t.x + t.w / 2} y={t.y + t.h + 1.1}>
                from storage
              </text>
            </g>
          );
        })}
    </g>
  );
}
