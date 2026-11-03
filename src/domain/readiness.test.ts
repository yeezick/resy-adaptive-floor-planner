import { describe, expect, it } from "vitest";
import { dinnerPeak, room, table } from "./__fixtures__/build";
import { REMAINING_MIN, RESET_MIN } from "./phases";
import { joinReadiness, readinessBadge, readinessPill } from "./readiness";

describe("readiness of a proposed join (from meal phase, est.)", () => {
  it("is Ready when every table is free now", () => {
    const r = room({
      tables: [table("T1"), table("T2", { status: "reserved", reservedAt: "20:00" })],
    });
    const j = joinReadiness(r, ["T1", "T2"]);
    expect(j.ready).toBe(true);
    expect(j.tables.map(readinessBadge)).toEqual(["now", "now"]);
    expect(readinessPill(j)).toBe("capacity fit ✓ · Ready");
  });

  it("waits for the slowest table and shows each table's stage", () => {
    const r = room({
      tables: [
        table("T1"),
        table("T2", { status: "occupied", phase: "dessert", partySize: 2 }),
        table("T3", { status: "occupied", phase: "entrees", partySize: 4 }),
      ],
    });
    const j = joinReadiness(r, ["T1", "T2", "T3"]);
    const entrees = REMAINING_MIN.entrees + RESET_MIN;
    expect(j.ready).toBe(false);
    expect(j.readyInMin).toBe(entrees);
    expect(j.tables.map((t) => t.phase)).toEqual([null, "dessert", "entrees"]);
    expect(j.tables.map(readinessBadge)).toEqual([
      "now",
      `~${REMAINING_MIN.dessert + RESET_MIN}m`,
      `~${entrees}m`,
    ]);
    expect(readinessPill(j)).toBe(`capacity fit ✓ · ready to set up in ~${entrees} min`);
  });

  it("skips spare tables from storage and says when a table is blocked", () => {
    const r = room({ tables: [table("T1"), table("T2", { status: "blocked" })] });
    expect(joinReadiness(r, ["T1", "S9"]).tables.map((t) => t.id)).toEqual(["T1"]);
    const j = joinReadiness(r, ["T1", "T2"]);
    expect(j.readyInMin).toBeNull();
    expect(j.tables.map(readinessBadge)).toEqual(["now", "blocked"]);
    expect(readinessPill(j)).toBe("capacity fit ✓ · a table is blocked this service");
  });

  it("works on a live-service night", () => {
    const r = dinnerPeak();
    const seated = r.tables.filter((t) => t.status === "occupied").map((t) => t.id);
    const j = joinReadiness(r, seated.slice(0, 3));
    expect(j.ready).toBe(false);
    expect(j.tables.every((t) => (t.minutes ?? 0) > 0)).toBe(true);
  });
});
