// Test-only helpers: tiny hand-built rooms plus the shared fixtures.
import demoNightJson from "../../../fixtures/rooms/demo-night.json";
import dinnerPeakJson from "../../../fixtures/rooms/dinner-peak.json";
import heavySaturdayJson from "../../../fixtures/rooms/heavy-saturday.json";
import nextDayJson from "../../../fixtures/rooms/next-day.json";
import { parseRoom } from "../room";
import type { Area, Reservation, Room, Table, TableAttrs } from "../types";

const NO_ATTRS: TableAttrs = {
  accessible: false,
  strollerSpace: false,
  quiet: false,
  view: false,
  booth: false,
};

export type TableOver = Partial<Omit<Table, "attrs">> & { attrs?: Partial<TableAttrs> };

export function table(id: string, over: TableOver = {}): Table {
  const { attrs, ...rest } = over;
  return {
    id,
    area: "Main",
    section: 1,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    shape: "rect",
    maxExtraChairs: 0,
    minSeats: 1,
    seats: 4,
    joinable: true,
    status: "open",
    ...rest,
    attrs: { ...NO_ATTRS, ...attrs },
  };
}

export function area(name: string, over: Partial<Area> = {}): Area {
  return { id: name, name, kind: "dining", x: 0, y: 0, w: 1, h: 1, spareSlots: 0, ...over };
}

/** Builds a room; any table area not listed in `areas` is added as a plain dining area. */
export function room(
  over: Partial<Omit<Room, "inventory">> & {
    tables: Table[];
    inventory?: Partial<Room["inventory"]>;
  },
): Room {
  const { inventory, ...rest } = over;
  const areas = [...(over.areas ?? [])];
  for (const t of over.tables) if (!areas.some((a) => a.name === t.area)) areas.push(area(t.area));
  return {
    id: "test",
    name: "Test room",
    clock: "19:00",
    joins: [],
    combos: [],
    reservations: [],
    ...rest,
    areas,
    inventory: { extenders: 4, spareChairs: 12, spareTables: [], ...inventory },
  };
}

export function res(
  id: string,
  time: string,
  partySize: number,
  over: Partial<Reservation> = {},
): Reservation {
  return { id, time, partySize, needs: [], ...over };
}

/** A straight chain of joins: T1-T2, T2-T3, ... */
export function chain(...ids: string[]): [string, string][] {
  return ids.slice(1).map((id, i) => [ids[i] as string, id]);
}

/** Ids T{from}..T{to}. */
export function ids(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `T${from + i}`);
}

export const dinnerPeak = (): Room => parseRoom(structuredClone(dinnerPeakJson));
export const nextDay = (): Room => parseRoom(structuredClone(nextDayJson));
export const heavySaturday = (): Room => parseRoom(structuredClone(heavySaturdayJson));
export const demoNight = (): Room => parseRoom(structuredClone(demoNightJson));
export const rawDinnerPeak = (): unknown => structuredClone(dinnerPeakJson);
