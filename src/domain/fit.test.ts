import { describe, expect, it } from "vitest";
import { area, demoNight, res, room, table } from "./__fixtures__/build";
import { planBuilds } from "./buildplan";
import { checkJoin, checkRows, clearanceFor, VENUE_CLEARANCE, type Clearance } from "./clearance";
import { holdFor, holdLine, partyFits } from "./fit";
import { generateTonight } from "./tonight";

describe("clearance", () => {
  it("loads the venue's per-join data and applies it only to that venue", () => {
    expect(VENUE_CLEARANCE.minAisleIn).toBe(36);
    expect(clearanceFor(demoNight())).toBe(VENUE_CLEARANCE);
    expect(clearanceFor(room({ tables: [table("T1")] }))).toBeNull();
  });

  it("fails a join below the minimum with a one-line reason, and an unmeasured join", () => {
    const bad = checkJoin(VENUE_CLEARANCE, "T44", "T43");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(
      /^joining tables 44 and 43 leaves 32 in of aisle \(needs 36 in\) — /,
    );
    const unknown = checkJoin(VENUE_CLEARANCE, "T1", "T99");
    expect(unknown).toMatchObject({ ok: false, clearanceIn: null });
    expect(checkJoin(VENUE_CLEARANCE, "T27", "T28").ok).toBe(true);
  });

  it("never builds a failing join (spare tables at row ends are checked by spareEnds)", () => {
    const base = demoNight();
    const p = generateTonight(base, "17:00", "22:00");
    for (const combo of p.variant.combos)
      expect(checkRows(VENUE_CLEARANCE, base, [combo]).every((j) => j.ok)).toBe(true);
  });

  it("re-plans around a failing join (and plans as before with no aisle data)", () => {
    const r = room({
      areas: [area("Main", { spareSlots: 0 })],
      tables: ["T1", "T2", "T3"].map((id, i) =>
        table(id, { x: i * 4, seats: 4, maxExtraChairs: 0 }),
      ),
      joins: [
        ["T1", "T2"],
        ["T2", "T3"],
      ],
      reservations: [res("R1", "19:00", 8)],
    });
    const tight: Clearance = { ...VENUE_CLEARANCE, joins: { "T1|T2": 20, "T2|T3": 40 }, notes: {} };
    expect(planBuilds(r, "17:00", "22:00", { clearance: null }).builds[0]?.tables).toEqual([
      "T1",
      "T2",
      "T3",
    ]);
    const p = planBuilds(r, "17:00", "22:00", { clearance: tight });
    for (const b of p.builds) expect(b.tables).not.toEqual(expect.arrayContaining(["T1", "T2"]));
  });
});

describe("holds and sections", () => {
  const base = demoNight();
  const plan = planBuilds(base, "17:00", "22:00");
  const fits = partyFits(base, plan.builds, "17:00");

  it("holds tables from one turn before the build, clamped to service start", () => {
    const d9 = fits.find((f) => f.reservationId === "D9");
    expect(d9?.hold).toMatchObject({ from: "17:45", until: "19:45", slotsBlocked: 6 });
    const d1 = fits.find((f) => f.reservationId === "D1");
    // 17:30 party builds at 17:00 = service start: nothing lost
    expect(d1?.hold).toMatchObject({ from: "17:00", slotsBlocked: 0, coversLost: 0 });
  });

  it("costs a rebuild only from when the earlier party leaves", () => {
    const d10 = fits.find((f) => f.reservationId === "D10");
    expect(d10?.hold.from).toBe("19:30");
    expect(d10?.hold.coversLost).toBe(0);
  });

  it("covers lost = seats × minutes held ÷ one turn", () => {
    const b = plan.builds.find((x) => x.reservationId === "D7");
    if (!b) throw new Error("D7 not placed");
    const h = holdFor(base, b, "17:00", []);
    expect(h.coversLost).toBe(Math.round((h.seats * 90) / 90));
    expect(holdLine(h)).toBe(`Held 17:00–19:00 · 6 slots blocked · ~${h.coversLost} covers lost`);
  });

  it("flags a build that spans two server sections", () => {
    const d3 = fits.find((f) => f.reservationId === "D3");
    expect(d3).toMatchObject({ sections: [10, 11], spansSections: true });
    const d2 = fits.find((f) => f.reservationId === "D2");
    expect(d2).toMatchObject({ sections: [13], spansSections: false });
  });

  it("reports the proposal's total covers lost", () => {
    const p = generateTonight(base, "17:00", "22:00");
    expect(p.summary.coversLostToHolds).toBe(p.parties.reduce((n, f) => n + f.hold.coversLost, 0));
    expect(p.parties).toHaveLength(p.summary.placed);
  });
});
