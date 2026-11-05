// Floor edits by conversation: evals. Golden scenarios (evals/floor-chat/golden.jsonl) pair a manager's message
// with what must happen. Three kinds:
//   model  — a recorded model answer (evals/floor-chat/transcripts/<id>.json) goes through the same validator, the
//            same decision code (resolveTurn) and the same floor engine as the app; checks: valid, outcome
//   device — answered on this device with no model call (refusals, plan-state questions); checks: outcome
//   guest  — text inside the guest's own message never reaches the chat model (it isn't in the request body)
// Replay (CI, no key, no cost) runs every check. `--live` records fresh model answers (costs money);
// `--live --only <id,id>` records just those.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  baseConstraints,
  checkAdjusted,
  chatTurnProblems,
  proposeLayoutEdit,
  type GuestRequest,
  type RequestBook,
  type Room,
} from "../src/domain";
import { editImpact } from "../src/domain/floorEdit";
import { resolveTurn } from "../src/domain/floorTurn";
import { checkRequest } from "../src/domain/requests";
import {
  ACCEPT_FOR_ME,
  CANT_ACCEPT,
  editIntent,
  localAnswer,
  seatingRoomNames,
} from "../src/client/requests/chatReply";
import { partyName } from "../src/client/lib/names";
import { RequestChatBody } from "../src/shared/api";
import { loadRequestBook } from "../src/server/requests";
import { loadRooms } from "../src/server/rooms";
import { ChatTranscript } from "./request-chat-checks";

export const FLOOR_GOLDEN_PATH = "evals/floor-chat/golden.jsonl";
export const FLOOR_TRANSCRIPTS_DIR = "evals/floor-chat/transcripts";

