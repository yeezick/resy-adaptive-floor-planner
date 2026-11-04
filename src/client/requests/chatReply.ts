// The request chat's words, from fixed templates over the capacity check (the model never restates tables or
// numbers). Some messages are answered on this device: "one room?", "bring tables from the back", or a need
// the request already has.
import type { PartyFit, RequestFit, Room } from "../../domain";
import { oneRoomPlan, oneRoomSentence, stockOf, storageSentence } from "../../domain/alternatives";
import type { GuestRequest } from "../../domain/requests";
import { listAnd } from "../../domain/wording";

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
  /\b(single|one|same) (long |big )?(table|room|row|space)\b|\ball (\d+ )?(guests |of them )?together\b|\bone place\b/i;
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
  const current = fit?.ok ? { area: fit.build.area } : null;
  const storage = STORAGE.test(message);
  if (storage || ONE_ROOM.test(message)) {
    const plan = oneRoomPlan(room, r);
    const used = fit?.plan.totals.spareTables ?? 0;
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

/** A model turn in plain words: what it proposes, then the capacity check's own sentence. */
export function turnSentence(t: { changed?: string[]; outcome?: string; local?: boolean }): string {
  if (t.local) return t.outcome ?? "";
  const out = t.outcome ?? "";
  if (t.changed?.length)
    return `I'd change ${listAnd(t.changed)} — see Proposed changes above. ${out}`;
  return out;
}
