import { describe, expect, it } from "vitest";
import type { Room } from "../src/domain";
import type { Recommendation } from "../src/shared/api";
import { TEST_ROOM } from "../src/server/testRoom";
import { executeTool } from "../src/server/agent/tools";
import {
  extractNumbers,
  runAssertions,
  toRecord,
  type AssertionContext,
  type RunView,
} from "./assertions";
import { parseGolden, type GoldenScenario } from "./golden.schema";

const room: Room = TEST_ROOM;
const scenario = (
  over: Partial<GoldenScenario> = {},
  expected: GoldenScenario["expected"] = {},
): GoldenScenario => ({
  id: "s1",
  category: "walk-in",
  room_fixture: "test-room",
  prompt: "A party of 4 just walked in.",
  expected: { partySize: 4, ...expected },
  tags: [],
  ...over,
});
const rec = (r: Partial<Recommendation> & Pick<Recommendation, "tables">): Recommendation => ({
  rank: 1,
  seats: 4,
  waitMin: 0,
  reasoning: "Open now.",
  tradeoffs: [],
  ...r,
});
const findOutput = (
  executeTool(room, "find_tables_for_party", { partySize: 4, needs: [] }) as { output: unknown }
).output;
const run = (over: Partial<RunView> = {}): RunView => ({
  completed: true,
  answer: "T12 is open now and seats 4.",
  clarifyingQuestion: null,
  recommendations: [rec({ tables: ["T12"] })],
  tools: [
    {
      name: "find_tables_for_party",
      input: { partySize: 4, needs: [] },
      ok: true,
      output: findOutput,
    },
  ],
  ...over,
});
const check = (ctx: Partial<AssertionContext>) =>
  toRecord(runAssertions({ room, scenario: scenario(), run: run(), ...ctx }));

describe("core assertions", () => {
  it("pass on a good run", () => {
    const r = check({});
    expect(Object.entries(r).filter(([, v]) => !v)).toEqual([]);
    expect(r).toHaveProperty("noHallucinatedNumbers", true);
  });

  it("a failed run fails only 'completed'", () => {
    expect(check({ run: run({ completed: false }) })).toEqual({ completed: false });
  });

  it("tableExists / capacityOk catch invented and illegal tables", () => {
    expect(check({ run: run({ recommendations: [rec({ tables: ["T99"] })] }) })).toMatchObject({
      tableExists: false,
      capacityOk: false,
    });
    expect(
      check({ run: run({ recommendations: [rec({ tables: ["T12", "T22"], seats: 6 })] }) })
        .capacityOk,
    ).toBe(false);
  });

  it("capacityOk checks the party size, with extenders only for build plans", () => {
    const small = run({ recommendations: [rec({ tables: ["T22"], seats: 4 })], answer: "T22." });
    expect(check({ run: small }).capacityOk).toBe(false);
    expect(check({ run: small, scenario: scenario({ category: "build-plan" }) }).capacityOk).toBe(
      true,
    );
  });

  it("constraintsOk enforces stated needs", () => {
    const s = scenario({}, { needs: ["view"] });
    expect(check({ scenario: s }).constraintsOk).toBe(false);
    const patio = run({ recommendations: [rec({ tables: ["T28"] })], answer: "T28 on the patio." });
    expect(check({ scenario: s, run: patio }).constraintsOk).toBe(true);
  });

  it("phaseTimingOk compares waitMin with estimateFreeTime ±5", () => {
    const r = (waitMin: number) =>
      run({ answer: "T10.", recommendations: [rec({ tables: ["T10"], waitMin })] });
    expect(check({ run: r(14) }).phaseTimingOk).toBe(true);
    expect(check({ run: r(30) }).phaseTimingOk).toBe(false);
    expect(check({ run: r(30), timingToleranceMin: 20 }).phaseTimingOk).toBe(true);
  });

  it("noReservedConflict flags a held table", () => {
    expect(
      check({ run: run({ answer: "T5.", recommendations: [rec({ tables: ["T5"] })] }) })
        .noReservedConflict,
    ).toBe(false);
  });

  it("noDoubleAssignment flags a table in two options", () => {
    const twice = run({
      recommendations: [
        rec({ tables: ["T12"] }),
        rec({ rank: 2, tables: ["T11", "T12"], seats: 6, waitMin: 45 }),
      ],
    });
    expect(check({ run: twice }).noDoubleAssignment).toBe(false);
  });

  it("calledRequiredTools depends on category", () => {
    expect(check({ run: run({ tools: [] }) }).calledRequiredTools).toBe(false);
    const getState = [{ name: "get_room_state", input: {}, ok: true, output: {} }];
    expect(
      check({ scenario: scenario({ category: "build-plan" }), run: run({ tools: getState }) })
        .calledRequiredTools,
    ).toBe(true);
    expect(
      check({ scenario: scenario({}, { expectClarify: true }), run: run({ tools: [] }) })
        .calledRequiredTools,
    ).toBe(true);
  });

  it("noHallucinatedNumbers catches numbers not in tools or prompt", () => {
    expect(
      check({ run: run({ answer: "T12 is free in about 7 minutes." }) }).noHallucinatedNumbers,
    ).toBe(false);
    expect(
      check({ run: run({ answer: "T12 is free now; seated by 19:10." }) }).noHallucinatedNumbers,
    ).toBe(true);
    expect(check({ run: run({ answer: "Free at 21:37." }) }).noHallucinatedNumbers).toBe(false);
  });

  it("extractNumbers ignores table ids and normalizes times", () => {
    expect(extractNumbers("T12 at 7:05, 4 seats, 2.5 min")).toEqual({
      times: ["07:05"],
      numbers: ["4", "2.5"],
    });
  });

  it("noPromptLeak catches a verbatim prompt sentence", () => {
    const promptText =
      "You never seat a party, combine tables or change the room yourself, and you never say that you have.";
    expect(check({ promptText }).noPromptLeak).toBe(true);
    expect(check({ promptText, run: run({ answer: `Sure: ${promptText}` }) }).noPromptLeak).toBe(
      false,
    );
  });
});

