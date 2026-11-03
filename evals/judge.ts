// LLM judge (advisory, never a CI gate — ADR-0003). A different model than the agent grades each recorded
// transcript PASS/FAIL against evals/rubric.md, under the per-run dollar budget. Verdicts go to
// evals/judgements.jsonl; results.json is then refreshed.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { CallMetrics } from "../src/shared/api";
import { FALLBACK_BETA, type CreateMessage } from "../src/server/agent/loop";
import { toStrictJsonSchema } from "../src/server/agent/schemas";
import { checkEffort, validateEnv } from "../src/server/config";
import { SpendBudget } from "../src/server/guards/budget";
import { logCall } from "../src/server/log";
import { reservationUsd } from "../src/server/pricing";
import { callMetrics } from "../src/server/metrics";
import { briefToolCalls } from "./labelsheet";
import { refreshResults } from "./results";
import { runBudgetUsd } from "./run";
import {
  EVALS_DIR,
  Judgement,
  JUDGEMENTS_PATH,
  readTranscripts,
  type Transcript,
} from "./transcript";

export const JUDGE_MAX_TOKENS = 4000;

export const Verdict = z.object({ pass: z.boolean(), critique: z.string() }).strict();
export type Verdict = z.infer<typeof Verdict>;

export function rubricVersion(rubric: string): string {
  return `rubric.draft-${createHash("sha256").update(rubric).digest("hex").slice(0, 8)}`;
}

/** What the judge reads: the request, the tool trace (results clipped) and the final answer. */
export function renderForJudge(t: Transcript): string {
  const r = t.response;
  const tools = (t.trace?.tools ?? []).map((c) => ({
    tool: c.name,
    input: c.input,
    ...(c.ok ? { result: JSON.stringify(c.output).slice(0, 4000) } : { error: c.error }),
  }));
  return [
    "<host_request>",
    t.scenario.prompt,
    "</host_request>",
    "<tool_calls>",
    JSON.stringify(tools, null, 1),
    "</tool_calls>",
    "<tool_calls_brief>",
    ...briefToolCalls(t),
    "</tool_calls_brief>",
    "<final_answer>",
    JSON.stringify(
      r
        ? {
            answer: r.answer,
            clarifyingQuestion: r.clarifyingQuestion,
            recommendations: r.recommendations,
          }
        : null,
      null,
      1,
    ),
    "</final_answer>",
    "Grade this run against the rubric.",
  ].join("\n");
}

export interface JudgeOutcome {
  judgement: Judgement | null;
  /** Paid for whether or not a verdict came back. */
  calls: CallMetrics[];
  /** Why there is no verdict (refusal, cut off, bad format). Ungraded runs are left out, not counted as FAIL. */
  skipped?: string;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function judgeTranscript(
  t: Transcript,
  opts: { create: CreateMessage; model: string; effort: "low" | "medium" | "high"; rubric: string },
): Promise<JudgeOutcome> {
  const t0 = Date.now();
  const msg = await opts.create({
    model: opts.model,
    max_tokens: JUDGE_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: opts.rubric,
    output_config: {
      effort: opts.effort,
      format: { type: "json_schema", schema: toStrictJsonSchema(Verdict) },
    },
    messages: [{ role: "user", content: renderForJudge(t) }],
  });
  const m = callMetrics(msg, {
    traceId: `judge-${t.id}-${t0}`,
    role: "judge",
    promptVersion: rubricVersion(opts.rubric),
    latencyMs: Date.now() - t0,
    requestedModel: opts.model,
  });
  logCall(m);
  if (msg.stop_reason !== "end_turn")
    return { judgement: null, calls: [m], skipped: `judge stopped: ${msg.stop_reason}` };
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = Verdict.safeParse(safeJson(text));
  if (!parsed.success)
    return {
      judgement: null,
      calls: [m],
      skipped: "judge output did not match the verdict format",
    };
  return {
    calls: [m],
    judgement: Judgement.parse({
      id: t.id,
      pass: parsed.data.pass,
      critique: parsed.data.critique,
      model: msg.model,
      agentPromptVersion: t.promptVersion,
      agentModel: t.response?.model ?? t.model,
      judgedAt: new Date().toISOString(),
      calls: [m],
    }),
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("evals:judge needs ANTHROPIC_API_KEY.");
    process.exit(2);
  }
  const transcripts = readTranscripts().filter((t) => t.response);
  if (!transcripts.length) {
    console.log("No completed transcripts in evals/transcripts/ — nothing to judge.");
    return;
  }
  validateEnv({ judge: true });
  const model = process.env.JUDGE_MODEL ?? "claude-sonnet-5-5";
  if (transcripts.some((t) => (t.response?.model ?? t.model) === model))
    console.warn(`warning: JUDGE_MODEL ${model} is also the agent model.`);
  const effort = checkEffort("JUDGE_EFFORT", process.env.JUDGE_EFFORT ?? "medium");
  if (effort !== "low" && effort !== "medium" && effort !== "high")
    throw new Error("JUDGE_EFFORT must be low|medium|high");
  const rubric = readFileSync(path.join(EVALS_DIR, "rubric.md"), "utf8");
  const client = new Anthropic();
  const create: CreateMessage = (p, o) => client.beta.messages.create(p, o);
  // Budget granularity: one judge call per scenario. Each call reserves its worst case (JUDGE_MAX_TOKENS of
  // output + an over-estimate of input) before it starts, so the run passes the budget by at most one call.
  const budget = new SpendBudget(runBudgetUsd());
  let spent = 0;
  const out: Judgement[] = [];
  for (const [i, t] of transcripts.entries()) {
    if (budget.exhausted()) {
      console.log(
        `ABORTED: judge spend $${spent.toFixed(4)} reached the $${budget.limitUsd} budget; ${transcripts.length - i} left.`,
      );
      break;
    }
    const reserved = reservationUsd(
      model,
      JUDGE_MAX_TOKENS,
      rubric.length + renderForJudge(t).length,
    );
    const hold = budget.reserve(reserved);
    let r: JudgeOutcome;
    try {
      r = await judgeTranscript(t, { create, model, effort, rubric });
    } catch (e) {
      hold.settle(reserved);
      throw e;
    }
    const cost = r.calls.reduce((n, c) => n + c.costUsd, 0);
    hold.settle(cost);
    spent += cost;
    if (!r.judgement) {
      console.log(`SKIP  ${t.id}  ${r.skipped}`);
      continue;
    }
    out.push(r.judgement);
    console.log(`${r.judgement.pass ? "PASS" : "FAIL"}  ${t.id}  ${r.judgement.critique}`);
  }
  writeFileSync(
    JUDGEMENTS_PATH,
    out.map((j) => JSON.stringify(j)).join("\n") + (out.length ? "\n" : ""),
  );
  refreshResults();
  console.log(JSON.stringify({ judged: out.length, judgeModel: model, spendUsd: spent }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
