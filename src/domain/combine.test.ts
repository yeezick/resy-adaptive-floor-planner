import { describe, expect, it } from "vitest";
import { chain, dinnerPeak, room, table } from "./__fixtures__/build";
import {
  applyCombine,
  applyMove,
  applySplit,
  checkCombine,
  comboOf,
  combinedSeats,
  isConnected,
  MAX_COMBO,
} from "./combine";

describe("combinedSeats", () => {
  it("a single table keeps its seats", () => {
    expect(combinedSeats([table("T1", { seats: 6 })])).toBe(6);
    expect(combinedSeats([])).toBe(0);
  });

  it("2-tops pushed together keep every seat", () => {
    const twos = ["T1", "T2", "T3", "T4"].map((id) => table(id, { seats: 2 }));
    expect(combinedSeats(twos)).toBe(8);
    expect(combinedSeats(twos.slice(0, 2))).toBe(4);
  });

  it("any join involving a larger table loses 2 seats per join", () => {
    const fours = ["T1", "T2", "T3"].map((id) => table(id, { seats: 4 }));
    expect(combinedSeats(fours.slice(0, 2))).toBe(6);
    expect(combinedSeats(fours)).toBe(8);
    // mixed: 2-top + 4-top
    expect(combinedSeats([table("T1", { seats: 2 }), table("T2", { seats: 4 })])).toBe(4);
  });
});

describe("isConnected", () => {
  const r = room({
    tables: ["T1", "T2", "T3", "T4"].map((id) => table(id)),
    joins: chain("T1", "T2", "T3"),
  });

  it("is false for an empty list", () => {
    expect(isConnected(r, [])).toBe(false);
  });

  it("follows chains in any order", () => {
    expect(isConnected(r, ["T3", "T1", "T2"])).toBe(true);
    expect(isConnected(r, ["T1"])).toBe(true);
  });

  it("is false when a member is not reachable", () => {
    expect(isConnected(r, ["T1", "T3"])).toBe(false);
    expect(isConnected(r, ["T3", "T4"])).toBe(false);
  });
});

describe("checkCombine", () => {
  const r = room({
    tables: [
      ...["T1", "T2", "T3", "T4", "T5", "T6", "T7"].map((id) => table(id)),
      table("T8", { shape: "booth", joinable: false }),
      table("T9", { status: "blocked" }),
      table("T10", { area: "Patio" }),
      table("T11"),
    ],
    joins: [
      ...chain("T1", "T2", "T3", "T4", "T5", "T6", "T7"),
      ["T7", "T8"],
      ["T1", "T9"],
      ["T1", "T10"],
    ],
  });

  it("rejects duplicate ids", () => {
    expect(checkCombine(r, ["T1", "T1"])).toEqual({ ok: false, reason: "a table is listed twice" });
  });

  it("rejects fewer than two tables", () => {
    expect(checkCombine(r, ["T1"])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/at least two/),
    });
    expect(checkCombine(r, [])).toMatchObject({ ok: false });
  });

  it(`rejects more than MAX_COMBO (${MAX_COMBO}) tables`, () => {
    expect(checkCombine(r, ["T1", "T2", "T3", "T4", "T5", "T6", "T7"])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/at most 6/),
    });
    expect(checkCombine(r, ["T1", "T2", "T3", "T4", "T5", "T6"])).toMatchObject({ ok: true });
  });

  it("rejects unknown tables", () => {
    expect(checkCombine(r, ["T1", "T99"])).toMatchObject({
      ok: false,
      reason: "table T99 does not exist",
    });
  });

  it("rejects non-joinable tables", () => {
    expect(checkCombine(r, ["T7", "T8"])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/T8 \(booth\) cannot be joined/),
    });
  });

  it("rejects blocked tables", () => {
    expect(checkCombine(r, ["T1", "T9"])).toMatchObject({ ok: false, reason: "T9 is blocked" });
  });

  it("rejects tables in different areas even if joined", () => {
    expect(checkCombine(r, ["T1", "T10"])).toMatchObject({
      ok: false,
      reason: "tables are in different areas",
    });
  });

  it("rejects tables that are not next to each other", () => {
    expect(checkCombine(r, ["T1", "T3"])).toMatchObject({
      ok: false,
      reason: "tables are not next to each other",
    });
    expect(checkCombine(r, ["T1", "T11"])).toMatchObject({ ok: false });
  });

  it("accepts a legal combine and reports seats", () => {
    expect(checkCombine(r, ["T2", "T1"])).toEqual({ ok: true, seats: 6 });
    expect(checkCombine(r, ["T1", "T2", "T3"])).toEqual({ ok: true, seats: 8 });
  });

  it("rejects a blocked table in the fixture's private rooms", () => {
    expect(checkCombine(dinnerPeak(), ["T57", "T58"])).toMatchObject({
      ok: false,
      reason: "T57 is blocked",
    });
  });

  it("allows occupied tables (availability is the caller's job)", () => {
    const occ = dinnerPeak();
    expect(checkCombine(occ, ["T7", "T8", "T9", "T10"])).toEqual({ ok: true, seats: 8 });
  });
});

describe("applyCombine / applySplit / applyMove", () => {
  const base = () =>
    room({
      tables: ["T1", "T2", "T3", "T4"].map((id) => table(id)),
      joins: chain("T1", "T2", "T3", "T4"),
    });

  it("applyCombine adds a combo without mutating the input", () => {
    const r = base();
    const snapshot = structuredClone(r);
    const ids = ["T1", "T2"];
    const next = applyCombine(r, ids);
    expect(next.combos).toEqual([["T1", "T2"]]);
    expect(r).toEqual(snapshot);
    expect(next).not.toBe(r);
    ids.push("T3");
    expect(next.combos[0]).toEqual(["T1", "T2"]);
    expect(comboOf(next, "T2")).toEqual(["T1", "T2"]);
    expect(comboOf(next, "T3")).toBeUndefined();
  });

  it("applyCombine enforces checkCombine", () => {
    expect(() => applyCombine(base(), ["T1", "T3"])).toThrow("tables are not next to each other");
    expect(() => applyCombine(base(), ["T1"])).toThrow(/at least two/);
  });

  it("applyCombine refuses a table that is already combined", () => {
    const once = applyCombine(base(), ["T1", "T2"]);
    expect(() => applyCombine(once, ["T2", "T3"])).toThrow(
      "T2 is already combined; split it first",
    );
    expect(applyCombine(once, ["T3", "T4"]).combos).toHaveLength(2);
  });

  it("applySplit removes only the combo containing the table, immutably", () => {
    const two = applyCombine(applyCombine(base(), ["T1", "T2"]), ["T3", "T4"]);
    const snapshot = structuredClone(two);
    const next = applySplit(two, "T2");
    expect(next.combos).toEqual([["T3", "T4"]]);
    expect(two).toEqual(snapshot);
  });

  it("applySplit throws when the table is not combined", () => {
    expect(() => applySplit(base(), "T1")).toThrow("T1 is not part of a combo");
  });

  it("applyMove repositions one table immutably", () => {
    const r = base();
    const snapshot = structuredClone(r);
    const next = applyMove(r, "T2", 10, 20);
    expect(next.tables.find((t) => t.id === "T2")).toMatchObject({ x: 10, y: 20 });
    expect(next.tables.find((t) => t.id === "T1")).toBe(r.tables[0]);
    expect(r).toEqual(snapshot);
  });

  it("applyMove throws for an unknown table", () => {
    expect(() => applyMove(base(), "T9", 1, 1)).toThrow("table T9 does not exist");
  });
});
