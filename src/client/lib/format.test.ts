import { describe, expect, it } from "vitest";
import { normalTimes } from "./format";

describe("normalTimes", () => {
  it("writes model times in the app's one format", () => {
    expect(normalTimes("around 7pm, or 7:30pm")).toBe("around 7:00 PM, or 7:30 PM");
    expect(normalTimes("at 7:30 PM")).toBe("at 7:30 PM");
  });
});
