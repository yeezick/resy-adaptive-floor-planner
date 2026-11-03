// Builds public/evals/results.json (EvalResults) from transcripts, judge verdicts, human labels and the taxonomy.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PRICING_READ_ON } from "../src/server/pricing";
import { loadPrompt } from "../src/server/agent/prompt";
import { loadRooms } from "../src/server/rooms";
import type { Room } from "../src/domain";
import {
  EvalResults,
  type Calibration,
  type ScenarioCategory,
  type ScenarioResult,
} from "../src/shared/evals";
import { runAssertions, toRecord, type AssertionResult, type RunView } from "./assertions";
import { calibrate } from "./calibrate";
import { loadGolden, type GoldenScenario } from "./golden.schema";
import { percentile, round, wilson } from "./stats";
import {
  GOLDEN_PATH,
  Judgement,
  JUDGEMENTS_PATH,
  Label,
  LABELS_META_PATH,
  LABELS_PATH,
  LabelsMeta,
  readJson,
  readJsonl,
  readTranscripts,
  RESULTS_PATH,
  RUN_MANIFEST_PATH,
  RunManifest,
  Taxonomy,
  TAXONOMY_PATH,
  transcriptCalls,
  type Transcript,
} from "./transcript";

export interface Evaluated {
  scenario: GoldenScenario;
  transcript: Transcript;
  results: AssertionResult[];
}

export function runView(t: Transcript): RunView {
  const r = t.response;
  return {
    completed: t.status === "ok" && r !== null,
    answer: r?.answer ?? "",
    clarifyingQuestion: r?.clarifyingQuestion ?? null,
    recommendations: r?.recommendations ?? [],
    tools: (t.trace?.tools ?? []).map((x) => ({
      name: x.name,
      input: x.input,
      ok: x.ok,
      output: x.output,
    })),
    tracePartySize: t.trace?.partySize,
  };
}

/** Runs the assertions on each transcript, using the current golden expectations when the id is still there. */
export function evaluate(
  transcripts: readonly Transcript[],
  golden: readonly GoldenScenario[],
  rooms: Map<string, Room>,
  promptText?: string,
): Evaluated[] {
  const byId = new Map(golden.map((g) => [g.id, g]));
  return transcripts.map((transcript) => {
    const scenario = byId.get(transcript.id) ?? transcript.scenario;
    const room = rooms.get(scenario.room_fixture);
    if (!room)
      throw new Error(`scenario ${scenario.id}: unknown room_fixture "${scenario.room_fixture}"`);
    return {
      scenario,
      transcript,
      results: runAssertions({ room, scenario, run: runView(transcript), promptText }),
    };
  });
}

export interface BuildInput {
  mode: "replay" | "live";
  runAt: string;
  gitSha: string;
  evaluated: readonly Evaluated[];
  judgements: readonly Judgement[];
  labels: readonly Label[];
  taxonomy: Taxonomy | null;
  calibration: Calibration | null;
  manifest: RunManifest | null;
  defaults: { model: string; promptVersion: string };
}

function failureModes(results: AssertionResult[], taxonomy: Taxonomy | null): string[] {
  if (!taxonomy) return [];
  const failed = new Set(results.filter((r) => !r.pass).map((r) => r.name));
  return taxonomy.filter((t) => t.assertions.some((a) => failed.has(a))).map((t) => t.mode);
}

