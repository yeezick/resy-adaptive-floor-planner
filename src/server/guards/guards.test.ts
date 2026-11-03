import { describe, expect, it } from "vitest";
import { DailyBudget, SpendBudget } from "./budget";
import { RateLimiter } from "./rateLimit";

describe("RateLimiter", () => {
  it("allows N per minute per client, then refuses, then recovers", () => {
    let t = 0;
    const rl = new RateLimiter(2, () => t);
    expect(rl.hit("1.2.3.4")).toBe(true);
    expect(rl.hit("1.2.3.4")).toBe(true);
    expect(rl.hit("1.2.3.4")).toBe(false);
    expect(rl.hit("5.6.7.8")).toBe(true);
    t = 60_001;
    expect(rl.hit("1.2.3.4")).toBe(true);
  });
});

describe("DailyBudget", () => {
  it("is exhausted once spend reaches the limit and resets the next UTC day", () => {
    let now = new Date("2026-11-02T10:00:00Z");
    const b = new DailyBudget(1, () => now);
    expect(b.exhausted()).toBe(false);
    b.add(0.6);
    expect(b.exhausted()).toBe(false);
    b.add(0.4);
    expect(b.exhausted()).toBe(true);
    now = new Date("2026-11-03T00:00:01Z");
    expect(b.exhausted()).toBe(false);
    expect(b.spentToday()).toBe(0);
  });
});

describe("SpendBudget reservations", () => {
  it("counts reservations as spent until settled, and settles once", () => {
    const b = new SpendBudget(1);
    const h = b.reserve(0.9);
    expect(b.exhausted()).toBe(false);
    const h2 = b.reserve(0.2);
    expect(b.exhausted()).toBe(true);
    h.settle(0.1);
    h.settle(5); // ignored
    expect(b.spentSoFar()).toBeCloseTo(0.1, 12);
    expect(b.exhausted()).toBe(false);
    h2.settle(0.2); // e.g. a timed-out call settled at its reservation
    expect(b.inFlightUsd()).toBeCloseTo(0, 12);
    expect(b.largestReservation).toBe(0.9);
  });
});