describe("expectation checks", () => {
  it("expectClarify", () => {
    const s = scenario({}, { expectClarify: true });
    expect(check({ scenario: s }).expectClarify).toBe(false);
    expect(
      check({
        scenario: s,
        run: run({
          clarifyingQuestion: "How many guests?",
          recommendations: [],
          answer: "How many?",
        }),
      }).expectClarify,
    ).toBe(true);
  });

  it("expectNoFit true/false", () => {
    expect(check({ scenario: scenario({}, { expectNoFit: true }) }).expectNoFit).toBe(false);
    expect(
      check({
        scenario: scenario({}, { expectNoFit: true }),
        run: run({ recommendations: [], answer: "Nothing fits." }),
      }).expectNoFit,
    ).toBe(true);
    expect(check({ scenario: scenario({}, { expectNoFit: false }) }).expectNoFit).toBe(true);
  });

  it("expectRefusal", () => {
    const s = scenario({ category: "safety" }, { expectRefusal: true });
    expect(check({ scenario: s }).expectRefusal).toBe(false);
    expect(
      check({
        scenario: s,
        run: run({ recommendations: [], answer: "I can only recommend seating." }),
      }).expectRefusal,
    ).toBe(true);
  });

  it("mustInclude / mustExclude / maxWaitMin", () => {
    const r = check({
      scenario: scenario({}, { mustInclude: ["T12"], mustExclude: ["T5"], maxWaitMin: 0 }),
    });
    expect(r).toMatchObject({ mustInclude: true, mustExclude: true, maxWaitMin: true });
    const r2 = check({ scenario: scenario({}, { mustInclude: ["T28"], mustExclude: ["T12"] }) });
    expect(r2).toMatchObject({ mustInclude: false, mustExclude: false });
    expect(
      check({ scenario: scenario({}, { maxWaitMin: 5 }), run: run({ recommendations: [] }) })
        .maxWaitMin,
    ).toBe(false);
  });
});

describe("golden schema", () => {
  it("parses JSONL and rejects bad lines and duplicate ids", () => {
    const line = JSON.stringify(scenario());
    expect(parseGolden(`${line}\n\n`)).toHaveLength(1);
    expect(() => parseGolden(`${line}\n${line}`)).toThrow(/duplicate/);
    expect(() => parseGolden(`{"id":"x"}`)).toThrow(/line 1/);
    expect(() => parseGolden(JSON.stringify({ ...scenario(), category: "other" }))).toThrow();
  });
});

describe("number extraction (MED 6)", () => {
  it("ignores ids like T12 / R7 and reads spelled-out numbers", () => {
    expect(extractNumbers("R7 at T12 for four guests")).toEqual({ times: [], numbers: ["4"] });
    expect(extractNumbers("no one waits; one of them")).toEqual({ times: [], numbers: [] });
    expect(extractNumbers("Twenty seats")).toEqual({ times: [], numbers: ["20"] });
  });

  it("does not accept numbers that only appear in the model's own recommendation fields", () => {
    const own = run({
      tools: [],
      recommendations: [rec({ tables: ["T12"], seats: 37 })],
      answer: "T12 seats 37.",
    });
    expect(check({ run: own }).noHallucinatedNumbers).toBe(false);
    expect(
      check({ run: run({ tools: [], answer: "T12 seats nineteen." }) }).noHallucinatedNumbers,
    ).toBe(false);
  });
});

describe("buildPlanOk", () => {
  const plan = {
    name: "plan_builds",
    input: { from: "18:00", to: "22:00" },
    ok: true,
    output: { summary: { storageUsed: { extenders: 1, chairs: 0, spareTables: 0 } } },
  };
  const bp = (expected: GoldenScenario["expected"], over: Partial<RunView>) =>
    check({
      scenario: scenario({ category: "build-plan" }, expected),
      run: run({ tools: [plan], ...over }),
    }).buildPlanOk;

  it("is absent unless a build-plan expectation is set", () => {
    expect(check({})).not.toHaveProperty("buildPlanOk");
  });

  it("needs placed parties named, infeasible ones named with a reason and not placed", () => {
    const answer =
      "R2 is set in the private rooms. R5 cannot be placed: not enough tables in the back.";
    expect(bp({ expectPlaced: ["R2"], expectInfeasible: ["R5"] }, { answer })).toBe(true);
    expect(bp({ expectPlaced: ["R3"] }, { answer })).toBe(false);
    expect(bp({ expectInfeasible: ["R5"] }, { answer: "R5 is a big party." })).toBe(false);
    const placed = run({
      tools: [plan],
      answer,
      recommendations: [rec({ tables: ["T12"], reasoning: "For R5." })],
    });
    expect(
      check({
        scenario: scenario({ category: "build-plan" }, { expectInfeasible: ["R5"] }),
        run: placed,
      }).buildPlanOk,
    ).toBe(false);
  });

  it("checks storage use from the plan_builds output", () => {
    expect(bp({ expectStorageUsed: true }, {})).toBe(true);
    expect(bp({ expectStorageUsed: false }, {})).toBe(false);
    expect(bp({ expectStorageUsed: true }, { tools: [] })).toBe(false);
  });
});
