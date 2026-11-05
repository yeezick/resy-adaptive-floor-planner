// In-request chat: a manager types a change to ONE request ("find another space between tables 30–50",
// "headcount is now 26", "they need a high chair and a quiet corner", "can we push it to 19:00?"). The model
// only turns the message into constraints; the solver re-runs the capacity fit with them; the card shows the
// new option and its cost. The model never names a table the solver didn't produce. Every constraint here is
// also a manual control on the sheet.
import { z } from "zod";
import { fitRequest, LARGE_PARTY, type RequestFit } from "./buildplan";
import { LayoutOp, type TableRef } from "./layoutOps";
import { NEEDS, SERVICE, toReservation, type GuestRequest } from "./requests";
import { toMinutes } from "./time";
import { HHMM, type Room } from "./types";
import { listAnd, tableNo, tablesPhrase } from "./wording";

export const TableRange = z
  .object({ from: z.number().int().min(1).max(999), to: z.number().int().min(1).max(999) })
  .strict();
export type TableRange = z.infer<typeof TableRange>;

/** The request as the manager has adjusted it. null = as the guest asked. */
export const ChatConstraints = z
  .object({
    tableRange: TableRange.nullable(),
    partySize: z.number().int().min(1).max(500).nullable(),
    time: HHMM.nullable(),
    needs: z.array(z.enum(NEEDS)),
    /** Things the planner can't place but the crew should know ("high chair"). */
    notes: z.array(z.string().min(1).max(40)).max(4),
    /** Rooms the party may use ("put them in the Library"); absent = any. */
    rooms: z.array(z.string().min(1).max(40)).max(4).optional(),
    /** Keep the party in any ONE room (the divider closed); absent = either. */
    oneRoom: z.boolean().optional(),
  })
  .strict();
export type ChatConstraints = z.infer<typeof ChatConstraints>;

/** A headcount under 7 needs no table build: the host seats it like any booking. */
export const UNDER_LARGE =
  "Parties under 7 don't need a large-party plan — the host seats them like any booking.";

/** The chat's reply when the AI gave no usable change and no question back (a refusal, or two rejects). */
export const ESCALATED_NOTE =
  "I couldn't turn that into a change. Nothing changed. You can set party, time, tables and needs on the review screen after Accept.";

export function baseConstraints(r: GuestRequest): ChatConstraints {
  return { tableRange: null, partySize: null, time: null, needs: [...r.needs], notes: [] };
}

/**
 * What the model returns for one chat turn. null / [] / "unchanged" = no change to that constraint. New fields are
 * never nullable (the API allows at most 16 union-typed parameters per request): sentinels instead.
 */
const turnFields = {
  tableRange: TableRange.nullable(),
  partySize: z.number().int().min(1).max(500).nullable(),
  time: z.string().nullable(),
  addNeeds: z.array(z.enum(NEEDS)),
  removeNeeds: z.array(z.enum(NEEDS)),
  notes: z.array(z.string().min(1).max(40)).max(3),
  /** One short question when the message can't be turned into a constraint. */
  clarify: z.string().max(140).nullable(),
};
export const ChatTurnOutput = z
  .object({
    ...turnFields,
    /** Rooms the party may use (by name, as typed); [] = no change. */
    rooms: z.array(z.string().max(40)),
    /** "yes" = keep the party in one room (close the divider); "no" = rooms may open; "unchanged". */
    oneRoom: z.enum(["yes", "no", "unchanged"]),
    /** Floor edits for tonight (move, swap, join, split, storage, rows); [] = none. The engine checks them. */
    ops: z.array(LayoutOp),
  })
  .strict();
export type ChatTurnOutput = z.infer<typeof ChatTurnOutput>;

/** The same answer read back from a recording or an older client: the floor-edit fields default to "none". */
export const ChatTurnRecorded = z
  .object({
    ...turnFields,
    rooms: z.array(z.string().max(40)).default([]),
    oneRoom: z.enum(["yes", "no", "unchanged"]).default("unchanged"),
    ops: z.array(LayoutOp).default([]),
  })
  .strict();

