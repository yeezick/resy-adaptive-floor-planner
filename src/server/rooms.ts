// Room fixtures, loaded once and validated with parseRoom. Paths resolve from process.cwd() so the same code
// works under `tsx watch` (dev) and from the Vite SSR bundle at dist/server/index.js (prod).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseRoom, type Room } from "../domain";
import type { RoomSummary } from "../shared/api";

export function fixturesDir(): string {
  return path.resolve(process.cwd(), process.env.FIXTURES_DIR ?? "fixtures/rooms");
}

let cache: Map<string, Room> | undefined;

export function loadRooms(dir = fixturesDir()): Map<string, Room> {
  const rooms = new Map<string, Room>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const room = parseRoom(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    if (rooms.has(room.id)) throw new Error(`duplicate room id ${room.id} in ${file}`);
    rooms.set(room.id, room);
  }
  return rooms;
}

export function rooms(): Map<string, Room> {
  cache ??= loadRooms();
  return cache;
}

export function getRoom(id: string): Room | undefined {
  return rooms().get(id);
}

export function roomSummaries(): RoomSummary[] {
  return [...rooms().values()].map((r) => ({ id: r.id, name: r.name, clock: r.clock }));
}
