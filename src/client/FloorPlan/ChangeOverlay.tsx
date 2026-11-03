import { tableById, type LayoutChange, type Room, type Table } from "../../domain";
import { normaliseDivider, union, type Box } from "./geometry";
import { usePx } from "./scale";

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

/** Badge above a group of tables: "3 moved" or "2 from storage" (≥11px on screen). */
function Badge({
  box,
  text,
  cls,
  below,
}: {
  box: Box;
  text: string;
  cls: string;
  below?: boolean;
}) {
  const px = usePx();
  const font = Math.max(0.85, px(11));
  const h = font * 1.4;
  const w = text.length * 0.58 * font + font;
  const x = box.x + box.w / 2 - w / 2;
  const y = below ? box.y + box.h + 0.3 : box.y - h - 0.3;
  return (
    <g className={`change-badge ${cls}`}>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} />
      <text x={x + w / 2} y={y + h / 2} fontSize={font}>
        {text}
      </text>
    </g>
  );
}

/** Tables touched by one kind of change, grouped per party (one badge per row group). */
function groups(room: Room, changes: readonly LayoutChange[], kind: LayoutChange["kind"]) {
  const byParty = new Map<string, Table[]>();
  for (const c of changes) {
    if (c.kind !== kind) continue;
    const ts = c.tables.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
    byParty.set(c.reservationId, [...(byParty.get(c.reservationId) ?? []), ...ts]);
  }
  return [...byParty.entries()].map(([party, tables]) => ({ party, tables, box: union(tables) }));
}

/** Drawn over the tables: storage pulls outlined, one badge per party for moves and pulls. */
export function ChangeOverlay({ room, changes }: { room: Room; changes: readonly LayoutChange[] }) {
  const pulled = groups(room, changes, "pull-table");
  const moved = groups(room, changes, "move");
  const joined = (party: string) =>
    new Set(
      changes
        .filter((c) => c.kind === "join" && c.reservationId === party)
        .flatMap((c) => c.tables),
    ).size;
  return (
    <g className="changes-over" aria-hidden="true">
      {pulled.map((g) => (
        <g key={`pull-${g.party}`} className="change-pull">
          {g.tables.map((t) => (
            // inset, so the outline never runs over a neighbour's label
            <rect
              key={t.id}
              x={t.x + 0.25}
              y={t.y + 0.25}
              width={t.w - 0.5}
              height={t.h - 0.5}
              rx={0.3}
            />
          ))}
        </g>
      ))}
      {moved.map((g) => (
        <Badge
          key={`moved-${g.party}`}
          box={g.box}
          text={
            joined(g.party) > g.tables.length
              ? `${joined(g.party)} joined · ${g.tables.length} moved`
              : g.tables.length > 1
                ? `${g.tables.length} moved`
                : "moved"
          }
          cls="is-move"
        />
      ))}
      {pulled.map((g) => (
        <Badge
          key={`pullb-${g.party}`}
          box={g.box}
          below
          text={`${g.tables.length} from storage`}
          cls="is-pull"
        />
      ))}
    </g>
  );
}
