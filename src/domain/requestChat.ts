// In-request chat: a manager types a change to ONE request ("find another space between tables 30–50",
// "headcount is now 26", "they need a high chair and a quiet corner", "can we push it to 19:00?"). The model
// only turns the message into constraints; the solver re-runs the capacity fit with them; the card shows the
// new option and its cost. The model never names a table the solver didn't produce. Every constraint here is
// also a manual control on the sheet.
import { z } from "zod";
import { fitRequest, type RequestFit } from "./buildplan";
import { NEEDS, SERVICE, toReservation, type GuestRequest } from "./requests";
import { toMinutes } from "./time";
import { HHMM, type Room } from "./types";
import { tableNo, tablesPhrase } from "./wording";

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
  })
  .strict();
export type ChatConstraints = z.infer<typeof ChatConstraints>;

export function baseConstraints(r: GuestRequest): ChatConstraints {
  return { tableRange: null, partySize: null, time: null, needs: [...r.needs], notes: [] };
}

/** What the model returns for one chat turn. null / [] = no change to that constraint. */
export const ChatTurnOutput = z
  .object({
    tableRange: TableRange.nullable(),
    partySize: z.number().int().min(1).max(500).nullable(),
    time: z.string().nullable(),
    addNeeds: z.array(z.enum(NEEDS)),
    removeNeeds: z.array(z.enum(NEEDS)),
    notes: z.array(z.string().min(1).max(40)).max(3),
    /** One short question when the message can't be turned into a constraint. */
    clarify: z.string().max(140).nullable(),
  })
  .strict();
export type ChatTurnOutput = z.infer<typeof ChatTurnOutput>;

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

/**
 * Problems that make a turn unusable (empty = valid). Solver-first: every number the model sets must be in the
 * manager's own message, and nothing it writes may name a table.
 */
export function chatTurnProblems(out: ChatTurnOutput, message: string): string[] {
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
  const changes =
    out.tableRange ||
    out.partySize !== null ||
    out.time !== null ||
    out.addNeeds.length ||
    out.removeNeeds.length ||
    out.notes.length;
  if (!changes && !out.clarify) problems.push("no change and no question");
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
  return {
    tableRange: out.tableRange ?? c.tableRange,
    partySize: out.partySize ?? c.partySize,
    time: out.time ?? c.time,
    needs: NEEDS.filter((n) => needs.has(n)),
    notes: notes.slice(-4),
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

/** Re-run the capacity fit for the adjusted request. Deterministic; no model involved. */
export function checkAdjusted(room: Room, r: GuestRequest, c: ChatConstraints): AdjustedFit {
  const req = adjusted(r, c);
  const res = toReservation(req);
  const range = c.tableRange;
  const tables = range ? tablesInRange(room, range) : undefined;
  const fit = fitRequest(room, res, SERVICE.from, SERVICE.to, {
    privateOnly: r.privateRoom,
    tables,
    tablesLabel: range ? rangeLabel(range) : undefined,
  });
  if (fit.ok)
    return {
      request: req,
      fit,
      closest: null,
      line: `Capacity fit: ${tablesPhrase(fit.build.tables)} · ${fit.build.area} · seats ${fit.build.seats} for ${req.partySize} at ${req.time}.`,
    };
  let closest: string | null = fit.nextFit ? `arrive at ${fit.nextFit}` : null;
  if (range) {
    const anywhere = fitRequest(room, res, SERVICE.from, SERVICE.to, {
      privateOnly: r.privateRoom,
    });
    if (anywhere.ok)
      closest = `${tablesPhrase(anywhere.build.tables)} (${anywhere.build.area}), outside tables ${range.from}–${range.to}`;
    else if (!closest && anywhere.nextFit)
      closest = `outside tables ${range.from}–${range.to}, arriving at ${anywhere.nextFit}`;
  }
  const partial = fit.plan.unplaced.find((u) => u.reservationId === r.id)?.partial;
  if (!closest && partial) closest = partial;
  return {
    request: req,
    fit,
    closest,
    line: `No capacity fit ${range ? `${rangeLabel(range)} ` : ""}for ${req.partySize} at ${req.time}.${
      closest ? ` Closest: ${closest}.` : ""
    }`,
  };
}