export const FloorGolden = z
  .object({
    id: z.string().regex(/^floor-[a-z0-9-]+$/),
    /** "safety …" categories are the adversarial ones. */
    category: z.string(),
    /** The request the chat is about (default Q2, Whitaker); absent when `roomId` is set. */
    requestId: z.string().default("Q2"),
    /** Shift setup on this night (no request): floor changes only. */
    roomId: z.string().optional(),
    message: z.string().min(1).max(300),
    mode: z.enum(["model", "device", "guest"]),
    expect: z
      .object({
        /** The device's answer, exactly; null = the message must go to the model. */
        device: z.string().nullable().optional(),
        /** The reply after the decision code, exactly. */
        reply: z.string().optional(),
        replyMatch: z.string().optional(),
        /** A proposal with a floor change (nothing applied). */
        proposal: z.boolean().optional(),
        planArea: z.string().optional(),
        seats: z.number().optional(),
        bookingsMoved: z.array(z.string()).optional(),
        changes: z.array(z.string()).optional(),
        /** The refusal line follows the proposal (a floor change mixed with an accept). */
        suffix: z.boolean().optional(),
        /** Nothing moves, whatever the model answers. */
        noMove: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type FloorGolden = z.infer<typeof FloorGolden>;

export interface FloorCheck {
  check: "valid" | "outcome" | "routing";
  case: string;
  ok: boolean;
  detail?: string;
}

export function loadFloorGolden(p = FLOOR_GOLDEN_PATH): FloorGolden[] {
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => FloorGolden.parse(JSON.parse(l)));
}

export function readFloorTranscripts(dir = FLOOR_TRANSCRIPTS_DIR): Map<string, ChatTranscript> {
  const out = new Map<string, ChatTranscript>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const t = ChatTranscript.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    out.set(t.id, t);
  }
  return out;
}

interface Night {
  r: GuestRequest | null;
  room: Room;
  planArea: string | null;
  planTables: string[];
}

function nightFor(g: FloorGolden, book: RequestBook, rooms: Map<string, Room>): Night {
  if (g.roomId)
    return { r: null, room: rooms.get(g.roomId) as Room, planArea: null, planTables: [] };
  const r = book.requests.find((x) => x.id === g.requestId) as GuestRequest;
  const room = rooms.get(r.bookRoomId) as Room;
  const fit = checkRequest(room, r);
  return {
    r,
    room,
    planArea: fit.ok ? fit.build.area : null,
    planTables: fit.ok ? fit.build.tables : [],
  };
}

/** Check one scenario (with its recorded or live answer for model scenarios). */
export function checkFloorScenario(
  g: FloorGolden,
  t: ChatTranscript | undefined,
  book: RequestBook,
  rooms: Map<string, Room>,
): FloorCheck[] {
  const n = nightFor(g, book, rooms);
  const e = g.expect;
  const out: FloorCheck[] = [];
  const device = n.r
    ? localAnswer(g.message, { room: n.room, request: n.r, fit: null, cost: null })
    : null;
  if (g.mode === "guest") {
    // the chat body carries only party, day, time and needs: guest text has nowhere to go
    const keys = Object.keys(RequestChatBody.shape).sort().join();
    const req = Object.keys(RequestChatBody.shape.request.shape).sort().join();
    const ok =
      keys === "bookRoomId,constraints,message,planRooms,request" &&
      req === "day,needs,partySize,time";
    return [{ check: "routing", case: g.id, ok, detail: ok ? undefined : `body ${keys} · ${req}` }];
  }
  if (g.mode === "device" || e.device !== undefined) {
    const got = device?.text ?? null;
    const want = e.device ?? null;
    out.push({
      check: "routing",
      case: g.id,
      ok: got === want,
      detail: got === want ? undefined : `device answered ${JSON.stringify(got)}`,
    });
    if (g.mode === "device") return out;
  }
  const output = t?.output ?? null;
  if (!t) return [...out, { check: "valid", case: g.id, ok: false, detail: "no recorded answer" }];
  const problems = output
    ? chatTurnProblems(output, g.message, {
        rooms: seatingRoomNames(n.room),
        floorOnly: !!g.roomId,
      })
    : ["no usable answer (escalated)"];
  // nothing moves when the answer is unusable: that is the safe outcome for noMove scenarios
  if (e.noMove && (!output || problems.length)) {
    out.push({
      check: "valid",
      case: g.id,
      ok: true,
      detail: "escalated or asked back: nothing moves",
    });
    return out;
  }
  out.push({
    check: "valid",
    case: g.id,
    ok: problems.length === 0,
    detail: problems.length ? problems.join("; ") : undefined,
  });
  if (!output || problems.length) return out;

  const misses: string[] = [];
  let reply: string;
  if (!n.r) {
    // Shift setup: the engine alone
    const edit = proposeLayoutEdit(n.room, output.ops, { nameOf: partyName });
    const lines = [...edit.rejects.map((x) => x.text), ...edit.notes];
    reply = edit.ok ? `${edit.changes.length} changes` : `${lines.join(" ")} Nothing changed.`;
    if (e.noMove && edit.ok) misses.push("a table moved");
  } else {
    const latest = baseConstraints(n.r);
    const res = resolveTurn(n.r, latest, output, {
      room: n.room,
      planArea: n.planArea,
      planTables: n.planTables,
      nameOf: partyName,
    });
    if (res.kind === "answer") {
      reply = res.text;
      if (e.proposal) misses.push("no proposal");
    } else {
      const floorRoom = res.floor
        ? { ...res.floor.edited, reservations: n.room.reservations }
        : n.room;
      const a = checkAdjusted(floorRoom, n.r, res.constraints);
      reply = res.changed.length
        ? `I'd change ${res.changed.join(", ")} — see Proposed changes above. ${a.line}`
        : (output.clarify ?? a.line);
      if (e.noMove && res.floor) misses.push("a table moved");
      if (e.proposal && !res.floor) misses.push("no floor change proposed");
      if (e.planArea && (!a.fit.ok || a.fit.build.area !== e.planArea))
        misses.push(`plan ${a.fit.ok ? a.fit.build.area : "no fit"}`);
      if (e.seats !== undefined && (!a.fit.ok || a.fit.build.seats !== e.seats))
        misses.push(`seats ${a.fit.ok ? a.fit.build.seats : "-"}`);
      if (
        e.changes &&
        JSON.stringify(res.floor?.changes.map((c) => c.text)) !== JSON.stringify(e.changes)
      )
        misses.push(`changes ${JSON.stringify(res.floor?.changes.map((c) => c.text))}`);
      if (e.bookingsMoved && res.floor) {
        const im = editImpact(n.room, floorRoom, n.r, res.constraints, partyName);
        if (JSON.stringify(im.bookingsMoved) !== JSON.stringify(e.bookingsMoved))
          misses.push(`bookings moved ${JSON.stringify(im.bookingsMoved)}`);
      }
    }
  }
  if (e.suffix) {
    const mixed = ACCEPT_FOR_ME.test(g.message) && editIntent(g.message, seatingRoomNames(n.room));
    if (!mixed) misses.push("the accept refusal would not follow");
    else reply = `${reply} ${CANT_ACCEPT}`;
  }
  if (e.reply !== undefined && reply !== e.reply) misses.push(`reply ${JSON.stringify(reply)}`);
  if (e.replyMatch && !new RegExp(e.replyMatch).test(reply))
    misses.push(`reply ${JSON.stringify(reply)}`);
  out.push({
    check: "outcome",
    case: g.id,
    ok: misses.length === 0,
    detail: misses.length ? misses.join("; ") : reply,
  });
  return out;
}

export function runFloorChecks(
  book: RequestBook = loadRequestBook(),
  rooms: Map<string, Room> = loadRooms(),
): FloorCheck[] {
  const recorded = readFloorTranscripts();
  return loadFloorGolden().flatMap((g) => checkFloorScenario(g, recorded.get(g.id), book, rooms));
}

/** --live: ask the model for every model scenario and record the answers (one retry, like the app). */
async function live(): Promise<void> {
  const { requestChatConfigFromEnv, requestChatTurn, floorChatTurn } =
    await import("../src/server/requestChat");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();
  const cfg = requestChatConfigFromEnv((params, options) =>
    client.beta.messages.create(params, options),
  );
  const book = loadRequestBook();
  const rooms = loadRooms();
  let total = 0;
  const at = process.argv.indexOf("--only");
  const only = at > 0 ? new Set((process.argv[at + 1] ?? "").split(",")) : null;
  for (const g of loadFloorGolden().filter(
    (x) => x.mode === "model" && (!only || only.has(x.id)),
  )) {
    const n = nightFor(g, book, rooms);
    const ctx = { rooms: seatingRoomNames(n.room) };
    const res = n.r
      ? await requestChatTurn(
          n.r.id,
          {
            message: g.message,
            request: { partySize: n.r.partySize, day: n.r.day, time: n.r.time, needs: n.r.needs },
            constraints: baseConstraints(n.r),
            bookRoomId: n.r.bookRoomId,
            ...(n.planArea ? { planRooms: n.planArea.split(" + ") } : {}),
          },
          `eval-${g.id}`,
          cfg,
          ctx,
        )
      : await floorChatTurn(
          g.roomId as string,
          { message: g.message, roomId: g.roomId as string },
          `eval-${g.id}`,
          cfg,
          ctx,
        );
    const t: ChatTranscript = {
      id: g.id,
      promptVersion: res.promptVersion,
      model: res.model,
      output: res.output,
      validatorRejects: res.validatorRejects,
      costUsd: res.metrics.costUsd,
      latencyMs: res.metrics.latencyMs,
    };
    writeFileSync(
      path.join(FLOOR_TRANSCRIPTS_DIR, `${g.id}.json`),
      `${JSON.stringify(t, null, 2)}\n`,
    );
    total += res.metrics.costUsd;
    const checks = checkFloorScenario(g, t, book, rooms);
    console.log(
      `${g.id}: ${checks.every((c) => c.ok) ? "PASS" : "FAIL"} · $${res.metrics.costUsd.toFixed(5)} · ${res.metrics.latencyMs} ms · stop ${res.metrics.calls.map((c) => c.stopReason).join("/")} · rejects ${res.validatorRejects}${
        checks.every((c) => c.ok)
          ? ""
          : ` · ${checks
              .filter((c) => !c.ok)
              .map((c) => c.detail)
              .join(" | ")}`
      }`,
    );
  }
  console.log(`total $${total.toFixed(4)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--live"))
    live().catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
  else {
    const checks = runFloorChecks();
    for (const c of checks)
      console.log(
        `${c.ok ? "ok  " : "FAIL"} ${c.check} ${c.case}${c.detail ? ` — ${c.detail}` : ""}`,
      );
    if (checks.some((c) => !c.ok)) process.exit(1);
  }
}
