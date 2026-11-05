// Joinability edits shared by the layout editor and floor edits by conversation. The planner builds long tables
// from room.joins (never from room.combos), so these decide which tables may be pushed together tonight.
import { neighbours, tableById } from "./room";
import { MAX_NEIGHBOURS, type Room } from "./types";

/** Why two tables can't be made joinable, or null when they can. Doesn't check distance (see sideBySide). */
export function canJoin(room: Room, a: string, b: string): string | null {
  const ta = tableById(room, a);
  const tb = tableById(room, b);
  if (!ta || !tb || a === b) return "pick another table";
  if (ta.shape !== "rect" || tb.shape !== "rect") return "only rectangular tables can join";
  if (!ta.joinable || !tb.joinable) return "both tables must be joinable";
  if (ta.area !== tb.area) return "tables are in different areas";
  if (neighbours(room, a).includes(b)) return "already joinable";
  if (neighbours(room, a).length >= MAX_NEIGHBOURS || neighbours(room, b).length >= MAX_NEIGHBOURS)
    return `a table can have at most ${MAX_NEIGHBOURS} joinable neighbours`;
  return null;
}

/** Add or remove one join edge. Removing it also drops a combo that relied on it. */
export function setJoin(room: Room, a: string, b: string, on: boolean): Room {
  if (on) return canJoin(room, a, b) ? room : { ...room, joins: [...room.joins, [a, b]] };
  return {
    ...room,
    joins: room.joins.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))),
    // a combo that relied on this join is no longer physical
    combos: room.combos.filter((c) => !(c.includes(a) && c.includes(b))),
  };
}
