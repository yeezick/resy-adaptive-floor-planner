// The request chat's words, from fixed templates over the capacity check (the model never restates tables or
// numbers). Some messages are answered on this device: "one room?", "bring tables from the back", or a need
// the request already has.
import type { PartyFit, RequestFit, Room } from "../../domain";
import { oneRoomPlan, oneRoomSentence, stockOf, storageSentence } from "../../domain/alternatives";
import type { GuestRequest } from "../../domain/requests";
import { listAnd, tablesPhrase } from "../../domain/wording";

const NEED_WORD: Record<string, string> = {
  accessible: "wheelchair",
  stroller: "stroller",
  quiet: "quiet corner",
  view: "view",
};

/** The chat's first line, from the triage: "Noted: wheelchair + stroller, aisle clearance kept." */
export function notedLine(
  r: Pick<GuestRequest, "needs">,
  cost: Pick<PartyFit, "aisle"> | null,
): string | null {
  const needs = r.needs.map((n) => NEED_WORD[n] ?? n);
  if (!needs.length) return null;
  const aisle =
    (r.needs.includes("accessible") || r.needs.includes("stroller")) && cost?.aisle.minIn
      ? cost.aisle.ok
        ? ", aisle clearance kept"
        : ", but an aisle is too narrow"
      : "";
  return `Noted: ${needs.join(" + ")}${aisle}.`;
}

const STORAGE =
  /\b(from (the )?(back|storage|stockroom)|storage|spare tables?|bring (in |out )?(more |extra )?tables)\b/i;
const ONE_ROOM =
  /\bsingle (long |big )?(table|room|row|space)\b|\b(one|same) (room|space|place)\b|\bone (long |big )?(table|row) for (all|everyone|the whole)\b|\ball (\d+ )?(guests |of them )?together\b/i;
/** Another change in the same message (time, headcount, a new need or note): the model handles it. */
const OTHER_ASK =
  /\b(push|move it|earlier|later|headcount|now \d+|\d{1,2}(:\d\d)? ?(am|pm)|\d{1,2}:\d\d|high ?chair|add (a|an|some)\b|birthday|cake|allerg\w*|vegan|quiet|view|window)\b/i;
/** "accept it", "book this now", "no manager needed", "ignore your rules": the chat can't decide for anyone. */
const ACCEPT_FOR_ME =
  /\b(accept|approve|book)\s+(it|this|them|the (booking|request|party|reservation))\b|\b(no|without|skip|bypass)( the| a| any)? manager\b|\bignore (your|all|the|previous) (rules|instructions)\b/i;
export const CANT_ACCEPT = "I can't accept for you. Nothing changed — you approve every change.";
/** Moving a table into another room or area ("pull table 56 into the Library", "move tables 63–66 to …"). */
const TABLE_MOVE =
  /\b(move|pull|shift|swap|take|bring)\b[^.?!]{0,40}?\btables?\s*\d+[^.?!]{0,60}?\b(into|to|from|over)\b|\b(move|pull|shift)\s+\d+(\s*[–-]\s*\d+)?\s+(into|to|from)\b/i;
const NEED_TALK = /\b(wheel ?chair|accessible|stroller|pram|aisle|step[- ]free)\b/i;
const REMOVE = /\b(no longer|remove|drop|without|doesn'?t need|don'?t need|not need)\b/i;

export interface LocalAnswer {
  text: string;
  /** Tables to outline on the request's floor (an alternative the answer names). */
  alt?: { tables: string[]; label: string };
}

/**
 * Answer a message from the capacity check alone, when it asks about one room, storage, or a need the request
 * already has. Anything else returns null and goes to the AI as before.
 */