const numbersIn = (text: string): Set<number> =>
  new Set([...text.matchAll(/\d+/g)].map((m) => Number(m[0])));

/**
 * Clock times written in the message, as minutes of the day: "19:00", "7:30pm", "7pm", "1900", "at 7" or "to 19". A
 * number that isn't written as a time ("party of 7", "make it 20 people", "a table for 8") doesn't count.
 */
export function timesIn(text: string): Set<number> {
  const out = new Set<number>();
  const add = (h: number, m: number) => {
    if (h >= 0 && h < 24 && m >= 0 && m < 60) out.add(h * 60 + m);
  };
  const t = text.toLowerCase();
  for (const x of t.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/g)) {
    const h = Number(x[1]);
    const m = Number(x[2]);
    if (x[3]?.startsWith("p") && h < 12) add(h + 12, m);
    else if (x[3]) add(h % 12, m);
    else {
      add(h, m);
      if (h < 12) add(h + 12, m);
    }
  }
  for (const x of t.matchAll(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.|o'clock)/g)) {
    const h = Number(x[1]);
    add(x[2]?.startsWith("p") || (x[2] === "o'clock" && h < 12) ? (h % 12) + 12 : h % 12, 0);
  }
  for (const x of t.matchAll(/\b([01]?\d|2[0-3])([0-5]\d)\b/g))
    if ((x[0] ?? "").length >= 3) add(Number(x[1]), Number(x[2]));
  // "for 8" and "up to 8" are headcounts, not times
  for (const x of t.matchAll(
    /\b(?<!\bup\s+)(?:at|to|around|by)\s+(\d{1,2})\b(?!\s*(?:people|guests|covers|pax|of|more|seats|tables?))/g,
  )) {
    const h = Number(x[1]);
    add(h, 0);
    if (h < 12) add(h + 12, 0);
  }
  return out;
}

/** Facts the validator trusts (from the server's own room data, never from the client). */
export interface TurnContext {
  /** The night's seating-room names. */
  rooms?: readonly string[];
  /** Shift setup (no request): only floor changes are allowed. */
  floorOnly?: boolean;
}

const roomKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "");
/** Words that describe a table, not a crew task ("the round 8-top", "a 4-top", "booth"). */
const TABLE_WORDS =
  /\b(\d+-?tops?|round|rectangular|rect|diamond|booth|deuce|four-?top|eight-?top|table)\b/i;

/** Every table number an op's references use, and the room names they mention. */
function refFacts(ops: readonly LayoutOp[]): { numbers: number[]; rooms: string[] } {
  const numbers: number[] = [];
  const rooms: string[] = [];
  const ref = (r: TableRef) => {
    if (r.by === "number") numbers.push(r.n);
    if (r.by === "range") numbers.push(r.from, r.to);
    if (r.by === "description" && r.seats > 0) numbers.push(r.seats);
    if (r.room) rooms.push(r.room);
  };
  for (const o of ops) {
    o.tables.forEach(ref);
    if (o.to) rooms.push(o.to);
    if (o.seats) numbers.push(o.seats);
    numbers.push(...o.rows);
  }
  return { numbers, rooms };
}

/**
 * Problems that make a turn unusable (empty = valid). Solver-first: every number the model sets must be in the
 * manager's own message (a storage count is the one exception: "two 4-tops" → 2), every room must be one of the
 * night's seating rooms, and nothing it writes may name a table.
 */
