import { adjacentRooms, tableById, type Area, type Room, type Table } from "../../domain";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function union(boxes: Box[], pad = 0): Box {
  const minX = Math.min(...boxes.map((b) => b.x)) - pad;
  const minY = Math.min(...boxes.map((b) => b.y)) - pad;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Order-independent id for the wall between two private rooms (by area name). */
export function dividerKey(a: string, b: string): string {
  return [a, b].sort().join(" | ");
}

export interface Suite {
  id: string;
  rooms: Area[];
  box: Box;
}

export function suites(room: Room): Suite[] {
  const bySuite = new Map<string, Area[]>();
  for (const a of room.areas) {
    if (a.kind !== "private" || !a.suite) continue;
    bySuite.set(a.suite, [...(bySuite.get(a.suite) ?? []), a]);
  }
  return [...bySuite.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, rooms]) => {
      const sorted = [...rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return { id, rooms: sorted, box: union(sorted) };
    });
}

export interface Divider {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Walls between neighbouring rooms of a suite, drawn midway across the gap. */
export function dividers(room: Room): Divider[] {
  const out: Divider[] = [];
  for (const s of suites(room)) {
    for (let i = 1; i < s.rooms.length; i++) {
      const a = s.rooms[i - 1] as Area;
      const b = s.rooms[i] as Area;
      if (!adjacentRooms(room, a.name, b.name)) continue;
      const side = a.x + a.w <= b.x;
      if (side) {
        const x = (a.x + a.w + b.x) / 2;
        out.push({
          key: dividerKey(a.name, b.name),
          x1: x,
          x2: x,
          y1: Math.min(a.y, b.y),
          y2: Math.max(a.y + a.h, b.y + b.h),
        });
      } else {
        const y = (a.y + a.h + b.y) / 2;
        out.push({
          key: dividerKey(a.name, b.name),
          y1: y,
          y2: y,
          x1: Math.min(a.x, b.x),
          x2: Math.max(a.x + a.w, b.x + b.w),
        });
      }
    }
  }
  return out;
}

/** Dividers that must open to seat one party across these tables' rooms. */
export function dividersForTables(room: Room, ids: readonly string[]): string[] {
  const names = [
    ...new Set(ids.map((id) => tableById(room, id)?.area).filter((a): a is string => !!a)),
  ];
  const out: string[] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i] as string;
      const b = names[j] as string;
      if (adjacentRooms(room, a, b)) out.push(dividerKey(a, b));
    }
  return out;
}

/** Normalise "A | B" strings from the build plan to divider keys. */
export function normaliseDivider(label: string): string {
  const [a = "", b = ""] = label.split(" | ");
  return dividerKey(a, b);
}

export interface SectionBox {
  section: number;
  box: Box;
}

/** Server sections on the shared floor (dining areas only; a private room is its own section). */
export function sectionBoxes(room: Room): SectionBox[] {
  const dining = new Set(room.areas.filter((a) => a.kind === "dining").map((a) => a.name));
  const bySection = new Map<number, Table[]>();
  for (const t of room.tables) {
    if (!dining.has(t.area)) continue;
    bySection.set(t.section, [...(bySection.get(t.section) ?? []), t]);
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => a - b)
    .map(([section, ts]) => ({ section, box: union(ts, 0.8) }));
}

/** "all", "main" (everything but the private wing), "area:<id>" or "suite:<id>". */
export type ViewPreset = string;

/** Grid units reserved right of private rooms for their captions. */
export const CAPTION_BAND = 14;

/** One tab per dining room, one per private suite, then the whole room. */
export function roomTabs(room: Room): { id: ViewPreset; label: string }[] {
  const tabs: { id: ViewPreset; label: string }[] = [];
  for (const a of room.areas)
    if (a.kind === "dining" && room.tables.some((t) => t.area === a.name))
      tabs.push({ id: `area:${a.id}`, label: a.name });
  for (const s of suites(room)) tabs.push({ id: `suite:${s.id}`, label: `${s.id} suite` });
  tabs.push({ id: "all", label: "Whole room" });
  return tabs;
}

/** The tab that shows these tables: their suite, their dining area, or the whole room. */
export function tabForTables(room: Room, ids: readonly string[]): ViewPreset {
  const areas = [...new Set(ids.map((id) => room.tables.find((t) => t.id === id)?.area))];
  const found = areas.map((n) => room.areas.find((a) => a.name === n));
  if (!found.length || found.some((a) => !a)) return "all";
  const suite = found[0]?.suite;
  if (suite && found.every((a) => a?.kind === "private" && a.suite === suite))
    return `suite:${suite}`;
  if (found.length === 1 && found[0]?.kind === "dining") return `area:${found[0].id}`;
  return "all";
}

/** Tablet-width screens open on a single room so tables stay legible; wide screens see it all. */
export function defaultTab(room: Room, width: number): ViewPreset {
  return width <= 1280 ? (roomTabs(room)[0]?.id ?? "all") : "all";
}

export function viewBox(room: Room, preset: ViewPreset): Box {
  const areas = preset.startsWith("suite:")
    ? room.areas.filter((a) => a.kind === "private" && a.suite === preset.slice(6))
    : preset.startsWith("area:")
      ? room.areas.filter((a) => a.id === preset.slice(5))
      : preset === "main"
        ? room.areas.filter((a) => a.kind !== "private")
        : room.areas;
  const boxes: Box[] = areas.length ? areas : room.tables;
  // Extra headroom above for area / suite labels.
  const b = union(boxes, 1);
  // private-room captions sit in a band to the right of the rooms, never over tables
  const band = areas.some((a) => a.kind === "private") ? CAPTION_BAND : 0;
  return { x: b.x, y: b.y - 3.5, w: b.w + band, h: b.h + 3.5 };
}