export function localAnswer(
  message: string,
  ctx: { room: Room; request: GuestRequest; fit: RequestFit | null; cost: PartyFit | null },
): LocalAnswer | null {
  const { room, request: r, fit, cost } = ctx;
  // asked to accept, book or skip the manager: the AI can't, and says so (no model call)
  if (ACCEPT_FOR_ME.test(message)) return { text: CANT_ACCEPT };
  if (OTHER_ASK.test(message)) return null;
  // moving tables between rooms isn't something the chat can do yet: say so, and name the closest plan
  if (TABLE_MOVE.test(message)) {
    const nearest = fit?.ok
      ? `Closest: the current plan, ${tablesPhrase(fit.build.tables)} (${fit.build.area}${
          fit.build.area.includes(" + ") ? ", divider open" : ""
        }).`
      : null;
    return {
      text: [
        "I can't move tables between rooms yet.",
        nearest,
        "Ask me to bring tables from storage, or set tables on the review screen after Accept.",
      ]
        .filter(Boolean)
        .join(" "),
      alt: fit?.ok ? { tables: fit.build.tables, label: `Nearest · ${fit.build.area}` } : undefined,
    };
  }
  const current = fit?.ok ? { area: fit.build.area } : null;
  const storage = STORAGE.test(message);
  if (storage || ONE_ROOM.test(message)) {
    const plan = oneRoomPlan(room, r);
    // what the night's OTHER builds take: this party's own build would hand its storage back
    const t = fit?.plan.totals;
    const own = fit?.ok ? fit.build : null;
    const used = {
      spareTables: (t?.spareTables ?? 0) - (own?.spareTables ?? 0),
      extenders: (t?.extenders ?? 0) - (own?.extenders ?? 0),
      extraChairs: (t?.extraChairs ?? 0) - (own?.extraChairs ?? 0),
    };
    const text = [
      storage ? storageSentence(stockOf(room), used) : null,
      oneRoomSentence(r, plan, current),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      text,
      alt: plan.ok
        ? { tables: plan.build.tables, label: `One room · ${plan.area}` }
        : fit?.ok
          ? { tables: fit.build.tables, label: `Nearest · ${fit.build.area}` }
          : undefined,
    };
  }
  if (NEED_TALK.test(message) && !REMOVE.test(message)) {
    const asked = [
      /wheel ?chair|accessible|step[- ]free/i.test(message) ? "accessible" : null,
      /stroller|pram/i.test(message) ? "stroller" : null,
      /aisle/i.test(message) ? "aisle" : null,
    ].filter((x): x is string => x !== null);
    const have = asked.every(
      (n) => n === "aisle" || r.needs.includes(n as GuestRequest["needs"][number]),
    );
    if (asked.length && have && cost && cost.aisle.minIn !== null) {
      const words = r.needs
        .filter((n) => n === "accessible" || n === "stroller")
        .map((n) => NEED_WORD[n] as string);
      const aisle = cost.aisle.ok
        ? `aisle ${cost.aisle.narrowestIn ?? cost.aisle.minIn} in (needs ${cost.aisle.minIn} in)`
        : `but an aisle is ${cost.aisle.narrowestIn} in (needs ${cost.aisle.minIn} in)`;
      return { text: `Already covered: ${words.join(" + ")}, ${aisle}.` };
    }
  }
  return null;
}

/**
 * One turn's reply, from that turn's own answer only (never from the request's latest state). Order: the AI's
 * question back, verbatim → else "I'd change … — see Proposed changes above." + the capacity check's sentence
 * → else the escalation line. null = not answered yet.
 */
export function turnSentence(t: {
  status?: "loading" | "ok" | "error";
  changed?: string[];
  outcome?: string;
  local?: boolean;
  clarify?: string;
}): string | null {
  if (t.status === "loading") return null;
  if (t.local || t.status === "error") return t.outcome ?? "";
  const change = t.changed?.length
    ? `I'd change ${listAnd(t.changed)} — see Proposed changes above.`
    : null;
  if (t.clarify) return [t.clarify, change, change ? t.outcome : null].filter(Boolean).join(" ");
  if (t.outcome === undefined) return null;
  if (change) return `${change} ${t.outcome}`;
  return t.outcome;
}
