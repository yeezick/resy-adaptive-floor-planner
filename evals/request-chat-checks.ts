// In-request chat evals. Golden scenarios (evals/request-chat/golden.jsonl) pair a manager's message about one
// request with the constraints it should produce. Replay (CI, no key, no cost) runs each recorded model answer
// (evals/request-chat/transcripts/<id>.json) through the same validator, merge and planner as the app:
//   valid         — the answer passes the solver-first validator (numbers only from the message, no table names)
//   constraints   — the merged constraints match the scenario's expectation
//   solver-tables — the planner's option uses only tables in the range (when one is set) and its line names no
//                   "T" id; when nothing fits the line says so in one line
// A few hand-written bad answers check the validator itself. `--live` records fresh answers (costs money).
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  baseConstraints,
  ChatTurnOutput,
  chatTurnProblems,
  checkAdjusted,
  mergeTurn,
  tablesInRange,
  type ChatTurnOutput as Output,
  type GuestRequest,
  type RequestBook,
  type Room,
} from "../src/domain";
import { loadRequestBook } from "../src/server/requests";
import { loadRooms } from "../src/server/rooms";

export const CHAT_GOLDEN_PATH = "evals/request-chat/golden.jsonl";
export const CHAT_TRANSCRIPTS_DIR = "evals/request-chat/transcripts";

