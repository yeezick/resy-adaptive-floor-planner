import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom, type Room } from "../../domain";
import { intersects } from "../FloorPlan/geometry";
import { addTable, duplicate } from "./edit";

const base = parseRoom(JSON.parse(readFileSync("fixtures/rooms/next-day.json", "utf8")) as unknown);

const overlaps = (room: Room) =>
  room.tables.some((a, i) => room.tables.some((b, j) => j > i && intersects(a, b)));

describe("editor: adding tables never overlaps", () => {
  it("adding many tables at one spot keeps every table apart", () => {
    let room = base;
    const near = { x: base.tables[0]?.x ?? 0, y: base.tables[0]?.y ?? 0 };
    for (let i = 0; i < 60; i++) room = addTable(room, near).room;
    expect(overlaps(room)).toBe(false);
  });

  it("a full layout still places the new table clear of the others (past the edge)", () => {
    // a room packed with 4×4 tables over a wide block: no free spot near the start
    const packed: Room = {
      ...base,
      tables: Array.from({ length: 900 }, (_, i) => ({
        ...(base.tables[0] as Room["tables"][number]),
        id: `T${1000 + i}`,
        x: (i % 30) * 4.5,
        y: Math.floor(i / 30) * 4.5,
        w: 4,
        h: 4,
      })),
    };
    const { room, id } = addTable(packed, { x: 60, y: 60 });
    const added = room.tables.find((t) => t.id === id);
    expect(added).toBeDefined();
    expect(room.tables.filter((t) => t.id !== id).some((t) => added && intersects(added, t))).toBe(
      false,
    );
  });

  it("duplicating tables keeps them apart", () => {
    const ids = base.tables.slice(0, 5).map((t) => t.id);
    expect(overlaps(duplicate(base, ids).room)).toBe(false);
  });
});
