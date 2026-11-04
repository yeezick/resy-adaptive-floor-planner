import { describe, expect, it } from "vitest";
import { crewFootnote, planLine } from "./wording";

const whitaker = {
  rows: [
    ["T57", "T58", "T59", "T60", "T61"],
    ["T63", "T64", "T65", "T66"],
  ],
  tables: ["T57", "T58", "T59", "T60", "T61", "T63", "T64", "T65", "T66"],
  seats: 22,
  area: "Garden Room + Library",
  dividersOpened: ["Garden Room | Library"],
  spareTables: 0,
  extenders: 0,
  extraChairs: 0,
  buildBy: "18:00",
};

describe("planLine", () => {
  it("the 22-top in one line, with the rooms only because it spans them", () => {
    expect(planLine(whitaker)).toBe(
      "Combine: tables 57–61, 63–66 into two long tables seating 22 (Garden Room + Library, divider open).",
    );
  });

  it("one room, one row: no room words", () => {
    expect(
      planLine({
        ...whitaker,
        rows: [["T72", "T73", "T74"]],
        tables: ["T72", "T73", "T74"],
        seats: 11,
        area: "Main",
        dividersOpened: [],
      }),
    ).toBe("Combine: tables 72–74 into one long table seating 11.");
  });

  it("names storage and a single table plainly", () => {
    expect(
      planLine({
        ...whitaker,
        rows: [["T72", "T73"]],
        tables: ["T72", "T73"],
        seats: 14,
        area: "Main",
        dividersOpened: [],
        spareTables: 2,
        extraChairs: 6,
      }),
    ).toBe(
      "Combine: tables 72 and 73 + 2 tables and 6 chairs from storage into one long table seating 14.",
    );
    expect(
      planLine({
        ...whitaker,
        rows: [["T31"]],
        tables: ["T31"],
        seats: 10,
        area: "Main",
        dividersOpened: [],
      }),
    ).toBe("Set: table 31 as a 10-top.");
  });
});

describe("crewFootnote", () => {
  it("build minutes and the start, from build-by", () => {
    // 9 tables × 3 min + one divider × 5 min = 32 min; 6:00 PM − 32 min = 5:28 PM
    expect(crewFootnote(whitaker)).toBe("Crew build: ~32 min, starts ~5:28 PM");
  });
});
