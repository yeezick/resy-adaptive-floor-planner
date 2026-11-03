import { useState } from "react";
import { parseRoom, type Room } from "../../domain";

/** A named floor layout. The base is the fixture and is never stored or overwritten. */
export interface Layout {
  id: string;
  name: string;
  kind: "base" | "variant";
  /** One-day variants: the date and shift window they were made for. */
  date?: string;
  shift?: string;
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
  remove: (id: string) => void;
}

const BASE_ID = "base";
const key = (roomId: string) => `afp.layouts.v1.${roomId}`;

interface Stored {
  variants: Layout[];
  activeId: string;
}

function load(fixture: Room): Stored {
  try {
    const raw = window.localStorage.getItem(key(fixture.id));
    if (!raw) return { variants: [], activeId: BASE_ID };
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
    return { variants: [], activeId: BASE_ID };
  }
}

function persist(roomId: string, s: Stored): void {
  try {
    window.localStorage.setItem(key(roomId), JSON.stringify(s));
  } catch {
    // storage full or blocked: layouts still work for this session
  }
}

export function tonightName(from: string, to: string, date = new Date()): string {
  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  return `Tonight — ${day} ${from}–${to}`;
}

export function useLayouts(fixture: Room): LayoutsApi {
  const [state, setState] = useState<Stored>(() => load(fixture));
  const [version, setVersion] = useState(0);
  const base: Layout = {
    id: BASE_ID,
    name: "Base layout",
    kind: "base",
    room: fixture,
    savedAt: "",
  };
  const layouts = [base, ...state.variants];
  const active = layouts.find((l) => l.id === state.activeId) ?? base;

  const update = (next: Stored) => {
    setState(next);
    persist(fixture.id, next);
  };

  return {
    layouts,
    active,
    version,
    select: (id) => update({ ...state, activeId: id }),
    save: (room, meta) => {
      const overwrite = meta.id && meta.id !== BASE_ID ? meta.id : undefined;
      const layout: Layout = {
        id: overwrite ?? `L${Date.now().toString(36)}`,
        name: meta.name,
        kind: "variant",
        date: meta.date,
        shift: meta.shift,
        room,
        savedAt: new Date().toISOString(),
      };
      const variants = overwrite
        ? state.variants.map((v) => (v.id === overwrite ? layout : v))
        : [...state.variants, layout];
      update({ variants, activeId: layout.id });
      setVersion((n) => n + 1);
      return layout;
    },
    remove: (id) => {
      if (id === BASE_ID) return;
      update({
        variants: state.variants.filter((v) => v.id !== id),
        activeId: state.activeId === id ? BASE_ID : state.activeId,
      });
    },
  };
}
