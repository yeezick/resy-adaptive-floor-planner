// One line of evals/golden.jsonl: a scenario the agent is run on, and what a good answer must satisfy.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ScenarioCategory } from "../src/shared/evals";

const NeedEnum = z.enum(["accessible", "stroller", "quiet", "view", "booth"]);

export const Expected = z
  .object({
    /** Party size, when the prompt states it. Used by capacity checks. */
    partySize: z.number().int().positive().optional(),
    /** Needs every recommendation must honour (same semantics as the domain). */
    needs: z.array(NeedEnum).optional(),
    /** Each listed table must appear in at least one recommendation. */
    mustInclude: z.array(z.string()).optional(),
    /** No recommendation may use any listed table. */
    mustExclude: z.array(z.string()).optional(),
    /** The top recommendation's waitMin must be at most this. */
    maxWaitMin: z.number().int().min(0).optional(),
    /** true: a clarifying question and no recommendations. false: no clarifying question. */
    expectClarify: z.boolean().optional(),
    /** true: no recommendations and no clarifying question (says nothing fits). false: at least one recommendation. */
    expectNoFit: z.boolean().optional(),
    /** true: declines the out-of-scope instruction — no recommendations and no prompt leak. */
    expectRefusal: z.boolean().optional(),
    /** Build plans: reservation ids that must be placed and named in the answer or recommendations. */
    expectPlaced: z.array(z.string()).optional(),
    /** Build plans: reservation ids that must be named as not placeable, with a reason, and not placed. */
    expectInfeasible: z.array(z.string()).optional(),
    /** Build plans: whether the plan pulls anything from storage (extenders, chairs, spare tables). */
    expectStorageUsed: z.boolean().optional(),
  })
  .strict();
export type Expected = z.infer<typeof Expected>;

export const GoldenScenario = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    category: ScenarioCategory,
    /** Room id in fixtures/rooms (e.g. "dinner-peak"). */
    room_fixture: z.string(),
    prompt: z.string().min(1).max(500),
    expected: Expected,
    tags: z.array(z.string()),
  })
  .strict();
export type GoldenScenario = z.infer<typeof GoldenScenario>;

export function parseGolden(text: string): GoldenScenario[] {
  const out: GoldenScenario[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`golden.jsonl line ${i + 1}: not JSON`);
    }
    const p = GoldenScenario.safeParse(json);
    if (!p.success) throw new Error(`golden.jsonl line ${i + 1}: ${p.error.issues[0]?.message}`);
    if (ids.has(p.data.id))
      throw new Error(`golden.jsonl line ${i + 1}: duplicate id ${p.data.id}`);
    ids.add(p.data.id);
    out.push(p.data);
  });
  return out;
}

export function loadGolden(path: string): GoldenScenario[] {
  return parseGolden(readFileSync(path, "utf8"));
}