export const ChatGolden = z
  .object({
    id: z.string().regex(/^chat-[a-z-]+$/),
    category: z.string(),
    requestId: z.string(),
    message: z.string().min(1).max(300),
    expect: z
      .object({
        tableRange: z.object({ from: z.number(), to: z.number() }).optional(),
        partySize: z.number().optional(),
        time: z.string().optional(),
        needs: z.array(z.string()).optional(),
        notes: z.array(z.string()).optional(),
        /** No constraint may change (a question back, or nothing usable). */
        noChange: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type ChatGolden = z.infer<typeof ChatGolden>;

export const ChatTranscript = z
  .object({
    id: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    /** The validated answer the app would use; null when the app would have escalated. */
    output: ChatTurnOutput.nullable(),
    validatorRejects: z.number().int(),
    costUsd: z.number(),
    latencyMs: z.number(),
  })
  .strict();
export type ChatTranscript = z.infer<typeof ChatTranscript>;

export interface ChatCheck {
  check: "valid" | "constraints" | "solver-tables" | "validator";
  case: string;
  ok: boolean;
  detail?: string;
}

export function loadChatGolden(p = CHAT_GOLDEN_PATH): ChatGolden[] {
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => ChatGolden.parse(JSON.parse(l)));
}

/** Check one scenario against one answer (recorded or live). */
export function checkChatScenario(
  g: ChatGolden,
  output: Output | null,
  book: RequestBook,
  rooms: Map<string, Room>,
): ChatCheck[] {
  const r = book.requests.find((x) => x.id === g.requestId) as GuestRequest;
  const room = rooms.get(r.bookRoomId) as Room;
  const out: ChatCheck[] = [];
  const problems = output ? chatTurnProblems(output, g.message) : [];
  const valid = g.expect.noChange
    ? problems.length === 0
    : output !== null && problems.length === 0;
  out.push({
    check: "valid",
    case: g.id,
    ok: valid,
    detail: valid ? undefined : output ? problems.join("; ") : "no usable answer",
  });
  const base = baseConstraints(r);
  const c = output && problems.length === 0 ? mergeTurn(base, output) : base;
  const e = g.expect;
  const misses: string[] = [];
  if (e.tableRange && JSON.stringify(c.tableRange) !== JSON.stringify(e.tableRange))
    misses.push(`tableRange ${JSON.stringify(c.tableRange)}`);
  if (e.partySize !== undefined && c.partySize !== e.partySize)
    misses.push(`partySize ${c.partySize}`);
  if (e.time !== undefined && c.time !== e.time) misses.push(`time ${c.time}`);
  for (const n of e.needs ?? [])
    if (!c.needs.includes(n as never)) misses.push(`need ${n} missing`);
  for (const n of e.notes ?? [])
    if (!c.notes.some((x) => x.toLowerCase().includes(n.toLowerCase())))
      misses.push(`note "${n}" missing`);
  if (e.noChange && JSON.stringify(c) !== JSON.stringify(base)) misses.push("changed a constraint");
  out.push({
    check: "constraints",
    case: g.id,
    ok: misses.length === 0,
    detail: misses.length ? misses.join("; ") : undefined,
  });
  const a = checkAdjusted(room, r, c);
  const bad: string[] = [];
  if (/\bT\d/.test(a.line)) bad.push("line names a T id");
  if (a.line.includes("\n")) bad.push("line is more than one line");
  if (a.fit.ok && c.tableRange) {
    const allowed = new Set(tablesInRange(room, c.tableRange));
    const outside = a.fit.build.tables.filter((t) => !allowed.has(t));
    if (outside.length) bad.push(`uses tables outside the range: ${outside.join(", ")}`);
  }
  if (!a.fit.ok && !a.line.startsWith("No capacity fit")) bad.push("no-fit line doesn't say so");
  out.push({
    check: "solver-tables",
    case: g.id,
    ok: bad.length === 0,
    detail: bad.length ? bad.join("; ") : a.line,
  });
  return out;
}

const NONE: Output = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
};

/** Hand-written bad answers the validator must reject (model-free). */
export const BAD_ANSWERS: { case: string; message: string; output: Output }[] = [
  {
    case: "invented-range",
    message: "find another space between tables 30–50",
    output: { ...NONE, tableRange: { from: 30, to: 60 } },
  },
  {
    case: "invented-headcount",
    message: "two more people are coming",
    output: { ...NONE, partySize: 24 },
  },
  {
    case: "names-a-table-in-a-note",
    message: "they need a high chair",
    output: { ...NONE, notes: ["high chair at table 45"] },
  },
  {
    case: "time-outside-service",
    message: "can we do 23:30?",
    output: { ...NONE, time: "23:30" },
  },
  {
    case: "claims-booked",
    message: "confirm it",
    output: { ...NONE, clarify: "Booked — anything else?" },
  },
  {
    case: "time-from-a-headcount",
    message: "party of 7 now",
    output: { ...NONE, time: "19:00" },
  },
  { case: "empty", message: "hmm", output: NONE },
];

export function readChatTranscripts(dir = CHAT_TRANSCRIPTS_DIR): Map<string, ChatTranscript> {
  const out = new Map<string, ChatTranscript>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const t = ChatTranscript.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    out.set(t.id, t);
  }
  return out;
}

/** Replay: every golden scenario must have a recorded answer, and every check must pass. */
export function runChatChecks(
  book: RequestBook = loadRequestBook(),
  rooms: Map<string, Room> = loadRooms(),
): ChatCheck[] {
  const golden = loadChatGolden();
  const recorded = readChatTranscripts();
  const out: ChatCheck[] = [];
  for (const g of golden) {
    const t = recorded.get(g.id);
    if (!t) {
      out.push({ check: "valid", case: g.id, ok: false, detail: "no recorded answer" });
      continue;
    }
    out.push(...checkChatScenario(g, t.output, book, rooms));
  }
  for (const b of BAD_ANSWERS)
    out.push({
      check: "validator",
      case: b.case,
      ok: chatTurnProblems(b.output, b.message).length > 0,
      detail: "a bad answer must be rejected",
    });
  return out;
}

/** --live: ask the model for every scenario and record the answers (one retry, like the app). */
async function live(): Promise<void> {
  const { requestChatConfigFromEnv, requestChatTurn } = await import("../src/server/requestChat");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();
  const cfg = requestChatConfigFromEnv((params, options) =>
    client.beta.messages.create(params, options),
  );
  const book = loadRequestBook();
  const rooms = loadRooms();
  let total = 0;
  for (const g of loadChatGolden()) {
    const r = book.requests.find((x) => x.id === g.requestId) as GuestRequest;
    const res = await requestChatTurn(
      r.id,
      {
        message: g.message,
        request: { partySize: r.partySize, day: r.day, time: r.time, needs: r.needs },
        constraints: baseConstraints(r),
      },
      `eval-${g.id}`,
      cfg,
    );
    total += res.metrics.costUsd;
    const t: ChatTranscript = {
      id: g.id,
      promptVersion: res.promptVersion,
      model: res.model,
      output: res.output,
      validatorRejects: res.validatorRejects,
      costUsd: Number(res.metrics.costUsd.toFixed(6)),
      latencyMs: res.metrics.latencyMs,
    };
    writeFileSync(
      path.join(CHAT_TRANSCRIPTS_DIR, `${g.id}.json`),
      `${JSON.stringify(t, null, 2)}\n`,
    );
    const checks = checkChatScenario(g, res.output, book, rooms);
    console.log(
      JSON.stringify({
        id: g.id,
        ok: checks.every((c) => c.ok),
        costUsd: t.costUsd,
        latencyMs: t.latencyMs,
      }),
    );
    for (const c of checks.filter((x) => !x.ok))
      console.error(`  FAIL ${c.check}: ${c.detail ?? ""}`);
  }
  console.log(JSON.stringify({ mode: "live", scenarios: loadChatGolden().length, costUsd: total }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--live"))
    live().catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
  else {
    const checks = runChatChecks();
    for (const c of checks)
      console.log(`${c.ok ? "ok  " : "FAIL"} ${c.check} ${c.case} ${c.detail ?? ""}`);
    if (checks.some((c) => !c.ok)) process.exit(1);
  }
}
