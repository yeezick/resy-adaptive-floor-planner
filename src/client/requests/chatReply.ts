// The request chat's words, from fixed templates over the capacity check (the model never restates tables or
// numbers). Some messages are answered on this device: "one room?", "bring tables from the back", or a need
// the request already has.
import type { PartyFit, RequestFit, Room } from "../../domain";
import { oneRoomPlan, oneRoomSentence, stockOf, storageSentence } from "../../domain/alternatives";
import { checkRequest, SERVICE, type GuestRequest } from "../../domain/requests";
import { clock12, toHHMM, toMinutes } from "../../domain/time";
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
/**
 * "accept it", "book this now", "confirm the booking", "no manager needed": the chat can't decide for anyone, and
 * says so on this device (the refusal never depends on the model).
 */
export const ACCEPT_ASK =
  /\b(accept|approve|book|confirm)\s+(it|this|them|(the|this|their) (booking|request|party|reservation|guests?))\b|\b(no|without|skip|bypass)( the| a| any)? manager\b/i;
/** "ignore your rules", "ignore previous instructions": answered on this device when nothing else is asked. */
export const INJECTION = /\bignore (your|all|the|previous) (rules|instructions)\b/i;
export const CANT_SET_ASIDE_RULES = "I can't set aside my rules. Nothing changed.";
/**
 * Does the message ask for anything besides an accept or an injection phrase? A floor edit, or a change such as a
 * new headcount or time, checked with those phrases taken out. Then the model + engine handle it (never the device
 * line, which would drop the change).
 */
export function hasOtherAsk(message: string, rooms: readonly string[]): boolean {
  const rest = message
    .replace(new RegExp(ACCEPT_ASK.source, "gi"), " ")
    .replace(new RegExp(INJECTION.source, "gi"), " ");
  return editIntent(rest, rooms) || OTHER_ASK.test(rest);
}
/** The bar, walls and the service station aren't tables. */
const FIXED_THINGS =
  /\b(move|shift|pull|push|take|put|swap|knock down|remove)\s+(the\s+)?(bar|walls?|service station)\b/i;
export const CANT_MOVE_FIXED =
  "I can't move the bar, walls or the service station — only tables. Nothing changed.";
/** Changing the base layout, or deleting tables. */
const BASE_OR_DELETE =
  /\b(save|make|set|change|update)\b[^.?!]{0,30}\b(base|default|permanent) (layout|floor|plan)\b|\bdelete\b[^.?!]{0,25}\btables?\b/i;
export const ONLY_TONIGHT =
  "I only change tonight's floor — not the base layout, and I don't delete tables. Nothing changed.";
const EDIT_VERB =
  /\b(move|moving|pull|swap|put|take|bring|add|remove|push|pushed|join|split|open|close|shift)\b/i;
/** A table number written as one ("table 56", "tables 63–66", "move 56", "66 and 67", "82-86"). */
const TABLE_NUMBER =
  /\btables?\s*#?\s*\d{1,3}\b|\b(move|pull|swap|put|take|bring|push|join|split|remove|shift)\s+\d{1,3}\b|\b\d{1,3}\s*(?:and|&|[-–])\s*\d{1,3}\b/i;

/**
 * Does the message ask to change the floor? A table number or a seating-room name together with an edit verb,
 * or a storage phrase that names a room ("bring two 4-tops from the back into the Library"). Such a message goes
 * to the AI + the floor engine, before the other device answers; a one-room question with no edit stays here.
 */
export function editIntent(message: string, rooms: readonly string[]): boolean {
  if (!EDIT_VERB.test(message)) return false;
  const m = message.toLowerCase();
  const namesRoom = rooms.some((r) => m.includes(r.toLowerCase()));
  return TABLE_NUMBER.test(message) || namesRoom;
}

/** Seating rooms by name (the chat's trusted list, here from the floor in use). */
export function seatingRoomNames(room: Room): string[] {
  return room.areas.filter((a) => a.kind === "dining" || a.kind === "private").map((a) => a.name);
}

/** A floor change the chat refuses outright (the bar, walls, the base layout, deleting tables), or null. */
export function floorRefusal(message: string): string | null {
  if (FIXED_THINGS.test(message)) return CANT_MOVE_FIXED;
  if (BASE_OR_DELETE.test(message)) return ONLY_TONIGHT;
  return null;
}

