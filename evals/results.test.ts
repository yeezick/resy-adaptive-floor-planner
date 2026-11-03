import { describe, expect, it } from "vitest";
import { finalAnswer, fakeMessage, scripted, toolUse } from "../src/server/agent/fake";
import type { AgentConfig, CreateMessage } from "../src/server/agent/loop";
import { TEST_ROOM } from "../src/server/testRoom";
import { EvalResults } from "../src/shared/evals";
import type { GoldenScenario } from "./golden.schema";
import { judgeTranscript, renderForJudge } from "./judge";
import { renderLabelSheet } from "./labelsheet";
import { buildResults, evaluate, type BuildInput } from "./results";
import { recordScenario, replayCoverage } from "./run";
import type { Judgement, Transcript } from "./transcript";

const rooms = new Map([[TEST_ROOM.id, TEST_ROOM]]);
const scenario: GoldenScenario = {
  id: "walkin-four",
  category: "walk-in",
  room_fixture: "test-room",
  prompt: "A party of 4 just walked in.",
  expected: { partySize: 4, maxWaitMin: 15 },
  tags: [],
};
const good = {
  answer: "T12 is open now and seats 4.",
  clarifyingQuestion: null,
  recommendations: [
    { rank: 1, tables: ["T12"], seats: 4, waitMin: 0, reasoning: "Open now.", tradeoffs: [] },
  ],
};
const cfg = (create: CreateMessage): AgentConfig => ({
  create,
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 8000,
  timeoutMs: 5000,
});

async function record(messages: Parameters<typeof scripted>[0], s = scenario): Promise<Transcript> {
  return recordScenario(s, cfg(scripted(messages).create), rooms);
}

const build = (over: Partial<BuildInput>): EvalResults =>
  buildResults({
    mode: "replay",
    runAt: "2026-11-02T00:00:00Z",
    gitSha: "abc",
    evaluated: [],
    judgements: [],
    labels: [],
    taxonomy: null,
    calibration: null,
    manifest: null,
    defaults: { model: "claude-opus-5-5", promptVersion: "agent.v1.0" },
    ...over,
  });

