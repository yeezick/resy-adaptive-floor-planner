import { describe, expect, it } from "vitest";
import { loadRequestBook } from "../src/server/requests";
import { loadRooms } from "../src/server/rooms";
import { runPlanChecks } from "./plan-checks";

describe("plan checks (holds · section · aisle · can't-fit)", () => {
  const checks = runPlanChecks(loadRooms(), loadRequestBook());

  it("all pass on the fixtures and requests", () => {
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("cover all four kinds, every request and the demo night", () => {
    for (const k of ["holds", "section", "aisle", "cant-fit"])
      expect(checks.some((c) => c.check === k)).toBe(true);
    for (const id of ["Q1", "Q2", "Q3", "Q4"])
      expect(checks.some((c) => c.case === `request/${id}`)).toBe(true);
    expect(checks.some((c) => c.case === "demo-night/D11" && c.check === "cant-fit")).toBe(true);
  });
});