/** "can we do 6 instead": a lone number could be a headcount or a time. */
const LONE_NUMBER =
  /^\s*(?:(?:can|could) we |let'?s |how about |what about )?(?:do |make it |try |go with )?(\d{1,2})(?: instead)?\s*[?.!]?\s*$/i;
const QUIET_ASK = /\b(quiet|noisy|loud)\b[^.]*\?|\bquiet enough\b/i;
export const CANT_ACCEPT = "I can't accept for you. Nothing changed — you approve every change.";
/** An accept ask while a change proposed in chat waits for Apply or Discard. */
export const CANT_ACCEPT_PENDING =
  "I can't accept for you — apply or discard the change first, then you approve the booking.";
/** An accept ask whose change was applied (or applied and then reverted or undone). */
export const CANT_ACCEPT_AFTER = "I can't accept for you — you approve the booking.";

/** What became of the change a turn proposed, as the chat shows it now (absent = no proposal). */
export type ProposalStatus =
  "pending" | "applied" | "discarded" | "reverted" | "undone" | "replaced";

/** The accept line, from the status of the proposal it refers to (never "Nothing changed" beside a live one). */
export function acceptLine(status: ProposalStatus | undefined): string {
  if (status === "pending") return CANT_ACCEPT_PENDING;
  if (status === "applied" || status === "reverted" || status === "undone")
    return CANT_ACCEPT_AFTER;
  return CANT_ACCEPT;
}

/**
 * Shift setup's one reply per night: "I'd change the floor (2 changes)" + where the change is now: "— see Proposed
 * floor change below." while it waits, "(applied)" / "(discarded)" / "(undone)" after.
 */
export function floorReplyText(base: string, status: ProposalStatus | undefined): string {
  if (!status || status === "pending") return `${base} — see Proposed floor change below.`;
  return `${base} (${status}).`;
}

/** The proposal card's capacity row: "unchanged (…plan…)" when the floor change leaves the plan as it is (G6). */
export function capacityCheckText(before: string, after: string): string {
  return before === after ? `unchanged (${before})` : `${before} → ${after}`;
}
/** "latest/earliest we could seat them", "how late can they arrive", "last possible time". */
const SWEEP =
  /\b(latest|earliest|last|first)\b[^.?!]{0,30}\b(seat|seating|time|arrival|arrive|start|sitting|slot)\w*|\bhow (late|early)\b/i;

/**
 * The latest (or earliest) arrival, in 15-minute steps over service, at which the capacity check still fits
 * the party (in the named room, when one is named). Deterministic; the same check the card runs.
 */
export function sweepTimes(
  room: Room,
  r: GuestRequest,
  which: "latest" | "earliest",
  area: string | null,
): { time: string; tables: string[]; area: string } | null {
  const times: string[] = [];
  for (let m = toMinutes(SERVICE.from); m <= toMinutes(SERVICE.to) - 30; m += 15)
    times.push(toHHMM(m));
  if (which === "latest") times.reverse();
  for (const time of times) {
    const fit = checkRequest(room, { ...r, time });
    if (!fit.ok) continue;
    if (area && !fit.build.area.split(" + ").includes(area)) continue;
    return { time, tables: fit.build.tables, area: fit.build.area };
  }
  return null;
}

const NEED_TALK = /\b(wheel ?chair|accessible|stroller|pram|aisle|step[- ]free)\b/i;
const REMOVE = /\b(no longer|remove|drop|without|doesn'?t need|don'?t need|not need)\b/i;

export interface LocalAnswer {
  text: string;
  /** An accept ask: the line is rendered from the proposal's status (CANT_ACCEPT_PENDING while one is pending). */
  accept?: boolean;
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
  const refused = floorRefusal(message);
  if (refused) return { text: refused };
  // asked to accept, book or skip the manager: the AI can't, and says so (no model call); a message that also
  // asks for a floor change goes on to the AI, and its reply ends with this line
  const rooms = seatingRoomNames(room);
  const accept = ACCEPT_ASK.test(message);
  if (accept || INJECTION.test(message)) {
    // anything else asked goes on to the AI (with the accept line after its reply when accept was asked)
    if (hasOtherAsk(message, rooms)) return null;
    return { text: accept ? CANT_ACCEPT : CANT_SET_ASIDE_RULES, ...(accept ? { accept } : {}) };
  }
  if (editIntent(message, rooms)) return null;
  const lone = LONE_NUMBER.exec(message);
  if (lone) {
    const n = Number(lone[1]);
    return { text: `${n} people, or ${n}:00 PM?` };
  }
  // "is the Garden Room quiet enough for speeches?": from the tables' own attributes
  const asked = room.areas.find((a) => message.toLowerCase().includes(a.name.toLowerCase()));
  if (asked && QUIET_ASK.test(message)) {
    const ts = room.tables.filter((t) => t.area === asked.name);
    const quiet = ts.filter((t) => t.attrs.quiet).length;
    return {
      text:
        quiet === ts.length
          ? `Quiet: yes — every ${asked.name} table is marked quiet (away from the bar and kitchen doors).`
          : quiet === 0
            ? `Quiet: no — no ${asked.name} table is marked quiet.`
            : `Quiet: partly — ${quiet} of ${ts.length} ${asked.name} tables are marked quiet.`,
    };
  }
  // "what's the latest we could seat them and still use the Library?": a sweep of the capacity check
  const sweep = SWEEP.exec(message);
  if (sweep) {
    const which = /latest|last|late/i.test(sweep[0]) ? "latest" : "earliest";
    const area =
      room.areas.map((a) => a.name).find((n) => message.toLowerCase().includes(n.toLowerCase())) ??
      null;
    const hit = sweepTimes(room, r, which, area);
    const where = area ? ` that keeps the ${area}` : "";
    const word = which === "latest" ? "Latest" : "Earliest";
    if (!hit)
      return {
        text: `No arrival time that night fits ${r.partySize}${area ? ` in the ${area}` : ""}.`,
      };
    return {
      text: `${word} seating${where}: ${clock12(hit.time)} (${tablesPhrase(hit.tables)}, ${hit.area}). Asked for ${clock12(r.time)}.`,
      alt: { tables: hit.tables, label: `${word} · ${clock12(hit.time)}` },
    };
  }
  if (OTHER_ASK.test(message)) return null;
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
 * One turn's reply, from that turn's own answer only (never from the request's latest state). Order: code's
 * answer to a question asked alongside the change (lead), then the AI's question back, verbatim → else "I'd
 * change …" + where that change is now ("— see Proposed changes above" while it waits, "(applied)" etc. after)
 * + the capacity check's sentence (kept only while pending or applied) → else the escalation line; then the
 * accept line, from the same status. null = not answered yet.
 */
export function turnSentence(
  t: {
    status?: "loading" | "ok" | "error";
    changed?: string[];
    outcome?: string;
    local?: boolean;
    clarify?: string;
    lead?: string;
    /** The manager asked the chat to accept: the accept line follows the reply. */
    acceptAsk?: boolean;
    /** Answered on this device (no model call): an accept ask is then the accept line alone. */
    device?: boolean;
  },
  proposal?: ProposalStatus,
): string | null {
  const text = turnText(t, proposal);
  if (text === null) return null;
  const accept = t.acceptAsk ? acceptLine(proposal) : undefined;
  // a device accept answer is the accept line alone
  if (accept && t.device) return accept;
  return [t.lead, text, accept].filter(Boolean).join(" ");
}

function turnText(
  t: {
    status?: "loading" | "ok" | "error";
    changed?: string[];
    outcome?: string;
    local?: boolean;
    clarify?: string;
  },
  proposal: ProposalStatus | undefined,
): string | null {
  if (t.status === "loading") return null;
  if (t.local || t.status === "error") return t.outcome ?? "";
  const live = !proposal || proposal === "pending";
  const change = t.changed?.length
    ? live
      ? `I'd change ${listAnd(t.changed)} — see Proposed changes above.`
      : `I'd change ${listAnd(t.changed)} (${proposal}).`
    : null;
  // after Discard, Revert, Undo or a newer change, the proposed capacity sentence no longer describes the floor
  const outcome = change && !live && proposal !== "applied" ? undefined : t.outcome;
  if (t.clarify) return [t.clarify, change, change ? outcome : null].filter(Boolean).join(" ");
  if (t.outcome === undefined) return null;
  if (change) return outcome ? `${change} ${outcome}` : change;
  return t.outcome;
}