export function buildResults(input: BuildInput): EvalResults {
  const judgeById = new Map(input.judgements.map((j) => [j.id, j]));
  const labelById = new Map(input.labels.map((l) => [l.id, l]));

  const scenarios: ScenarioResult[] = input.evaluated.map(({ scenario, transcript, results }) => {
    const agentCalls = transcriptCalls(transcript);
    const j = judgeById.get(scenario.id);
    const label = labelById.get(scenario.id);
    const m = transcript.response?.metrics;
    return {
      id: scenario.id,
      category: scenario.category,
      prompt: scenario.prompt,
      assertions: toRecord(results),
      assertionsPass: results.every((r) => r.pass),
      judge: j ? { pass: j.pass, critique: j.critique, model: j.model } : null,
      human: label ? { pass: label.pass, reason: label.reason } : null,
      failureModes: failureModes(results, input.taxonomy),
      toolTurns: m?.toolTurns ?? 0,
      validatorRejects: m?.validatorRejects ?? 0,
      latencyMs: m?.latencyMs ?? transcript.latencyMs,
      costUsd: round(
        agentCalls.reduce((n, c) => n + c.costUsd, 0),
        8,
      ),
      calls: [...agentCalls, ...(j?.calls ?? [])],
    };
  });

  const completed = input.evaluated.filter((e) => e.transcript.response !== null);
  const recommendations = completed.length;
  const agentSpend = input.evaluated.reduce(
    (n, e) => n + transcriptCalls(e.transcript).reduce((s, c) => s + c.costUsd, 0),
    0,
  );
  const judgeSpend = input.judgements
    .filter((j) => input.evaluated.some((e) => e.scenario.id === j.id))
    .reduce((n, j) => n + j.calls.reduce((s, c) => s + c.costUsd, 0), 0);
  const latencies = completed.map((e) => e.transcript.response?.metrics.latencyMs ?? 0);
  const rejects = completed.reduce(
    (n, e) => n + (e.transcript.response?.metrics.validatorRejects ?? 0),
    0,
  );
  const turns = completed.reduce((n, e) => n + (e.transcript.response?.metrics.toolTurns ?? 0), 0);
  const costPerRec = recommendations ? agentSpend / recommendations : 0;

  const passed = scenarios.filter((s) => s.assertionsPass).length;
  const categories = [...new Set(scenarios.map((s) => s.category))] as ScenarioCategory[];

  const taxonomyCounts = (input.taxonomy ?? []).map((t) => {
    const hits = scenarios.filter((s) => s.failureModes.includes(t.mode));
    const ex = hits[0];
    const failed = ex
      ? input.evaluated
          .find((e) => e.scenario.id === ex.id)
          ?.results.find((r) => !r.pass && t.assertions.includes(r.name))
      : undefined;
    return {
      mode: t.mode,
      count: hits.length,
      example: ex ? `${ex.id}: ${failed?.detail ?? ""}`.trim() : "",
    };
  });

  const first = completed[0]?.transcript;
  const judgeModel =
    input.judgements.find((j) => input.evaluated.some((e) => e.scenario.id === j.id))?.model ??
    null;
  const n = scenarios.length;

  const knownLimits = [
    n
      ? `Small n: ${n} scenario${n === 1 ? "" : "s"}. Intervals are wide; treat rates as directional, not as a benchmark.`
      : "No recorded run yet (n = 0): the deterministic replay had nothing to check, so no rates are reported.",
    "Synthetic rooms: fictional restaurants with hand-made fixtures, not real service data.",
    "Meal-phase timings (minutes left per phase plus a 5-minute reset) are assumptions in src/domain/phases.ts, not measurements.",
    "Assertions check consistency with the room model and tool outputs, not real-world guest outcomes.",
    `Costs are computed from response usage and a dated price table (src/server/pricing.ts, read ${PRICING_READ_ON}).`,
    "The LLM judge is advisory; its verdicts count only once its TPR and TNR against human labels clear the threshold.",
    "Eval budgets are enforced per model call: each call reserves its worst case before it starts, so a run can pass EVAL_RUN_BUDGET_USD by at most one call's reservation; a scenario cut off mid-way is recorded as a budget error.",
  ];
  if (input.manifest?.aborted)
    knownLimits.push(
      `The live run was aborted: ${input.manifest.abortReason ?? "budget reached"} ` +
        `(spent $${input.manifest.spentUsd.toFixed(4)} of $${input.manifest.budgetUsd}; ` +
        `${input.manifest.skipped.length} scenario(s) skipped).`,
    );

  const results: EvalResults = {
    runAt: input.runAt,
    gitSha: input.gitSha,
    promptVersion: first?.promptVersion ?? input.defaults.promptVersion,
    model: first?.response?.model ?? first?.model ?? input.defaults.model,
    judgeModel,
    mode: input.mode,
    scenarios,
    byCategory: categories.map((category) => {
      const inCat = scenarios.filter((s) => s.category === category);
      return {
        category,
        n: inCat.length,
        assertionPassRate: inCat.filter((s) => s.assertionsPass).length / inCat.length,
      };
    }),
    failureTaxonomy: taxonomyCounts,
    assertionPassRate: n ? passed / n : 0,
    assertionInterval: {
      ...wilson(passed, n),
      method: "wilson-95 over scenarios (all assertions pass)",
    },
    rollups: {
      recommendations,
      costPerRecommendationUsd: round(costPerRec, 8),
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      avgToolTurns: recommendations ? turns / recommendations : 0,
      validatorRejectRate: recommendations ? rejects / recommendations : 0,
      spendUsd: {
        agent: round(agentSpend, 8),
        judge: round(judgeSpend, 8),
        total: round(agentSpend + judgeSpend, 8),
      },
      projectedUsdPer1000: round(costPerRec * 1000, 6),
    },
    calibration: input.calibration,
    knownLimits,
  };
  return EvalResults.parse(results);
}