describe("recordScenario → evaluate → buildResults", () => {
  it("records a transcript, passes the assertions and rolls up cost and latency", async () => {
    const t = await record([
      toolUse("tu1", "find_tables_for_party", { partySize: 4, needs: [] }),
      finalAnswer(good),
    ]);
    expect(t.status).toBe("ok");
    expect(t.trace?.tools[0]?.name).toBe("find_tables_for_party");
    const evaluated = evaluate([t], [scenario], rooms);
    expect(evaluated[0]?.results.filter((r) => !r.pass)).toEqual([]);

    const r = build({ evaluated });
    expect(EvalResults.safeParse(r).success).toBe(true);
    expect(r.assertionPassRate).toBe(1);
    expect(r.rollups.recommendations).toBe(1);
    expect(r.rollups.avgToolTurns).toBe(1);
    expect(r.rollups.spendUsd.agent).toBeCloseTo((2 * (1000 * 4 + 200 * 20)) / 1e6, 8);
    expect(r.rollups.projectedUsdPer1000).toBeCloseTo(r.rollups.costPerRecommendationUsd * 1000, 6);
    expect(r.byCategory).toEqual([{ category: "walk-in", n: 1, assertionPassRate: 1 }]);
    expect(r.knownLimits.join(" ")).toMatch(/Small n: 1 scenario/);
  });

  it("records a failed run with the calls it paid for", async () => {
    const t = await record([fakeMessage([{ type: "text", text: "{" }], "max_tokens")]);
    expect(t).toMatchObject({ status: "error", response: null, error: { code: "upstream" } });
    expect(t.errorCalls).toHaveLength(1);
    const r = build({ evaluated: evaluate([t], [scenario], rooms) });
    expect(r.scenarios[0]?.assertions).toEqual({ completed: false });
    expect(r.rollups.recommendations).toBe(0);
    expect(r.rollups.spendUsd.agent).toBeGreaterThan(0);
  });

  it("uses the current golden expectations, maps the taxonomy and notes an aborted run", async () => {
    const t = await record([finalAnswer(good)]);
    const stricter = { ...scenario, expected: { ...scenario.expected, mustInclude: ["T28"] } };
    const evaluated = evaluate([t], [stricter], rooms);
    const r = build({
      evaluated,
      taxonomy: [
        { mode: "wrong-table", assertions: ["mustInclude"] },
        { mode: "skipped-tools", assertions: ["calledRequiredTools"] },
      ],
      manifest: {
        startedAt: "",
        finishedAt: "",
        model: "claude-opus-5-5",
        promptVersion: "agent.v1.0",
        budgetUsd: 5,
        spentUsd: 5.01,
        aborted: true,
        abortReason: "budget",
        ran: ["walkin-four"],
        skipped: ["b"],
      },
    });
    expect(r.scenarios[0]?.assertionsPass).toBe(false);
    expect(r.scenarios[0]?.failureModes).toEqual(["wrong-table", "skipped-tools"]);
    expect(r.failureTaxonomy[0]).toMatchObject({ mode: "wrong-table", count: 1 });
    expect(r.knownLimits.join(" ")).toMatch(/aborted/);
    expect(r.assertionInterval.high).toBeLessThan(1);
  });

  it("attaches judge verdicts and human labels and counts judge spend", async () => {
    const t = await record([
      toolUse("tu1", "find_tables_for_party", { partySize: 4, needs: [] }),
      finalAnswer(good),
    ]);
    const { create } = scripted([
      fakeMessage(
        [{ type: "text", text: JSON.stringify({ pass: true, critique: "Good." }) }],
        "end_turn",
        {},
        "claude-sonnet-5-5",
      ),
    ]);
    const out = await judgeTranscript(t, {
      create,
      model: "claude-sonnet-5-5",
      effort: "medium",
      rubric: "rubric",
    });
    expect(out.judgement).toMatchObject({
      id: "walkin-four",
      pass: true,
      model: "claude-sonnet-5-5",
    });
    expect(out.calls[0]?.role).toBe("judge");
    const r = build({
      evaluated: evaluate([t], [scenario], rooms),
      judgements: [out.judgement as Judgement],
      labels: [{ id: "walkin-four", pass: true, reason: "fine" }],
    });
    expect(r.judgeModel).toBe("claude-sonnet-5-5");
    expect(r.scenarios[0]?.judge?.pass).toBe(true);
    expect(r.scenarios[0]?.human).toEqual({ pass: true, reason: "fine" });
    expect(r.rollups.spendUsd.judge).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 8);
    expect(r.scenarios[0]?.calls.map((c) => c.role)).toEqual(["agent", "agent", "judge"]);
  });

  it("an unparseable judge reply is skipped, not counted as FAIL", async () => {
    const t = await record([finalAnswer(good)]);
    const { create } = scripted([fakeMessage([], "refusal", {}, "claude-sonnet-5-5")]);
    const out = await judgeTranscript(t, {
      create,
      model: "claude-sonnet-5-5",
      effort: "medium",
      rubric: "r",
    });
    expect(out.judgement).toBeNull();
    expect(out.calls).toHaveLength(1);
  });

  it("renders a label sheet and judge input", async () => {
    const t = await record([
      toolUse("tu1", "find_tables_for_party", { partySize: 4, needs: [] }),
      finalAnswer(good),
    ]);
    const md = renderLabelSheet([t]);
    expect(md).toContain("## walkin-four (walk-in)");
    expect(md).toContain("1. T12 — 4 seats, ~0 min. Open now.");
    expect(md).toMatch(
      /find_tables_for_party\(\{"partySize":4,"needs":\[\]\}\) → T12 \(4 seats, 0 min\)/,
    );
    expect(md).toContain("PASS/FAIL: ");
    expect(renderForJudge(t)).toContain("<host_request>\nA party of 4 just walked in.");
  });
});

describe("replayCoverage", () => {
  it("fails a recorded run with missing transcripts; warns without a recorded run", () => {
    expect(replayCoverage(["a", "b"], ["a"], true)).toMatchObject({ ok: false, missing: ["b"] });
    expect(replayCoverage(["a"], ["a"], true)).toMatchObject({ ok: true, warning: null });
    const none = replayCoverage(["a"], [], false);
    expect(none.ok).toBe(true);
    expect(none.warning).toMatch(/NO RECORDED RUN/);
  });

  it("an empty replay says there is no recorded run yet", () => {
    expect(build({}).knownLimits[0]).toMatch(/No recorded run yet \(n = 0\)/);
  });
});
