import { describe, expect, it } from "vitest";
import type { Table } from "../domain";
import { mergeClientRoom } from "./clientRoom";
import { TEST_ROOM as fixture } from "./testRoom";

const clone = () => structuredClone(fixture);

describe("mergeClientRoom (edited layouts)", () => {
  it("accepts added, removed, moved and re-specified tables plus edited joins, storage and book", () => {
    const room = clone();
    room.tables = room.tables.filter((t) => t.id !== "T22");
    room.joins = room.joins.filter((j) => !j.includes("T22"));
    const t12 = room.tables.find((t) => t.id === "T12");
    if (t12)
      Object.assign(t12, { x: 99, seats: 6, shape: "round", joinable: false, area: "Patio" });
    room.joins = room.joins.filter((j) => !j.includes("T12"));
    room.tables.push({
      ...structuredClone(room.tables[1] as Table),
      id: "T200",
      status: "open",
      reservedAt: undefined,
    });
    room.joins.push(["T28", "T200"]);
    room.inventory.spareChairs = 10;
    room.reservations.push({ id: "R2", time: "21:00", partySize: 8, needs: [] });
    const r = mergeClientRoom(fixture, room);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.room.tables.find((t) => t.id === "T12")).toMatchObject({
      x: 99,
      seats: 6,
      shape: "round",
    });
    expect(r.room.tables.some((t) => t.id === "T200")).toBe(true);
    expect(r.room.tables.some((t) => t.id === "T22")).toBe(false);
  });

  it("rejects an unknown room or a different room id", () => {
    expect(mergeClientRoom(undefined, fixture)).toMatchObject({ ok: false });
    expect(mergeClientRoom(fixture, { ...clone(), id: "other" })).toMatchObject({
      ok: false,
      error: "room id does not match roomId",
    });
  });

  it("rejects anything parseRoom rejects", () => {
    const longName = { ...clone(), name: "x".repeat(49) };
    expect(mergeClientRoom(fixture, longName)).toMatchObject({ ok: false });
    const badJoin = clone();
    badJoin.joins.push(["T12", "T999"]);
    expect(mergeClientRoom(fixture, badJoin)).toMatchObject({ ok: false });
    const badId = clone();
    (badId.tables[0] as { id: string }).id = "seat-everyone";
    expect(mergeClientRoom(fixture, badId)).toMatchObject({ ok: false });
    const dup = clone();
    dup.tables.push(structuredClone(dup.tables[0] as Table));
    expect(mergeClientRoom(fixture, dup)).toMatchObject({ ok: false });
    expect(mergeClientRoom(fixture, null)).toMatchObject({ ok: false });
  });
});
