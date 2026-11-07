import { describe, expect, it } from "vitest";
import { answerLead } from "./answerLead";

describe("answerLead (T36)", () => {
  it("splits after the first sentence", () => {
    expect(
      answerLead("Tables 39 and 40 seat 8 with header chairs. Table 41 frees up first."),
    ).toEqual({
      lead: "Tables 39 and 40 seat 8 with header chairs.",
      rest: "Table 41 frees up first.",
    });
  });
  it("a refusal-only lead that names no table takes the next sentence too", () => {
    expect(
      answerLead(
        "I can't seat them or push tables together myself. Tables 39 and 40 only seat 6. Table 41 is quickest.",
      ),
    ).toEqual({
      lead: "I can't seat them or push tables together myself. Tables 39 and 40 only seat 6.",
      rest: "Table 41 is quickest.",
    });
    expect(answerLead("I cannot push tables together myself. Ask in Shift setup.")).toEqual({
      lead: "I cannot push tables together myself. Ask in Shift setup.",
      rest: null,
    });
  });
  it("a refusal that names a table number stays the lead; short or single sentences stay whole", () => {
    expect(answerLead("I can't hold table 41 past 8:00 PM. Seat them now.")).toEqual({
      lead: "I can't hold table 41 past 8:00 PM.",
      rest: "Seat them now.",
    });
    expect(answerLead("Table 12 is open now.")).toEqual({
      lead: "Table 12 is open now.",
      rest: null,
    });
  });
});
