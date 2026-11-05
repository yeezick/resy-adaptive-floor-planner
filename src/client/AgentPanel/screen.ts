// What the host's screen adds to an AI Planner message, all by rule (no model): the party size it already knows,
// the night's open large-party requests by guest name, floor-edit asks answered on the device, and party names in
// place of reservation ids in the answer text.
import type { GuestRequest } from "../../domain/requests";
import { plainTables } from "../../domain/wording";
import { MAX_OPEN_REQUESTS, type OpenRequestBrief } from "../../shared/api";
import { namesIn, surname } from "../lib/names";
import { partyFromMessage } from "../lib/service";

/** The device's answer to a floor-edit ask: the AI Planner recommends seating; it never changes the floor. */
export const FLOOR_EDIT_ANSWER =
  "Floor changes are made in Shift setup or a request's Discuss chat — nothing changed.";

const ROOMS = "(?:atrium|cellar|dining room|gallery|garden room|library|loft|terrace|east suite)";
const VERB =
  "(?:move|moving|moved|pull|pulling|swap|swapping|put|putting|bring|bringing|add|adding|remove|removing|push|pushing|join|joining|split|splitting)";
/** A table number: "56", "T56", "table 56" — not a headcount, time or wait ("2 people", "8:30", "10 min"). */
const NUM =
  "(?:t|tables?\\s*)?\\d{1,3}(?![\\d:])(?!\\s*(?:more|extra|people|persons?|guests?|pax|covers?|kids?|adults?|min|mins|minutes?|hours?|hrs?|pm|am|p\\.m|a\\.m|o'?clock|now|-?\\s?tops?)\\b)";
/** Furniture, after up to three describing words ("2 chairs", "the Library tables", "out 2 more chairs"). */
const THING =
  "(?:(?!(?:them|they|him|her|us|it|to|at|into|in|on|by|from|for|with)\\b)[\\w'-]+\\s+){0,3}?(?:tables?|chairs?|booths?|dividers?|partitions?)\\b";
const OBJECT = `(?:the\\s+|a\\s+|an\\s+|some\\s+|those\\s+|these\\s+|both\\s+)?(?:${THING}|${NUM})`;
const EDIT = new RegExp(`\\b${VERB}\\s+${OBJECT}`, "i");
/** Dividers and rooms: "open the divider", "close the rooms between …", "open up the Library". */
const DIVIDER = new RegExp(
  `\\b(?:open|opening|close|closing)\\s+(?:up\\s+)?(?:the\\s+)?(?:dividers?|partitions?|walls?|doors?|rooms?\\s+between|${ROOMS})\\b`,
  "i",
);
/** "take table 81 out", "take out 2 tables", "take the Terrace tables away" — not "can they take table 12?". */
const TAKE_OUT = new RegExp(
  `\\btak(?:e|es|ing)\\s+(?:(?:out|away)\\s+${OBJECT}|${OBJECT}\\s+(?:out|away)\\b)`,
  "i",
);

/**
 * True when the host asks the AI Planner to change the floor: move, swap, join or split tables, add chairs, bring
 * tables from storage, or open or close a divider. A seating ask ("seat them at 41", "they want the Terrace") is not.
 */
export function isFloorEdit(message: string): boolean {
  return EDIT.test(message) || DIVIDER.test(message) || TAKE_OUT.test(message);
}

/** Clock times and durations ("8:30", "9 pm", "15 minutes") are never a headcount. */
function withoutTimes(text: string): string {
  return text
    .replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ")
    .replace(/\b\d{1,3}\s*(?:[ap]\.?m\.?|o'?clock|min|mins|minutes?|hrs?|hours?)(?![a-z])/gi, " ");
}

/** "they're 10 now", "now 6": a corrected headcount the general reader misses. */
function correctedParty(text: string): number | undefined {
  const m =
    /\b(?:they(?:'re| are)|we(?:'re| are)|now)\s+(\d{1,3})\b(?!\s*(?:min|minutes?|pm|am|:))/i.exec(
      text,
    ) ?? /\b(\d{1,3})\s+now\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : undefined;
}

/** Party size stated in one host message, if any. */
export function partyInMessage(text: string): number | undefined {
  const plain = withoutTimes(text);
  return partyFromMessage(plain) ?? correctedParty(plain);
}

/**
 * The party size to send with a message: the message itself, else the latest one the host stated in this
 * thread, else what the screen knows (the walk-in form or the open request the AI Planner was opened from).
 */
export function partyForMessage(
  message: string,
  earlier: readonly string[],
  screen: number | undefined,
): number | undefined {
  const own = partyInMessage(message);
  if (own !== undefined) return own;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const n = partyInMessage(earlier[i] ?? "");
    if (n !== undefined) return n;
  }
  return screen;
}

/** The night's open requests as the AI Planner sees them: guest name, size, time, needs (never an id). */
export function openRequestBriefs(requests: readonly GuestRequest[]): OpenRequestBrief[] {
  return requests.slice(0, MAX_OPEN_REQUESTS).map((r) => ({
    name: surname(r.contact).slice(0, 60),
    partySize: r.partySize,
    time: r.time,
    needs: [...new Set(r.needs)],
  }));
}

/** AI Planner text for the host: "T41" → "table 41", "F4" → the party's name. */
export function plannerText(text: string): string {
  // a name ending in an initial at a sentence end ("for F1." → "for Oduya, C.") keeps one full stop
  return namesIn(plainTables(text)).replace(/(, [A-Z]\.)\./g, "$1");
}
