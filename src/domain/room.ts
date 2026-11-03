import { MAX_NEIGHBOURS, Room, type Table } from "./types";

export function parseRoom(input: unknown): Room {
  const room = Room.parse(input);
  const ids = new Set<string>();
  const areaNames = new Set(room.areas.map((a) => a.name));
  for (const t of room.tables) {
    if (!areaNames.has(t.area)) throw new Error(`${t.id} is in unknown area ${t.area}`);
    if (ids.has(t.id)) throw new Error(`duplicate table id ${t.id}`);
    ids.add(t.id);
    if (t.joinable && t.shape !== "rect")
      throw new Error(`${t.id} is a ${t.shape}; only rectangles join`);
    if (t.status === "occupied" && !t.phase)
      throw new Error(`${t.id} is occupied but has no phase`);
    if (t.status === "reserved" && !t.reservedAt)
      throw new Error(`${t.id} is reserved but has no time`);
  }
  const degree = new Map<string, number>();
  for (const [a, b] of room.joins) {
    if (!ids.has(a) || !ids.has(b)) throw new Error(`join ${a}-${b} names an unknown table`);
    if (a === b) throw new Error(`join ${a}-${b} joins a table to itself`);
    for (const id of [a, b]) {
      const d = (degree.get(id) ?? 0) + 1;
      if (d > MAX_NEIGHBOURS)
        throw new Error(`${id} has more than ${MAX_NEIGHBOURS} joinable neighbours`);
      degree.set(id, d);
    }
  }
  const used = new Set<string>();
  for (const combo of room.combos) {
    for (const id of combo) {
      if (!ids.has(id)) throw new Error(`combo names unknown table ${id}`);
      if (used.has(id)) throw new Error(`table ${id} is in two combos`);
      used.add(id);
    }
  }
  return room;
}

export function tableById(room: Room, id: string): Table | undefined {
  return room.tables.find((t) => t.id === id);
}

export function neighbours(room: Room, id: string): string[] {
  const out: string[] = [];
  for (const [a, b] of room.joins) {
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

export function areaByName(room: Room, name: string) {
  return room.areas.find((a) => a.name === name);
}

/** Two private rooms are neighbours when they share a suite and sit next to each other. */
export function adjacentRooms(room: Room, a: string, b: string): boolean {
  const x = areaByName(room, a);
  const y = areaByName(room, b);
  return (
    !!x?.suite &&
    x.suite === y?.suite &&
    x.order !== undefined &&
    y.order !== undefined &&
    Math.abs(x.order - y.order) === 1
  );
}
