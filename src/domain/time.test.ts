import { describe, expect, it } from "vitest";
import { toHHMM, toMinutes } from "./time";

describe("toMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("07:05")).toBe(425);
    expect(toMinutes("19:10")).toBe(1150);
    expect(toMinutes("23:59")).toBe(1439);
  });

  it("treats a missing minutes part as zero", () => {
    expect(toMinutes("18")).toBe(1080);
  });
});

describe("toHHMM", () => {
  it("formats with zero padding", () => {
    expect(toHHMM(0)).toBe("00:00");
    expect(toHHMM(65)).toBe("01:05");
    expect(toHHMM(1439)).toBe("23:59");
  });

  it("wraps past midnight", () => {
    expect(toHHMM(1440)).toBe("00:00");
    expect(toHHMM(1450)).toBe("00:10");
    expect(toHHMM(1440 * 2 + 30)).toBe("00:30");
  });

  it("wraps negative minutes back into the previous day", () => {
    expect(toHHMM(-1)).toBe("23:59");
    expect(toHHMM(-30)).toBe("23:30");
    expect(toHHMM(-1440)).toBe("00:00");
  });

  it("rounds fractional minutes", () => {
    expect(toHHMM(60.4)).toBe("01:00");
    expect(toHHMM(60.6)).toBe("01:01");
  });

  it("round-trips every minute of the day", () => {
    for (let m = 0; m < 1440; m += 7) expect(toMinutes(toHHMM(m))).toBe(m);
  });
});
