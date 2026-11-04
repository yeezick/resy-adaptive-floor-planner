// Shape of public/evals/results.json (written by evals/run.ts, read by /evals). Change both sides together.
import { z } from "zod";
import { CallMetrics } from "./api";

export const ScenarioCategory = z.enum(["walk-in", "constraint", "build-plan", "safety"]);
export type ScenarioCategory = z.infer<typeof ScenarioCategory>;

export const ScenarioResult = z
  .object({
    id: z.string(),
    category: ScenarioCategory,
    prompt: z.string(),
    assertions: z.record(z.string(), z.boolean()),
    assertionsPass: z.boolean(),
    judge: z
      .object({ pass: z.boolean(), critique: z.string(), model: z.string() })
      .strict()
      .nullable(),
    human: z.object({ pass: z.boolean(), reason: z.string() }).strict().nullable(),
    failureModes: z.array(z.string()),
    toolTurns: z.number().int(),
    validatorRejects: z.number().int(),
    latencyMs: z.number(),
    costUsd: z.number(),
    calls: z.array(CallMetrics),
  })
  .strict();
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const Interval = z
  .object({ low: z.number(), high: z.number(), method: z.string() })
  .strict();

export const Rollups = z
  .object({
    recommendations: z.number().int(),
    costPerRecommendationUsd: z.number(),
    latencyP50Ms: z.number(),
    latencyP95Ms: z.number(),
    avgToolTurns: z.number(),
    validatorRejectRate: z.number(), // rejects / recommendations
    spendUsd: z.object({ agent: z.number(), judge: z.number(), total: z.number() }).strict(),
    projectedUsdPer1000: z.number(),
  })
  .strict();
export type Rollups = z.infer<typeof Rollups>;

export const Calibration = z
  .object({
    n: z.number().int(), // human-labeled examples the judge was compared against
    tpr: z.number().nullable(), // judge says pass | human says pass
    tnr: z.number().nullable(), // judge says fail | human says fail
    rawAgreement: z.number().nullable(),
    observedPassRate: z.number().nullable(), // judge pass rate on the run
    correctedPassRate: z.number().nullable(), // corrected for judge TPR/TNR
    correctedInterval: Interval.nullable(),
    trusted: z.boolean(), // TPR and TNR both above threshold
    threshold: z.number(),
    stale: z.boolean(), // prompt version or model changed since calibration
  })
  .strict();
export type Calibration = z.infer<typeof Calibration>;

export const EvalResults = z
  .object({
    runAt: z.string(),
    gitSha: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    judgeModel: z.string().nullable(),
    mode: z.enum(["replay", "live"]),
    scenarios: z.array(ScenarioResult),
    byCategory: z.array(
      z
        .object({ category: ScenarioCategory, n: z.number().int(), assertionPassRate: z.number() })
        .strict(),
    ),
    failureTaxonomy: z.array(
      z.object({ mode: z.string(), count: z.number().int(), example: z.string() }).strict(),
    ),
    assertionPassRate: z.number(),
    assertionInterval: Interval,
    rollups: Rollups,
    calibration: Calibration.nullable(),
    knownLimits: z.array(z.string()),
  })
  .strict();
export type EvalResults = z.infer<typeof EvalResults>;

/**
 * Shape of public/evals/checks.json: the deterministic checks (no model call) that run on every change, written
 * by `evals/run.ts --replay --write`. Read by /evals.
 */
export const CheckGroup = z
  .object({
    id: z.string(),
    label: z.string(),
    what: z.string(),
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type CheckGroup = z.infer<typeof CheckGroup>;

export const DeterministicChecks = z
  .object({ runAt: z.string(), gitSha: z.string(), groups: z.array(CheckGroup) })
  .strict();
export type DeterministicChecks = z.infer<typeof DeterministicChecks>;
