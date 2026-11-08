// AI Planner options as a host acts on them: a short reason tag per card, the one action it leads to, and the
// client-side reading of "option 1" / "the fastest one" / "table 41" in the chat. All derived by rule from the
// Capacity check facts on the card (tables, seats, wait); the model's words are never parsed for numbers here.
import { checkTableSet, sectionLoad, tableById, type Room, type Table } from "../../domain";
import { tablesPhrase, tableNo } from "../../domain/wording";
import type { Recommendation } from "../../shared/api";

type Rec = Pick<Recommendation, "rank" | "tables" | "seats" | "waitMin">;

/** True when the option needs tables pushed together (more than one table in a row). */
export function needsBuild(room: Room, rec: Pick<Rec, "tables">): boolean {
  if (rec.tables.length < 2) return false;
  const check = checkTableSet(room, rec.tables);
  return check.ok ? check.rows.some((r) => r.length > 1) : true;
}

/**
 * True when this card is "Fastest": it has the shortest wait of the cards shown, there is something to compare it
 * with (2+ cards, at least one slower), and it is the first card with that wait. A lone card is never "Fastest"
 * (T44: the only card, a ~80 min build, read "Fastest" while table 41 was free in ~11). The server keeps the
 * quickest known fit on screen when the host asks about named tables, so a faster fit is never hidden.
 */
export function isFastest(rec: Pick<Rec, "rank" | "waitMin">, all: readonly Rec[]): boolean {
  if (all.length < 2) return false;
  const fastest = Math.min(...all.map((r) => r.waitMin));
  if (!all.some((r) => r.waitMin > fastest)) return false;
  return all.find((r) => r.waitMin === fastest)?.rank === rec.rank;
}

/**
 * A 1–3 word reason for a card, by rule: the shortest wait (with a slower card to compare) → "Fastest"; no
 * combine → "No build"; else the section's trait ("Quiet section" when no table there was just sat; else the
 * tables' own attribute).
 */
export function reasonTag(room: Room, rec: Rec, all: readonly Rec[]): string {
  if (isFastest(rec, all)) return "Fastest";
  if (!needsBuild(room, rec)) return "No build";
  const tables = rec.tables.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  const sections = [...new Set(tables.map((t) => t.section))];
  if (sections.length && sections.every((s) => sectionLoad(room, s) === 0)) return "Quiet section";
  const every = (k: keyof Table["attrs"]) => tables.length > 0 && tables.every((t) => t.attrs[k]);
  if (every("view")) return "View";
  if (every("booth")) return "Booth";
  if (every("accessible")) return "Accessible";
  return sections.length === 1 ? `Section ${sections[0]}` : "Spans sections";
}

/** Seat when every table is free now, else waitlist with the option's quote. */
export function actionOf(rec: Pick<Rec, "waitMin">): "seat" | "waitlist" {
  return rec.waitMin === 0 ? "seat" : "waitlist";
}

/** "Seat at table 41" or "Waitlist · ~11 min" (the card's one action button). */
export function actionLabel(rec: Pick<Rec, "tables" | "waitMin">): string {
  return actionOf(rec) === "seat"
    ? `Seat at ${tablesPhrase(rec.tables)}`
    : `Waitlist · ~${rec.waitMin} min`;
}

/** The chat's action reply: "Waitlist party of 8 · table 41 · ~11 min". */
export function actionSentence(rec: Pick<Rec, "tables" | "waitMin">, size: number): string {
  return actionOf(rec) === "seat"
    ? `Seat party of ${size} · ${tablesPhrase(rec.tables)} · free now`
    : `Waitlist party of ${size} · ${tablesPhrase(rec.tables)} · ~${rec.waitMin} min`;
}

export type Resolved =
  { kind: "none" } | { kind: "one"; rank: number; why: string } | { kind: "many"; ranks: number[] };

const ORDINAL: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
};