export function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/** Calibration from labels.jsonl + judgements.jsonl (+ labels.meta.json for staleness), or null if either is missing. */
export function calibrationFromFiles(transcripts = readTranscripts()): Calibration | null {
  const labels = readJsonl(LABELS_PATH, Label);
  const judgements = readJsonl(JUDGEMENTS_PATH, Judgement);
  if (!labels.length || !judgements.length) return null;
  const judgeById = new Map(judgements.map((j) => [j.id, j]));
  const pairs = labels.flatMap((l) => {
    const j = judgeById.get(l.id);
    return j ? [{ judge: j.pass, human: l.pass }] : [];
  });
  const meta = readJson(LABELS_META_PATH, LabelsMeta);
  const current = transcripts.find((t) => t.response)?.response ?? null;
  const stale =
    !meta ||
    judgements.some(
      (j) => j.agentPromptVersion !== meta.promptVersion || j.agentModel !== meta.model,
    ) ||
    (current !== null &&
      (current.promptVersion !== meta.promptVersion || current.model !== meta.model));
  const runIds = new Set(transcripts.map((t) => t.id));
  return calibrate({
    runVerdicts: judgements.filter((j) => runIds.has(j.id)).map((j) => j.pass),
    pairs,
    stale,
  });
}

export function existingMode(): "replay" | "live" | null {
  if (!existsSync(RESULTS_PATH)) return null;
  try {
    const m = (JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as { mode?: unknown }).mode;
    return m === "live" || m === "replay" ? m : null;
  } catch {
    return null;
  }
}

/** Re-evaluates every transcript from disk; writes a validated results.json unless `write` is false. */
export function refreshResults(
  mode?: "replay" | "live",
  opts: { write?: boolean } = {},
): {
  results: EvalResults;
  evaluated: Evaluated[];
} {
  const transcripts = readTranscripts();
  const golden = existsSync(GOLDEN_PATH) ? loadGolden(GOLDEN_PATH) : [];
  const prompt = loadPrompt();
  const evaluated = evaluate(transcripts, golden, loadRooms(), prompt.text);
  const taxonomy = readJson(TAXONOMY_PATH, Taxonomy);
  const results = buildResults({
    mode: mode ?? existingMode() ?? "replay",
    runAt: new Date().toISOString(),
    gitSha: gitSha(),
    evaluated,
    judgements: readJsonl(JUDGEMENTS_PATH, Judgement),
    labels: readJsonl(LABELS_PATH, Label),
    taxonomy,
    calibration: calibrationFromFiles(transcripts),
    manifest: readJson(RUN_MANIFEST_PATH, RunManifest),
    defaults: {
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
      promptVersion: prompt.version,
    },
  });
  if (opts.write ?? true) {
    mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
  }
  return { results, evaluated };
}
