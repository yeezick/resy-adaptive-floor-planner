import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ActivitySeed, buildActivity } from "../../domain/activity";
import { actorsOf } from "./ActivityPage";

const seed = ActivitySeed.parse(
  JSON.parse(readFileSync("fixtures/activity/week.json", "utf8")) as unknown,
);
const rows = buildActivity(seed.events, seed.actions);

describe("activity actors", () => {
  it("a triage the manager decided reads AI triage → Manager", () => {
    const r = rows.find((x) => x.refId === "P1");
    expect(r && actorsOf(r)).toEqual(["AI triage", "Manager"]);
  });
  it("a pending triage is the AI step alone", () => {
    const r = rows.find((x) => x.refId === "P5");
    expect(r && actorsOf(r)[0]).toBe("AI triage");
    expect(r && actorsOf(r)).not.toContain("Manager");
  });
  it("an AI Planner option the validator rejected names Capacity check", () => {
    const r = rows.find((x) => x.flags.includes("validator-reject") && x.source === "host");
    expect(r && actorsOf(r)).toContain("Capacity check");
    expect(r && actorsOf(r)[0]).toBe("AI Planner");
  });
});

describe("feedback reasons", () => {
  it("are dropped when a 👎 row is re-rated 👍", async () => {
    const { activityActions, getActivityReasons } = await import("./store");
    activityActions.rate("row-x", "down");
    activityActions.toggleReason("row-x", "Missed need");
    expect(getActivityReasons()["row-x"]).toEqual(["Missed need"]);
    activityActions.rate("row-x", "up");
    expect(getActivityReasons()["row-x"]).toEqual([]);
  });
});