/**
 * Read a host message against the options on screen. Only messages that point at an option are resolved here;
 * anything else (a question, a combine the host wants) goes to the AI Planner as before.
 */
export function resolveOption(message: string, recs: readonly Rec[], chosen?: number): Resolved {
  if (!recs.length) return { kind: "none" };
  const m = message.toLowerCase().trim();
  // only short instructions are read here; a question or a longer message goes to the AI Planner
  if (m.endsWith("?") || m.split(/\s+/).length > 8) return { kind: "none" };
  if (/\b(not|no|don'?t|too|instead|why|how|what|should|could|combine|move|rotate)\b/.test(m))
    return { kind: "none" };
  const byRank = (n: number): Resolved =>
    recs.some((r) => r.rank === n)
      ? { kind: "one", rank: n, why: `#${n}` }
      : { kind: "many", ranks: recs.map((r) => r.rank) };

  const num = /\b(?:option|number|no\.?)\s*#?\s*(\d)\b|(?:^|\s)#\s*(\d)\b/.exec(m);
  if (num) return byRank(Number(num[1] ?? num[2]));
  const ord = /\b(first|second|third|1st|2nd|3rd)\b(?:\s+(?:one|option|choice))?/.exec(m);
  if (ord && /\b(one|option|choice|go|take|do|book|seat|waitlist|with|that)\b/.test(m))
    return byRank(ORDINAL[ord[1] as string] as number);
  if (/\b(fastest|quickest|soonest)\b/.test(m)) {
    const fastest = Math.min(...recs.map((r) => r.waitMin));
    const r = recs.find((x) => x.waitMin === fastest);
    return r ? { kind: "one", rank: r.rank, why: "fastest" } : { kind: "none" };
  }
  // table numbers: every number named must be on one card
  const named = [
    ...m.matchAll(/\b(?:tables?|t)\s*(\d{1,3}(?:\s*(?:[–+,-]|and)\s*\d{1,3})*)/g),
  ].flatMap((x) => (x[1] ?? "").split(/\s*(?:[–+,-]|and)\s*/));
  if (named.length) {
    const hits = recs.filter((r) => named.every((n) => r.tables.some((id) => tableNo(id) === n)));
    if (hits.length === 1) return { kind: "one", rank: (hits[0] as Rec).rank, why: "table" };
    if (hits.length > 1) return { kind: "many", ranks: hits.map((r) => r.rank) };
    return { kind: "none" };
  }
  if (/\b(wait ?list|waitlist|put them on|go ahead|do it|that one|book it|seat them)\b/.test(m)) {
    if (chosen !== undefined && recs.some((r) => r.rank === chosen))
      return { kind: "one", rank: chosen, why: "chosen" };
    const waiting = /wait ?list/.test(m) ? recs.filter((r) => r.waitMin > 0) : recs;
    if (waiting.length === 1) return { kind: "one", rank: (waiting[0] as Rec).rank, why: "only" };
    return { kind: "many", ranks: (waiting.length ? waiting : recs).map((r) => r.rank) };
  }
  return { kind: "none" };
}

const NEED_WORDS: [RegExp, "accessible" | "stroller" | "quiet" | "view" | "booth"][] = [
  [/wheel ?chair|accessible|mobility/i, "accessible"],
  [/stroller|pram|buggy/i, "stroller"],
  [/\bquiet\b/i, "quiet"],
  [/\bview\b|window/i, "view"],
  [/\bbooth\b/i, "booth"],
];

/** Needs the host named in the message ("one uses a wheelchair" → accessible), pre-filled on the review screen. */
export function needsFromMessage(
  text: string,
): ("accessible" | "stroller" | "quiet" | "view" | "booth")[] {
  return NEED_WORDS.filter(([re]) => re.test(text)).map(([, n]) => n);
}

/** Display-only copy fixes on AI Planner text ("make any combine" → "make any combination"). */
export function fixCopy(text: string): string {
  return text.replace(/\bany combine\b/g, "any combination");
}
