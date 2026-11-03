// Agent tool contracts and the structured final-answer schema. Human-only tier (see CLAUDE.md):
// an agent may propose a change here in a PR description, never make it.
//
// Each tool input is a Zod schema. It is sent to the API as JSON Schema with `strict: true` and
// `additionalProperties: false`, and every tool input is re-validated with the same Zod schema server-side.
import { z } from "zod";
import { HHMM } from "../../domain/types";

export const NEEDS = ["accessible", "stroller", "quiet", "view", "booth"] as const;

const TableId = z.string().describe('A table id from room state, e.g. "T12".');

export const GetRoomStateInput = z.object({}).strict();

export const FindTablesInput = z
  .object({
    partySize: z.number().int().min(1).max(40).describe("Number of guests in the party."),
    needs: z.array(z.enum(NEEDS)).describe("Seating needs the guest stated; empty array if none."),
  })
  .strict();

export const EstimateFreeTimeInput = z
  .object({ tableIds: z.array(TableId).min(1).max(40) })
  .strict();

export const ProposeCombineInput = z.object({ tableIds: z.array(TableId).min(2).max(6) }).strict();

export const PlanBuildsInput = z
  .object({
    from: HHMM.describe("Window start, HH:MM (24h)."),
    to: HHMM.describe("Window end, HH:MM (24h)."),
  })
  .strict();

export interface ToolSpec {
  name: string;
  description: string;
  input: z.ZodType;
}

export const TOOL_SPECS = [
  {
    name: "get_room_state",
    description:
      "Read the current room: clock, areas (main floor, private rooms grouped in suites whose dividers open, " +
      "service station, bar), every table (status, meal phase, seats, extra chairs it can take, attributes, " +
      "section, area), physically joinable neighbours, tables currently pushed together, what is in storage " +
      "(extenders, spare chairs, spare tables) and upcoming reservations. Read-only.",
    input: GetRoomStateInput,
  },
  {
    name: "find_tables_for_party",
    description:
      "Rank single tables and legal joinable groups that seat a party and meet its needs, squeezing in extra " +
      "chairs from storage when a table is one or two seats short. Each option has seats, extraChairs, " +
      "waitMin (minutes until every table in it is free, from meal phase), freeAt, section load, reasons and " +
      "trade-offs. Also lists tables excluded because they are held for a reservation. Read-only.",
    input: FindTablesInput,
  },
  {
    name: "estimate_free_time",
    description:
      "Estimate minutes until each listed table is free, from its status and meal phase (with the basis for the " +
      "estimate). null minutes = blocked for this service. Read-only.",
    input: EstimateFreeTimeInput,
  },
  {
    name: "propose_combine",
    description:
      "Check whether tables can be pushed together into one long table (shape, adjacency, same area, at most 6) " +
      "and how many seats the result has. Multi-room builds come from plan_builds. Does NOT apply the combine — " +
      "a person does that. Read-only.",
    input: ProposeCombineInput,
  },
  {
    name: "plan_builds",
    description:
      "Generate tonight's layout from tonight's book: for each large party arriving in the window, the tables " +
      "and long-table rows to use, private-room dividers to open, extenders, chairs and spare tables to pull " +
      "from storage (never more than is in stock), the crew build window and the reason; the ordered crew list; " +
      "parties that cannot be placed, each with a plain-language reason; and a summary. Read-only: it is a " +
      "proposal a person edits and applies.",
    input: PlanBuildsInput,
  },
] as const satisfies readonly ToolSpec[];

export type ToolName = (typeof TOOL_SPECS)[number]["name"];

/** The final answer, constrained with structured outputs (`output_config.format`). */
export const FinalOutput = z
  .object({
    answer: z.string(),
    clarifyingQuestion: z.string().nullable(),
    recommendations: z.array(
      z
        .object({
          rank: z.number().int(),
          tables: z.array(TableId),
          seats: z.number().int(),
          waitMin: z.number().int(),
          reasoning: z.string(),
          tradeoffs: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type FinalOutput = z.infer<typeof FinalOutput>;

const UNSUPPORTED = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
]);

/**
 * Zod → JSON Schema for strict tools / structured outputs. Drops keywords the API rejects (numeric and string
 * bounds, maxItems, minItems other than 0/1) — Zod still enforces them server-side — and turns
 * `type: [T, "null"]` into `anyOf`.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === "minItems" && typeof v === "number" && v > 1) continue;
    out[k] = clean(v);
  }
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    delete out.type;
    const rest = { ...out };
    return { anyOf: types.map((t) => (t === "null" ? { type: "null" } : { ...rest, type: t })) };
  }
  if (out.type === "object" && out.additionalProperties === undefined)
    out.additionalProperties = false;
  return out;
}
