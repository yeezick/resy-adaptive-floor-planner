import { describe, expect, it } from "vitest";
import { calibrate, rates, roganGladen, type Pair } from "./calibrate";
import { percentile, wilson } from "./stats";

const pairs = (spec: [boolean, boolean, number][]): Pair[] =>
  spec.flatMap(([judge, human, n]) => Array.from({ length: n }, () => ({ judge, human })));

describe("stats", () => {
  it("wilson matches a known value and handles n = 0", () => {
    const w = wilson(8, 10);
    expect(w.low).toBeCloseTo(0.4902, 3);
    expect(w.high).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0)).toMatchObject({ low: 0, high: 1 });
    expect(wilson(10, 10).high).toBe(1);
  });
  it("percentile is nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("calibration", () => {
  it("computes TPR, TNR and raw agreement", () => {
    const p = pairs([
      [true, true, 9],
      [false, true, 1],
      [false, false, 8],
      [true, false, 2],
    ]);
    expect(rates(p)).toEqual({ tpr: 0.9, tnr: 0.8, rawAgreement: 17 / 20 });
  });

  it("Rogan–Gladen corrects and clips", () => {
    expect(roganGladen(0.7, 0.9, 0.8)).toBeCloseTo((0.7 + 0.8 - 1) / 0.7, 10);
    expect(roganGladen(0.05, 0.9, 0.8)).toBe(0);
    expect(roganGladen(0.99, 0.9, 0.95)).toBe(1);
    expect(roganGladen(0.5, 0.5, 0.5)).toBeNull();
  });

  it("is trusted only when TPR and TNR clear the threshold, with a bootstrap interval", () => {
    const good = pairs([
      [true, true, 9],
      [false, true, 1],
      [false, false, 8],
      [true, false, 2],
    ]);
    const runVerdicts = [...Array(7).fill(true), ...Array(3).fill(false)] as boolean[];
    const c = calibrate({ runVerdicts, pairs: good, stale: false, bootstrap: 500 });
    expect(c).toMatchObject({
      n: 20,
      tpr: 0.9,
      tnr: 0.8,
      observedPassRate: 0.7,
      trusted: true,
      stale: false,
      threshold: 0.8,
    });
    expect(c.correctedPassRate).toBeCloseTo(0.5 / 0.7, 10);
    expect(c.correctedInterval?.low).toBeLessThanOrEqual(c.correctedPassRate as number);
    expect(c.correctedInterval?.high).toBeGreaterThanOrEqual(c.correctedPassRate as number);
    // Deterministic with the same seed.
    expect(
      calibrate({ runVerdicts, pairs: good, stale: false, bootstrap: 500 }).correctedInterval,
    ).toEqual(c.correctedInterval);

    const weak = pairs([
      [true, true, 5],
      [false, false, 3],
      [true, false, 2],
    ]);
    expect(calibrate({ runVerdicts, pairs: weak, stale: true, bootstrap: 100 })).toMatchObject({
      trusted: false,
      stale: true,
    });
  });

  it("returns nulls when a class is missing", () => {
    const c = calibrate({ runVerdicts: [true], pairs: pairs([[true, true, 3]]), stale: false });
    expect(c).toMatchObject({
      tnr: null,
      correctedPassRate: null,
      correctedInterval: null,
      trusted: false,
    });
  });
});
