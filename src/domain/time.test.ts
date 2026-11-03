import { describe, expect, it } from "vitest";
import { clock12, times12, toHHMM, toMinutes } from "./time";

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

describe("clock12", () => {
  it("reads a 24-hour time as 12-hour AM/PM", () => {
    expect(clock12("17:00")).toBe("5:00 PM");
    expect(clock12("09:05")).toBe("9:05 AM");
    expect(clock12("12:30")).toBe("12:30 PM");
    expect(clock12("00:15")).toBe("12:15 AM");
    expect(clock12("23:59")).toBe("11:59 PM");
  });

  it("leaves anything that isn't a time alone", () => {
    expect(clock12("later")).toBe("later");
  });
});

describe("times12", () => {
  it("rewrites every time in a sentence", () => {
    expect(times12("Set for 22 by 18:00; split after ~19:30")).toBe(
      "Set for 22 by 6:00 PM; split after ~7:30 PM",
    );
  });

  it("states AM/PM once for a range on one side of noon", () => {
    expect(times12("Tables held 16:30–18:00")).toBe("Tables held 4:30–6:00 PM");
    expect(times12("11:30–12:30")).toBe("11:30 AM–12:30 PM");
  });

  it("leaves durations, ratios and table numbers alone", () => {
    expect(times12("~45m · tables 30–50 · 1:4 · T57")).toBe("~45m · tables 30–50 · 1:4 · T57");
  });

  it("does not touch times inside longer digit runs", () => {
    expect(times12("id 119:000")).toBe("id 119:000");
  });
});
