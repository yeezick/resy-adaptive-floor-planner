import { useSyncExternalStore } from "react";
import { applyCombine, checkCombine, parseRoom, times12, type Room } from "../../domain";

/** A named floor layout. The base is the fixture and is never stored or overwritten. */
export interface Layout {
  id: string;
  name: string;
  kind: "base" | "variant";
  /** One-day variants: the date and shift window they were made for. */
  date?: string;
  shift?: string;
  /** How this plan relates to the base, e.g. "Shift plan · from Base layout". */
  note?: string;
  room: Room;
  savedAt: string;
}

export interface LayoutsApi {
  layouts: Layout[];
  active: Layout;
  /** Bumps when the active layout's content changes, so the console remounts. */
  version: number;
  select: (id: string) => void;
  /** Save a room as a layout. Overwrites `id` when given (never the base), else creates one. */
  save: (room: Room, meta: { name: string; id?: string; date?: string; shift?: string }) => Layout;
  /** Delete a layout; `nextActiveId` (if given and still present) becomes the layout in use. */
  remove: (id: string, nextActiveId?: string) => void;
}

const BASE_ID = "base";
const key = (roomId: string) => `afp.layouts.v1.${roomId}`;

interface Stored {
  variants: Layout[];
  activeId: string;
}

/** Join free, joinable neighbours in one area into one long table (up to `max` tables). */
function joinRun(room: Room, area: string, max: number): Room {
  const free = (id: string) => {
    const t = room.tables.find((x) => x.id === id);
    return !!t && t.area === area && t.joinable && (t.status === "open" || t.status === "reserved");
  };
  for (const [a, b] of room.joins) {
    if (!free(a) || !free(b)) continue;
    const run = [a, b];
    for (const [x, y] of room.joins) {
      if (run.length >= max) break;
      const last = run[run.length - 1];
      const next = x === last ? y : y === last ? x : undefined;
      if (next && free(next) && !run.includes(next)) run.push(next);
    }
    if (checkCombine(room, run).ok && !room.combos.some((c) => c.some((id) => run.includes(id))))
      return applyCombine(room, run);
  }
  return room;
}

function nextSaturday(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toLocaleDateString("en-CA");
}

/** Example plans derived from the base, so the list reads as intended before anything is saved. */
function seeds(fixture: Room): Layout[] {
  const dining = fixture.areas.find((a) => a.kind === "dining")?.name ?? "";
  const privateRoom = fixture.areas.find((a) => a.kind === "private")?.name ?? "";
  const weekend = joinRun(joinRun(fixture, dining, 2), dining, 2);
  const event = privateRoom ? joinRun(fixture, privateRoom, 5) : fixture;
  return [
    {
      id: "seed-weekend",
      name: "Weekend dinner",
      kind: "variant",
      shift: "Fri–Sun 17:00–23:00",
      note: "Shift plan · from Base layout · two 2-tops joined for 4s",
      room: weekend,
      savedAt: "",
    },
    {
      id: "seed-event",
      name: "Sat — private event",
      kind: "variant",
      date: nextSaturday(),
      shift: "18:00–23:00",
      note: privateRoom
        ? `One-day edit · from Base layout · ${privateRoom} set as one long table`
        : "One-day edit · from Base layout",
      room: event,
      savedAt: "",
    },
  ];
}

function load(fixture: Room): Stored {
  try {
    const raw = window.localStorage.getItem(key(fixture.id));
    if (!raw) return { variants: seeds(fixture), activeId: BASE_ID };
    const data = JSON.parse(raw) as { variants?: unknown[]; activeId?: unknown };
    const variants: Layout[] = [];
    for (const v of data.variants ?? []) {
      try {
        const l = v as Layout;
        variants.push({ ...l, kind: "variant", room: parseRoom(l.room) });
      } catch {
        // drop layouts that no longer match the room schema
      }
    }
    const activeId =
      typeof data.activeId === "string" && variants.some((v) => v.id === data.activeId)
        ? data.activeId
        : BASE_ID;
    return { variants, activeId };
  } catch {
    return { variants: seeds(fixture), activeId: BASE_ID };
  }
}

