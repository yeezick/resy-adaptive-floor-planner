import { describe, expect, it } from "vitest";
import { tonightName } from "./layouts/useLayouts";
import { NIGHTS, nightDate } from "./nights";

describe("night names and dates", () => {
  it("a saved plan is named for the night on screen, not today", () => {
    expect(tonightName("17:00", "22:00", "Fri")).toBe("Fri plan — 5:00–10:00 PM");
  });
  it("a night's weekday maps to its date in the demo week", () => {
    expect(nightDate("Fri")).toBe("2026-11-06");
    expect(nightDate("Thu")).toBe("2026-11-05");
  });
  it("night labels are plain and unique", () => {
    const labels = Object.values(NIGHTS).map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l).not.toMatch(/demo|stress|empty room/i);
  });
});
