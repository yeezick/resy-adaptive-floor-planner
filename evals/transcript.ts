// Recorded agent runs (evals/transcripts/<id>.json) and the other files the eval scripts share.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentResponse, CallMetrics } from "../src/shared/api";
import { GoldenScenario } from "./golden.schema";

export const EVALS_DIR = path.resolve(process.cwd(), "evals");
export const TRANSCRIPTS_DIR = path.join(EVALS_DIR, "transcripts");
export const GOLDEN_PATH = path.join(EVALS_DIR, "golden.jsonl");
export const JUDGEMENTS_PATH = path.join(EVALS_DIR, "judgements.jsonl");
export const LABELS_PATH = path.join(EVALS_DIR, "labels.jsonl");
export const LABELS_META_PATH = path.join(EVALS_DIR, "labels.meta.json");
export const TAXONOMY_PATH = path.join(EVALS_DIR, "taxonomy.json");
export const RUN_MANIFEST_PATH = path.join(TRANSCRIPTS_DIR, "_run.json");
export const RESULTS_PATH = path.resolve(process.cwd(), "public/evals/results.json");

export const ToolTrace = z
  .object({
    turn: z.number().int(),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
    ok: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();

export const Transcript = z
  .object({
    id: z.string(),
    scenario: GoldenScenario,
    recordedAt: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    effort: z.string(),
    status: z.enum(["ok", "error"]),
    error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    /** The /api/agent-shaped response; null when the run failed. */
    response: AgentResponse.nullable(),
    trace: z
      .object({
        tools: z.array(ToolTrace),
        partySize: z.number().int().optional(),
        validatorProblems: z.array(z.array(z.object({ rank: z.number(), message: z.string() }))),
        stopReasons: z.array(z.string().nullable()),
      })
      .strict()
      .nullable(),
    /** Calls paid for by a failed run (successful runs carry them in response.metrics.calls). */
    errorCalls: z.array(CallMetrics),
    latencyMs: z.number(),
  })
  .strict();
export type Transcript = z.infer<typeof Transcript>;

export const RunManifest = z
  .object({
    startedAt: z.string(),
    finishedAt: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    budgetUsd: z.number(),
    spentUsd: z.number(),
    aborted: z.boolean(),
    abortReason: z.string().nullable(),
    ran: z.array(z.string()),
    skipped: z.array(z.string()),
  })
  .strict();
export type RunManifest = z.infer<typeof RunManifest>;

export const Judgement = z
  .object({
    id: z.string(),
    pass: z.boolean(),
    critique: z.string(),
    model: z.string(),
    /** Agent prompt version and model of the transcript that was judged. */
    agentPromptVersion: z.string(),
    agentModel: z.string(),
    judgedAt: z.string(),
    calls: z.array(CallMetrics),
  })
  .strict();
export type Judgement = z.infer<typeof Judgement>;

/** Human label (evals/labels.jsonl). Human-only tier. */
export const Label = z.object({ id: z.string(), pass: z.boolean(), reason: z.string() }).strict();
export type Label = z.infer<typeof Label>;

/** The run the human labels were made against (written by labelsheet.ts at the start of a labeling round). */
export const LabelsMeta = z
  .object({
    promptVersion: z.string(),
    model: z.string(),
    createdAt: z.string(),
    ids: z.array(z.string()),
  })
  .strict();
export type LabelsMeta = z.infer<typeof LabelsMeta>;

/** evals/taxonomy.json: maps failed assertions to named failure modes. */
export const Taxonomy = z.array(
  z
    .object({
      mode: z.string(),
      description: z.string().optional(),
      assertions: z.array(z.string()),
    })
    .strict(),
);
export type Taxonomy = z.infer<typeof Taxonomy>;

export function readTranscripts(dir = TRANSCRIPTS_DIR): Transcript[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort()
    .map((f) => {
      const p = Transcript.safeParse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
      if (!p.success)
        throw new Error(
          `transcript ${f}: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`,
        );
      return p.data;
    });
}

export function readJsonl<T>(file: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      const p = schema.safeParse(JSON.parse(l));
      if (!p.success)
        throw new Error(`${path.basename(file)} line ${i + 1}: ${p.error.issues[0]?.message}`);
      return p.data;
    });
}

export function readJson<T>(file: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(file)) return null;
  return schema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Every Anthropic call a transcript paid for. */
export function transcriptCalls(t: Transcript) {
  return t.response ? t.response.metrics.calls : t.errorCalls;
}
