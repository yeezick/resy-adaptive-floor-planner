// Eval runner.
//   --replay (CI, no key, no cost): replays recorded transcripts through the deterministic assertions.
//            Fails if any assertion fails, or if a recorded run exists (evals/transcripts/_run.json) and a golden
//            scenario has no transcript. With no recorded run it passes with a loud warning.
//            Writes public/evals/results.json only with --write.
//   --live   (advisory, needs ANTHROPIC_API_KEY): runs the agent on every golden scenario under a dollar budget,
//            records evals/transcripts/<id>.json, evaluates them and always writes results.json.
//
// Budget granularity: EVAL_RUN_BUDGET_USD is enforced per model call, not per scenario. Each call reserves its
// worst case (max_tokens of output plus an over-estimate of input) before it starts and settles to the actual
// cost after, so a run passes the budget by at most one call's reservation. A scenario cut off mid-way is
// recorded with error code "budget" and every later scenario is skipped.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  agentConfigFromEnv,
  runAgent,
  type AgentConfig,
} from "../src/server/agent/loop";
import { loadPrompt } from "../src/server/agent/prompt";
import { validateEnv } from "../src/server/config";
import { SpendBudget } from "../src/server/guards/budget";
import { loadRooms } from "../src/server/rooms";
import type { CallMetrics } from "../src/shared/api";
import { loadGolden, type GoldenScenario } from "./golden.schema";
import { refreshResults, type Evaluated } from "./results";
import {
  GOLDEN_PATH,
  JUDGEMENTS_PATH,
  readTranscripts,
  RUN_MANIFEST_PATH,
  RunManifest,
  Transcript,
  TRANSCRIPTS_DIR,
  writeJson,
} from "./transcript";

