// Pure layout edits for the floor-plan editor. Each returns a new Room.
import { neighbours, tableById, type Room, type Table } from "../../domain";
import { intersects } from "../FloorPlan/geometry";

export const MAX_NEIGHBOURS = 4;
export const SNAP = 0.5;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;

function nextId(room: Room): () => string {
  let n = Math.max(0, ...room.tables.map((t) => Number(t.id.slice(1))));
  return () => `T${++n}`;
}

function freeSpot(room: Room, w: number, h: number, start: { x: number; y: number }) {
  for (let ring = 0; ring < 30; ring++)
    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const box = { x: snap(start.x + dx * 2), y: snap(start.y + dy * 2), w, h };
        const pad = { x: box.x - 0.5, y: box.y - 0.5, w: w + 1, h: h + 1 };
        if (!room.tables.some((t) => intersects(pad, t))) return box;
      }
  // nothing free near the start: extend the canvas — place it past the right-most table, never on top of one
  const right = Math.max(0, ...room.tables.map((t) => t.x + t.w));
  return { x: snap(right + 2), y: snap(Math.max(0, start.y)), w, h };
}

export function addTable(room: Room, near: { x: number; y: number }): { room: Room; id: string } {
  const area =
    room.areas.find(
      (a) =>
        a.kind === "dining" &&
        near.x >= a.x &&
        near.x <= a.x + a.w &&
        near.y >= a.y &&
        near.y <= a.y + a.h,
    ) ??
    room.areas.find((a) => a.kind === "dining") ??
    room.areas[0];
  const spot = freeSpot(room, 4, 4, near);
  const id = nextId(room)();
  const table: Table = {
    id,
    area: area?.name ?? room.tables[0]?.area ?? "",
    section: room.tables.find((t) => t.area === area?.name)?.section ?? 1,
    x: spot.x,
    y: spot.y,
    w: 4,
    h: 4,
    shape: "rect",
    minSeats: 1,
    maxExtraChairs: 0,
    seats: 4,
    joinable: true,
    attrs: { accessible: false, strollerSpace: false, quiet: false, view: false, booth: false },
    status: "open",
  };
  return { room: { ...room, tables: [...room.tables, table] }, id };
}

export function duplicate(room: Room, ids: readonly string[]): { room: Room; ids: string[] } {
  const make = nextId(room);
  const copies: Table[] = [];
  let next = room;
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) continue;
    const spot = freeSpot(next, t.w, t.h, { x: t.x + t.w + 1, y: t.y });
    const copy: Table = {
      ...t,
      id: make(),
      x: spot.x,
      y: spot.y,
      status: "open",
      phase: undefined,
      partySize: undefined,
      reservedAt: undefined,
    };
    copies.push(copy);
    next = { ...next, tables: [...next.tables, copy] };
  }
  return { room: next, ids: copies.map((c) => c.id) };
}

export function removeTables(room: Room, ids: readonly string[]): Room {
  const gone = new Set(ids);
  return {
    ...room,
    tables: room.tables.filter((t) => !gone.has(t.id)),
    joins: room.joins.filter(([a, b]) => !gone.has(a) && !gone.has(b)),
    combos: room.combos.filter((c) => !c.some((id) => gone.has(id))),
  };
}

export function moveTables(room: Room, ids: readonly string[], dx: number, dy: number): Room {
  if (!dx && !dy) return room;
  return {
    ...room,
    tables: room.tables.map((t) =>
      ids.includes(t.id) ? { ...t, x: snap(t.x + dx), y: snap(t.y + dy) } : t,
    ),
  };
}

/** Update one table. Only rectangles can join: other shapes lose their joins and combos. */
export function updateTable(room: Room, id: string, patch: Partial<Table>): Room {
  const next: Room = {
    ...room,
    tables: room.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  const t = tableById(next, id);
  if (t && (t.shape !== "rect" || !t.joinable)) {
    return {
      ...next,
      tables: next.tables.map((x) =>
        x.id === id ? { ...x, joinable: x.shape === "rect" && x.joinable } : x,
      ),
      joins: next.joins.filter(([a, b]) => a !== id && b !== id),
      combos: next.combos.filter((c) => !c.includes(id)),
    };
  }
  return next;
}

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

export function setJoin(room: Room, a: string, b: string, on: boolean): Room {
  if (on) return canJoin(room, a, b) ? room : { ...room, joins: [...room.joins, [a, b]] };
  return {
    ...room,
    joins: room.joins.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))),
    // a combo that relied on this join is no longer physical
    combos: room.combos.filter((c) => !(c.includes(a) && c.includes(b))),
  };
}

/** Tables that could become joinable neighbours of `id`, nearest first. */
export function joinCandidates(room: Room, id: string, limit = 8): Table[] {
  const t = tableById(room, id);
  if (!t) return [];
  const d = (o: Table) => Math.hypot(o.x - t.x, o.y - t.y);
  return room.tables
    .filter((o) => canJoin(room, id, o.id) === null)
    .sort((x, y) => d(x) - d(y))
    .slice(0, limit);
}
