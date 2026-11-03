import { describe, expect, it } from "vitest";
import { dinnerPeak, room, table } from "./__fixtures__/build";
import { estimateFreeTime, FRESH_PHASES, REMAINING_MIN, RESET_MIN, sectionLoad } from "./phases";
import { PHASES } from "./types";

describe("estimateFreeTime", () => {
  it("open tables are free now", () => {
    expect(estimateFreeTime(table("T1"))).toEqual({ tableId: "T1", minutes: 0, basis: "open now" });
  });

  it.each(PHASES)("occupied in %s = remaining minutes + reset", (phase) => {
    const ft = estimateFreeTime(table("T1", { status: "occupied", phase }));
    expect(ft.minutes).toBe(REMAINING_MIN[phase] + RESET_MIN);
    expect(ft.basis).toContain(phase);
    expect(ft.basis).toContain(`${RESET_MIN} min reset`);
  });

  it("later phases free up sooner", () => {
    const mins = PHASES.map((p) => REMAINING_MIN[p]);
    for (let i = 1; i < mins.length; i++) expect(mins[i]).toBeLessThan(mins[i - 1] as number);
  });

  it("occupied without a phase falls back to seated (worst case)", () => {
    expect(estimateFreeTime(table("T1", { status: "occupied" })).minutes).toBe(
      REMAINING_MIN.seated + RESET_MIN,
    );
  });

  it("reserved tables are open now but name the hold", () => {
    const ft = estimateFreeTime(table("T1", { status: "reserved", reservedAt: "19:30" }));
    expect(ft.minutes).toBe(0);
    expect(ft.basis).toContain("19:30");
    expect(estimateFreeTime(table("T1", { status: "reserved" })).basis).toContain("a reservation");
  });

  it("blocked tables are never available", () => {
    const ft = estimateFreeTime(table("T1", { status: "blocked" }));
    expect(ft.minutes).toBeNull();
    expect(ft.basis).toMatch(/blocked/);
  });
});

describe("sectionLoad", () => {
  it("counts only occupied tables in seated/drinks in that section", () => {
    const r = room({
      tables: [
        table("T1", { section: 1, status: "occupied", phase: "seated" }),
        table("T2", { section: 1, status: "occupied", phase: "drinks" }),
        table("T3", { section: 1, status: "occupied", phase: "appetizers" }),
        table("T4", { section: 1, status: "occupied", phase: "check" }),
        table("T5", { section: 1, status: "open" }),
        table("T6", { section: 1, status: "reserved", reservedAt: "20:00" }),
        table("T7", { section: 1, status: "blocked" }),
        table("T8", { section: 2, status: "occupied", phase: "seated" }),
        // phase set on a non-occupied table must not count
        table("T9", { section: 1, status: "open", phase: "seated" }),
        // occupied without phase does not count
        table("T10", { section: 1, status: "occupied" }),
      ],
    });
    expect(sectionLoad(r, 1)).toBe(2);
    expect(sectionLoad(r, 2)).toBe(1);
    expect(sectionLoad(r, 3)).toBe(0);
  });

  it("agrees with a direct count on the dinner-peak fixture", () => {
    const r = dinnerPeak();
    const sections = [...new Set(r.tables.map((t) => t.section))];
    for (const s of sections) {
      const direct = r.tables.filter(
        (t) =>
          t.section === s &&
          t.status === "occupied" &&
          (t.phase === "seated" || t.phase === "drinks"),
      ).length;
      expect(sectionLoad(r, s)).toBe(direct);
    }
    expect(sections.some((s) => sectionLoad(r, s) >= 2)).toBe(true);
    expect(FRESH_PHASES).toEqual(["seated", "drinks"]);
  });
});