export function runBudgetUsd(): number {
  // EVAL_BUDGET_USD is what .github/workflows/evals-live.yml sets today; EVAL_RUN_BUDGET_USD is the documented name.
  const n = Number(process.env.EVAL_RUN_BUDGET_USD ?? process.env.EVAL_BUDGET_USD ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function recordScenario(
  scenario: GoldenScenario,
  cfg: AgentConfig,
  rooms = loadRooms(),
): Promise<Transcript> {
  const room = rooms.get(scenario.room_fixture);
  if (!room)
    throw new Error(`scenario ${scenario.id}: unknown room_fixture "${scenario.room_fixture}"`);
  const prompt = loadPrompt();
  const started = Date.now();
  const base = {
    id: scenario.id,
    scenario,
    recordedAt: new Date().toISOString(),
    promptVersion: prompt.version,
    model: cfg.model,
    effort: cfg.effort,
  };
  try {
    const { response, trace } = await runAgent(
      { room, message: scenario.prompt, traceId: `eval-${scenario.id}-${started}` },
      cfg,
    );
    return Transcript.parse({
      ...base,
      status: "ok",
      error: null,
      response,
      trace: { ...trace, tools: trace.tools.map((t) => ({ ...t })) },
      errorCalls: [],
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    const calls: CallMetrics[] = e instanceof AgentError ? e.calls : [];
    return Transcript.parse({
      ...base,
      status: "error",
      error: {
        code: e instanceof AgentError ? e.code : "crash",
        message: e instanceof Error ? e.message : String(e),
      },
      response: null,
      trace: null,
      errorCalls: calls,
      latencyMs: Date.now() - started,
    });
  }
}

/** Replay coverage: with a recorded run, every golden scenario must have a transcript. */
export function replayCoverage(
  goldenIds: readonly string[],
  transcriptIds: readonly string[],
  runRecorded: boolean,
): { ok: boolean; missing: string[]; warning: string | null } {
  const have = new Set(transcriptIds);
  const missing = goldenIds.filter((id) => !have.has(id));
  if (!runRecorded)
    return {
      ok: true,
      missing,
      warning:
        "NO RECORDED RUN (evals/transcripts/_run.json is missing): the deterministic gate checked nothing. " +
        "Record a run with `pnpm evals:live` and commit the transcripts.",
    };
  return { ok: missing.length === 0, missing, warning: null };
}

function summarize(evaluated: Evaluated[]): number {
  let failures = 0;
  for (const e of evaluated) {
    const failed = e.results.filter((r) => !r.pass);
    failures += failed.length ? 1 : 0;
    console.log(`${failed.length ? "FAIL" : "PASS"}  ${e.scenario.id}`);
    for (const f of failed) console.log(`        ${f.name}: ${f.detail}`);
  }
  return failures;
}

async function live(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("evals:live needs ANTHROPIC_API_KEY.");
    process.exit(2);
  }
  validateEnv();
  const scenarios = loadGolden(GOLDEN_PATH);
  const budget = new SpendBudget(runBudgetUsd());
  const client = new Anthropic();
  const cfg: AgentConfig = {
    ...agentConfigFromEnv((p, o) => client.beta.messages.create(p, o)),
    budget,
  };

  // A live run replaces the recorded set, so stale transcripts never mix with this run's.
  mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  for (const f of readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith(".json")))
    rmSync(path.join(TRANSCRIPTS_DIR, f));
  rmSync(JUDGEMENTS_PATH, { force: true }); // verdicts on the previous run's transcripts

  const startedAt = new Date().toISOString();
  const ran: string[] = [];
  const skipped: string[] = [];
  let abortReason: string | null = null;
  const rooms = loadRooms();
  for (const s of scenarios) {
    if (abortReason || budget.exhausted()) {
      abortReason ??= `spend $${budget.spentSoFar().toFixed(4)} reached EVAL_RUN_BUDGET_USD=$${budget.limitUsd}`;
      skipped.push(s.id);
      continue;
    }
    const t = await recordScenario(s, cfg, rooms);
    writeJson(path.join(TRANSCRIPTS_DIR, `${s.id}.json`), t);
    ran.push(s.id);
    if (t.error?.code === "budget")
      abortReason = `EVAL_RUN_BUDGET_USD=$${budget.limitUsd} reached during ${s.id}`;
    console.log(
      `${t.status === "ok" ? "recorded" : `error (${t.error?.code})`}  ${s.id}  ` +
        `$${(t.response?.metrics.costUsd ?? 0).toFixed(4)}  ${t.latencyMs} ms  (run total $${budget.spentSoFar().toFixed(4)})`,
    );
  }
  writeJson(
    RUN_MANIFEST_PATH,
    RunManifest.parse({
      startedAt,
      finishedAt: new Date().toISOString(),
      model: cfg.model,
      promptVersion: loadPrompt().version,
      budgetUsd: budget.limitUsd,
      spentUsd: budget.spentSoFar(),
      aborted: abortReason !== null,
      abortReason,
      ran,
      skipped,
    }),
  );
  if (abortReason) console.log(`ABORTED: ${abortReason}; skipped ${skipped.join(", ") || "none"}`);

  const { results, evaluated } = refreshResults("live");
  const failures = summarize(evaluated);
  console.log(
    JSON.stringify({
      mode: "live",
      scenarios: evaluated.length,
      failing: failures,
      spendUsd: results.rollups.spendUsd,
      latencyP50Ms: results.rollups.latencyP50Ms,
      latencyP95Ms: results.rollups.latencyP95Ms,
    }),
  );
  // Live runs are advisory: assertion failures are reported, not turned into a failing exit code.
}

function replay(write: boolean): void {
  const golden = existsSync(GOLDEN_PATH) ? loadGolden(GOLDEN_PATH) : [];
  const coverage = replayCoverage(
    golden.map((g) => g.id),
    readTranscripts().map((t) => t.id),
    existsSync(RUN_MANIFEST_PATH),
  );
  const { results, evaluated } = refreshResults("replay", { write });
  if (coverage.warning) {
    const bar = "!".repeat(78);
    console.warn(`${bar}\n${coverage.warning}\n${bar}`);
  }
  const failures = summarize(evaluated);
  console.log(
    JSON.stringify({
      mode: "replay",
      scenarios: evaluated.length,
      failing: failures,
      missingTranscripts: coverage.missing,
      assertionPassRate: results.assertionPassRate,
      wroteResults: write,
    }),
  );
  if (!coverage.ok) {
    console.error(`FAIL: golden scenario(s) without a transcript: ${coverage.missing.join(", ")}`);
    process.exit(1);
  }
  if (failures) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv.includes("--live") ? "live" : "replay";
  const write = process.argv.includes("--write");
  (mode === "live" ? live() : Promise.resolve(replay(write))).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