function persist(roomId: string, s: Stored): void {
  try {
    window.localStorage.setItem(key(roomId), JSON.stringify(s));
  } catch {
    // storage full or blocked: layouts still work for this session
  }
}

/** A saved tonight plan's name: the night's weekday (from the night on screen), never today's. */
export function tonightName(from: string, to: string, day?: string): string {
  const d = day ?? new Date().toLocaleDateString(undefined, { weekday: "short" });
  return `${d} plan — ${times12(`${from}–${to}`)}`;
}

// One store for every night's layouts, keyed by room id, shared by the night on screen (LayoutHost) and the
// request sheet (which plans a request against ITS night's layout in use, even when another night is on screen).
interface Entry {
  stored: Stored;
  version: number;
}
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function entryFor(fixture: Room): Entry {
  let e = entries.get(fixture.id);
  if (!e) {
    e = { stored: load(fixture), version: 0 };
    entries.set(fixture.id, e);
  }
  return e;
}

function write(fixture: Room, stored: Stored, bump: boolean): void {
  const prev = entryFor(fixture);
  entries.set(fixture.id, { stored, version: prev.version + (bump ? 1 : 0) });
  persist(fixture.id, stored);
  emit();
}

export const layoutsStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** The night's layouts (loaded once from this browser's storage, seeded from the base when empty). */
  entry: entryFor,
  /** The layout in use for this night: a saved variant, or the base fixture itself. */
  active(fixture: Room): Layout {
    const { stored } = entryFor(fixture);
    return stored.variants.find((v) => v.id === stored.activeId) ?? baseLayout(fixture);
  },
  select(fixture: Room, id: string): void {
    write(fixture, { ...entryFor(fixture).stored, activeId: id }, false);
  },
  /** Save a room as a layout (a new one-day layout unless `id` names a variant) and make it the one in use. */
  save(
    fixture: Room,
    room: Room,
    meta: { name: string; id?: string; date?: string; shift?: string; note?: string },
  ): Layout {
    const { stored } = entryFor(fixture);
    const overwrite = meta.id && meta.id !== BASE_ID ? meta.id : undefined;
    const layout: Layout = {
      id: overwrite ?? `L${Date.now().toString(36)}${(++saves).toString(36)}`,
      name: meta.name,
      kind: "variant",
      date: meta.date,
      shift: meta.shift,
      ...(meta.note ? { note: meta.note } : {}),
      room,
      savedAt: new Date().toISOString(),
    };
    const variants = overwrite
      ? stored.variants.map((v) => (v.id === overwrite ? layout : v))
      : [...stored.variants, layout];
    write(fixture, { variants, activeId: layout.id }, true);
    return layout;
  },
  /** Delete a layout; `nextActiveId` (if given and still present) becomes the layout in use. */
  remove(fixture: Room, id: string, nextActiveId?: string): void {
    if (id === BASE_ID) return;
    const { stored } = entryFor(fixture);
    const variants = stored.variants.filter((v) => v.id !== id);
    const keep = (x: string) => x === BASE_ID || variants.some((v) => v.id === x);
    write(
      fixture,
      {
        variants,
        activeId:
          nextActiveId && keep(nextActiveId)
            ? nextActiveId
            : stored.activeId === id
              ? BASE_ID
              : stored.activeId,
      },
      true,
    );
  },
};
let saves = 0;

function baseLayout(fixture: Room): Layout {
  return { id: BASE_ID, name: "Base layout", kind: "base", room: fixture, savedAt: "" };
}

/** Tests only. */
export function resetLayoutsStore(): void {
  entries.clear();
}

export function useLayouts(fixture: Room): LayoutsApi {
  const entry = useSyncExternalStore(layoutsStore.subscribe, () => layoutsStore.entry(fixture));
  const base = baseLayout(fixture);
  const layouts = [base, ...entry.stored.variants];
  const active = layouts.find((l) => l.id === entry.stored.activeId) ?? base;
  return {
    layouts,
    active,
    version: entry.version,
    select: (id) => layoutsStore.select(fixture, id),
    save: (room, meta) => layoutsStore.save(fixture, room, meta),
    remove: (id, nextActiveId) => layoutsStore.remove(fixture, id, nextActiveId),
  };
}
