import { neighbours, tableById } from "./room";
import type { Room, Table } from "./types";

export const MAX_COMBO = 6;
/** Seats each extender leaf adds (two chairs, one per side). */
export const SEATS_PER_EXTENDER = 2;

/**
 * 2-tops pushed side by side keep every seat (four 2-tops seat 8).
 * Any join involving a larger table removes the two end seats where the tables meet.
 */
export function combinedSeats(tables: readonly Table[]): number {
  const sum = tables.reduce((n, t) => n + t.seats, 0);
  if (tables.length <= 1 || tables.every((t) => t.seats <= 2)) return sum;
  return sum - 2 * (tables.length - 1);
}

export function isConnected(room: Room, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  const want = new Set(ids);
  const seen = new Set<string>([ids[0] as string]);
  const queue = [ids[0] as string];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const n of neighbours(room, cur)) {
      if (want.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === want.size;
}

export type CombineCheck = { ok: true; seats: number } | { ok: false; reason: string };

/** Physical legality only (shape, adjacency, area, size). Availability is checked by callers. */
export function checkCombine(room: Room, ids: readonly string[]): CombineCheck {
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "a table is listed twice" };
  if (ids.length < 2) return { ok: false, reason: "a combine needs at least two tables" };
  if (ids.length > MAX_COMBO)
    return { ok: false, reason: `at most ${MAX_COMBO} tables can be joined` };
  const tables: Table[] = [];
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) return { ok: false, reason: `table ${id} does not exist` };
    if (!t.joinable) return { ok: false, reason: `${id} (${t.shape}) cannot be joined` };
    if (t.status === "blocked") return { ok: false, reason: `${id} is blocked` };
    tables.push(t);
  }
  if (new Set(tables.map((t) => t.area)).size > 1)
    return { ok: false, reason: "tables are in different areas" };
  if (!isConnected(room, ids)) return { ok: false, reason: "tables are not next to each other" };
  return { ok: true, seats: combinedSeats(tables) };
}

export function comboOf(room: Room, id: string): string[] | undefined {
  return room.combos.find((c) => c.includes(id));
}

/** Manual control: push tables together. Returns a new room; never mutates. */
export function applyCombine(room: Room, ids: readonly string[]): Room {
  const check = checkCombine(room, ids);
  if (!check.ok) throw new Error(check.reason);
  for (const id of ids)
    if (comboOf(room, id)) throw new Error(`${id} is already combined; split it first`);
  return { ...room, combos: [...room.combos, [...ids]] };
}

/** Manual control: split the combo containing the given table. */
export function applySplit(room: Room, id: string): Room {
  if (!comboOf(room, id)) throw new Error(`${id} is not part of a combo`);
  return { ...room, combos: room.combos.filter((c) => !c.includes(id)) };
}

/** Manual control: move a table on the floor plan. */
export function applyMove(room: Room, id: string, x: number, y: number): Room {
  if (!tableById(room, id)) throw new Error(`table ${id} does not exist`);
  return { ...room, tables: room.tables.map((t) => (t.id === id ? { ...t, x, y } : t)) };
}