export function chatTurnProblems(
  out: ChatTurnOutput,
  message: string,
  ctx: TurnContext = {},
): string[] {
  const problems: string[] = [];
  const nums = numbersIn(message);
  if (out.tableRange) {
    const { from, to } = out.tableRange;
    if (from > to) problems.push("table range runs backwards");
    if (!nums.has(from) || !nums.has(to))
      problems.push("table range uses a number the manager didn't type");
  }
  if (out.partySize !== null && !nums.has(out.partySize))
    problems.push("headcount isn't a number from the message");
  if (out.time !== null) {
    if (!HHMM.safeParse(out.time).success) problems.push("time is not HH:MM");
    else {
      const m = toMinutes(out.time);
      if (m < toMinutes(SERVICE.from) || m > toMinutes(SERVICE.to))
        problems.push(`time is outside service (${SERVICE.from}–${SERVICE.to})`);
      if (!timesIn(message).has(m)) problems.push("time isn't one the manager typed");
    }
  }
  const words = [...out.notes, out.clarify ?? ""].join(" \n ");
  if (/\btables?\s*#?\s*\d|\bT\d{1,4}\b/i.test(words)) problems.push("names a table");
  if (out.notes.some((n) => /\d/.test(n))) problems.push("a note carries a number");
  if (/\b(booked|confirmed|reserved|accepted)\b/i.test(words))
    problems.push("says something is booked — nothing is decided");
  // floor edits: table numbers and sizes only as typed; rooms only from tonight's floor
  const facts = refFacts(out.ops);
  if (facts.numbers.some((n) => !nums.has(n)))
    problems.push("a floor change uses a number the manager didn't type");
  if (out.ops.some((o) => o.op === "from_storage" && (o.count < 1 || o.count > 6)))
    problems.push("bring between 1 and 6 tables from storage");
  if (ctx.rooms) {
    const known = new Set(ctx.rooms.map(roomKey));
    const unknown = [...out.rooms, ...facts.rooms].filter((r) => !known.has(roomKey(r)));
    if (unknown.length)
      problems.push(`not a seating room tonight: ${[...new Set(unknown)].join(", ")}`);
    // a crew note that is really a room or a table ("library room", "the round 8-top") is not a note (T13)
    if (out.notes.some((n) => ctx.rooms?.some((r) => roomKey(n).includes(roomKey(r)))))
      problems.push("a note names a room — use rooms or a floor change instead");
  }
  if (out.notes.some((n) => TABLE_WORDS.test(n)))
    problems.push("a note describes a table — use a floor change instead");
  const requestChange =
    out.tableRange ||
    out.partySize !== null ||
    out.time !== null ||
    out.addNeeds.length ||
    out.removeNeeds.length ||
    out.notes.length ||
    out.rooms.length ||
    out.oneRoom !== "unchanged";
  if (ctx.floorOnly && requestChange)
    problems.push("Shift setup has no request: return floor changes only");
  if (!requestChange && !out.ops.length && !out.clarify) problems.push("no change and no question");
  return problems;
}

/** Apply a validated turn on top of the current constraints. */
export function mergeTurn(c: ChatConstraints, out: ChatTurnOutput): ChatConstraints {
  const needs = new Set(c.needs);
  for (const n of out.addNeeds) needs.add(n);
  for (const n of out.removeNeeds) needs.delete(n);
  const notes = [...c.notes];
  for (const n of out.notes)
    if (!notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
  const rooms = out.rooms.length ? out.rooms : c.rooms;
  const oneRoom = out.oneRoom === "unchanged" ? c.oneRoom : out.oneRoom === "yes";
  return {
    tableRange: out.tableRange ?? c.tableRange,
    partySize: out.partySize ?? c.partySize,
    time: out.time ?? c.time,
    needs: NEEDS.filter((n) => needs.has(n)),
    notes: notes.slice(-4),
    // absent unless set, so a turn that doesn't touch them leaves the constraints byte-identical
    ...(rooms?.length ? { rooms: [...rooms] } : {}),
    ...(oneRoom ? { oneRoom: true } : {}),
  };
}

/** The request with the manager's constraints applied (what the solver plans for). */
export function adjusted(r: GuestRequest, c: ChatConstraints): GuestRequest {
  return { ...r, partySize: c.partySize ?? r.partySize, time: c.time ?? r.time, needs: c.needs };
}

/** Floor tables whose number is in the range, inclusive ("between tables 30–50"). */
export function tablesInRange(room: Room, range: TableRange): string[] {
  return room.tables
    .filter((t) => {
      const n = Number(tableNo(t.id));
      return Number.isInteger(n) && n >= range.from && n <= range.to;
    })
    .map((t) => t.id);
}

export const rangeLabel = (r: TableRange) => `in tables ${r.from}–${r.to}`;

/** What one turn changed: the change-list entries after it that weren't there before it. */
export function changeDelta(
  r: GuestRequest,
  before: ChatConstraints,
  after: ChatConstraints,
): string[] {
  const had = new Set(changeList(r, before));
  return changeList(r, after).filter((x) => !had.has(x));
}

/** What changed versus the guest's request, for the card and the activity log ("party 26", "19:00"). */
export function changeList(r: GuestRequest, c: ChatConstraints): string[] {
  const out: string[] = [];
  if (c.tableRange) out.push(`tables ${c.tableRange.from}–${c.tableRange.to}`);
  if (c.partySize !== null && c.partySize !== r.partySize) out.push(`party of ${c.partySize}`);
  if (c.time !== null && c.time !== r.time) out.push(`at ${c.time}`);
  const added = c.needs.filter((n) => !r.needs.includes(n));
  const removed = r.needs.filter((n) => !c.needs.includes(n));
  if (added.length) out.push(`needs ${added.join(", ")}`);
  if (removed.length) out.push(`no longer ${removed.join(", ")}`);
  if (c.rooms?.length) out.push(`only the ${listAnd(c.rooms)}`);
  if (c.oneRoom) out.push("one room");
  for (const n of c.notes) out.push(n);
  return out;
}

export interface AdjustedFit {
  request: GuestRequest;
  fit: RequestFit;
  /** One line for the card: the new option, or why nothing fits. */
  line: string;
  /** When nothing fits: the closest option the solver found (outside the range, or later). */
  closest: string | null;
}

/** Where the manager's constraints let the party sit: a table range, named rooms, both, or anywhere (undefined). */
function allowedTables(room: Room, c: ChatConstraints): { tables?: string[]; label?: string } {
  const range = c.tableRange;
  const inRooms = c.rooms?.length ? new Set(c.rooms.map((n) => n.trim().toLowerCase())) : null;
  if (!range && !inRooms) return {};
  const ids = room.tables
    .filter((t) => !inRooms || inRooms.has(t.area.toLowerCase()))
    .map((t) => t.id);
  const tables = range ? tablesInRange(room, range).filter((id) => ids.includes(id)) : ids;
  const label = [
    range ? rangeLabel(range) : null,
    inRooms ? `in the ${listAnd(c.rooms ?? [])}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { tables, label };
}

/** Re-run the capacity fit for the adjusted request. Deterministic; no model involved. */
export function checkAdjusted(room: Room, r: GuestRequest, c: ChatConstraints): AdjustedFit {
  const req = adjusted(r, c);
  // the planner places parties of 7+; a smaller party is seated like any booking
  if (req.partySize < LARGE_PARTY) {
    const fit = fitRequest(room, toReservation(req), SERVICE.from, SERVICE.to, {
      latest: req.time,
    });
    return { request: req, fit, closest: null, line: UNDER_LARGE };
  }
  if (c.oneRoom) return checkOneRoom(room, r, req, c);
  const res = toReservation(req);
  const range = c.tableRange;
  const allowed = allowedTables(room, c);
  const tables = allowed.tables;
  const fit = fitRequest(room, res, SERVICE.from, SERVICE.to, {
    privateOnly: r.privateRoom,
    tables,
    tablesLabel: allowed.label,
  });
  if (fit.ok)
    return {
      request: req,
      fit,
      closest: null,
      line: `Capacity fit: ${tablesPhrase(fit.build.tables)} · ${fit.build.area} · seats ${fit.build.seats} for ${req.partySize} at ${req.time}.`,
    };
  let closest: string | null = fit.nextFit ? `arrive at ${fit.nextFit}` : null;
  if (tables) {
    const anywhere = fitRequest(room, res, SERVICE.from, SERVICE.to, {
      privateOnly: r.privateRoom,
    });
    const outside =
      range && !c.rooms?.length ? `outside tables ${range.from}–${range.to}` : "elsewhere";
    if (anywhere.ok)
      closest = `${tablesPhrase(anywhere.build.tables)} (${anywhere.build.area}), ${outside}`;
    else if (!closest && anywhere.nextFit) closest = `${outside}, arriving at ${anywhere.nextFit}`;
  }
  const partial = fit.plan.unplaced.find((u) => u.reservationId === r.id)?.partial;
  if (!closest && partial) closest = partial;
  return {
    request: req,
    fit,
    closest,
    line: `No capacity fit ${allowed.label ? `${allowed.label} ` : ""}for ${req.partySize} at ${req.time}.${
      closest ? ` Closest: ${closest}.` : ""
    }`,
  };
}

/**
 * The party kept in ONE room (the divider closed): each allowed room is tried at the asked time with its own
 * tables plus storage; the first fit with the least storage wins. When none fits, the closest is the room that
 * comes nearest in seats.
 */
function checkOneRoom(
  room: Room,
  r: GuestRequest,
  req: GuestRequest,
  c: ChatConstraints,
): AdjustedFit {
  const res = toReservation(req);
  const allowed = allowedTables(room, { ...c, oneRoom: false });
  const pool = allowed.tables ? new Set(allowed.tables) : null;
  const areas = [...new Set(room.tables.filter((t) => !pool || pool.has(t.id)).map((t) => t.area))];
  const fits: RequestFit[] = [];
  let first: RequestFit | null = null;
  let largest: { area: string; seats: number } | null = null;
  for (const area of areas) {
    const tables = room.tables
      .filter((t) => t.area === area && (!pool || pool.has(t.id)))
      .map((t) => t.id);
    const f = fitRequest(room, res, SERVICE.from, SERVICE.to, {
      privateOnly: r.privateRoom,
      tables,
      tablesLabel: `in the ${area}`,
      latest: req.time,
    });
    first ??= f;
    if (f.ok) {
      if (!f.build.area.includes(" + ")) fits.push(f);
      continue;
    }
    const m = /largest: (\d+)/.exec(f.reason);
    const seats = m ? Number(m[1]) : 0;
    if (seats > 0 && (!largest || seats > largest.seats)) largest = { area, seats };
  }
  const best = fits.sort((a, b) =>
    a.ok && b.ok
      ? a.build.spareTables + a.build.extenders - (b.build.spareTables + b.build.extenders) ||
        a.build.tables.length - b.build.tables.length
      : 0,
  )[0];
  if (best?.ok)
    return {
      request: req,
      fit: best,
      closest: null,
      line: `Capacity fit: ${tablesPhrase(best.build.tables)} · ${best.build.area} · seats ${best.build.seats} for ${req.partySize} at ${req.time}.`,
    };
  const closest = largest ? `${largest.area}, ${largest.seats} seats` : null;
  const fit: RequestFit =
    first && !first.ok
      ? { ...first, reason: `No single room fits ${req.partySize} at ${req.time}.` }
      : {
          ok: false,
          reason: `No single room fits ${req.partySize} at ${req.time}.`,
          nextFit: null,
          plan: fitRequest(room, res, SERVICE.from, SERVICE.to, { latest: req.time }).plan,
        };
  return {
    request: req,
    fit,
    closest,
    line: `No capacity fit in one room for ${req.partySize} at ${req.time}.${closest ? ` Closest: ${closest}.` : ""}`,
  };
}
