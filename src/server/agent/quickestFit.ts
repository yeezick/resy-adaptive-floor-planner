// When the host asks about specific tables, the options still carry the quickest capacity fit the planner knows
// for that party (T44: "seat them at 39 and 40 …" left only the ~80 min build, while table 41 was free in ~11).
// Deterministic: the fit comes from find_tables_for_party output — the model's own call this turn, or one this
// code makes when the model didn't search — and the card uses the tool's numbers and words only.
import {
  findTablesForParty,
  tableNo,
  type Need,
  type Room,
  type SeatingOption,
} from "../../domain";
import { needsInText } from "../../domain/wording";
import { Recommendation } from "../../shared/api";
import type { ToolTraceEntry } from "./loop";

/** The prompt's maximum number of options. With this many already, the quickest fit replaces the last one. */
export const MAX_OPTIONS = 3;

/** Trace id of the search this code runs when the model didn't (kept out of the response's toolCalls). */
export const SERVER_SEARCH_ID = "server-quickest-fit";

/** Needs named in the host's message (the same words as the client's review screen). */
export const needsIn = needsInText;

/**
 * A need word the host ruled out: "no booth please", "away from the window", "not by the window". Read as a need,
 * it would make this code add the very card the host didn't want, so keepQuickestFit leaves the options alone.
 */
export function negatesNeed(message: string): boolean {
  const neg = /\b(?:no|not|without|avoid|away\s+from|don'?t|do\s+not)\b((?:\W+[\w'-]+){1,3})/gi;
  for (const x of message.matchAll(neg)) if (needsInText(x[1] ?? "").length) return true;
  return false;
}

/**
 * Any exclusion besides "not <table>": "not section 5", "not the patio", "away from the bar", "except …". The code
 * can't read those, and the model may have honoured one on purpose, so the options are left as they are.
 */
export function excludesSomething(message: string): boolean {
  const rest = message.replace(/\bnot\s+(?:at\s+|on\s+)?(?:tables?\s*|t)?#?\s*\d{1,3}\b/gi, " ");
  return /\b(?:no|not|without|except|avoid|away\s+from|don'?t|do\s+not|instead\s+of|other\s+than)\b/i.test(
    rest,
  );
}

const numbersIn = (message: string) => new Set(message.match(/\b\d{1,3}\b/g) ?? []);

/**
 * Table numbers the host wrote as tables — "table 41", "tables 39 and 40", "T41", "not 41", "39 + 40" — never a
 * party size, a chair count or a time ("party of 8", "2 chairs", "in 10 min").
 */
export function tableNumbersIn(message: string): Set<string> {
  const out = new Set<string>();
  const m = message.toLowerCase();
  const lists =
    /\b(?:tables?|(?<!['’])t(?=\s*#?\s*\d)|not(?:\s+(?:at|on))?)\s*#?\s*(\d{1,3}(?:\s*(?:[–+,&-]|and|or)\s*\d{1,3})*)\b/g;
  for (const x of m.matchAll(lists))
    for (const n of (x[1] ?? "").split(/\s*(?:[–+,&-]|and|or)\s*/)) if (n) out.add(n);
  // "39 + 40" / "39 and 40 pushed together": a joined pair names tables even without the word
  for (const x of m.matchAll(/\b(\d{1,3})\s*(?:\+|&)\s*(\d{1,3})\b/g)) {
    out.add(x[1] as string);
    out.add(x[2] as string);
  }
  return out;
}

/**
 * Tables the host named that the model also looked up by name this turn (propose_combine / estimate_free_time
 * input). "39 and 40 … 2 chairs" → T39, T40 (T2 was never looked up, so "2" is not a table). Cards alone don't
 * count: "not in section 7" with a T7–T10 card names no table.
 */
export function askedTables(message: string, tools: readonly ToolTraceEntry[]): string[] {
  const nums = numbersIn(message);
  const looked = new Set<string>();
  for (const t of tools) {
    if (!t.ok || (t.name !== "propose_combine" && t.name !== "estimate_free_time")) continue;
    const ids = (t.input as { tableIds?: unknown }).tableIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") looked.add(id);
  }
  return [...looked].filter((id) => nums.has(tableNo(id))).sort();
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** A card on the host's asked tables: every table on it is one the host named ("39 or 40" → [T39] and [T40]). */
const onAsked = (tables: readonly string[], asked: readonly string[]) =>
  tables.length > 0 && tables.every((t) => asked.includes(t));

/** A find_tables_for_party option as this code reads it (tool output is checked, not cast). */
function isOption(o: unknown): o is SeatingOption {
  const x = o as Partial<SeatingOption> | null;
  return (
    !!x &&
    Array.isArray(x.tables) &&
    x.tables.every((t) => typeof t === "string") &&
    typeof x.seats === "number" &&
    typeof x.waitMin === "number" &&
    Array.isArray(x.reasons) &&
    Array.isArray(x.tradeoffs)
  );
}

/**
 * The last ok find_tables_for_party output this turn for this party size that covers every need in the message
 * (a search with needs [] doesn't answer "one uses a wheelchair").
 */
function modelSearch(tools: readonly ToolTraceEntry[], partySize: number, needs: readonly Need[]) {
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t?.name !== "find_tables_for_party" || !t.ok) continue;
    const out = t.output as { partySize?: unknown; needs?: unknown; options?: unknown } | undefined;
    if (out?.partySize !== partySize || !Array.isArray(out.options)) continue;
    const searched = Array.isArray(out.needs) ? (out.needs as unknown[]) : [];
    if (!needs.every((n) => searched.includes(n))) continue;
    return out.options.filter(isOption);
  }
  return undefined;
}

/** The quickest option in a find_tables_for_party output (shortest wait; the tool's own order breaks ties). */
export function quickest(options: readonly SeatingOption[]): SeatingOption | undefined {
  let best: SeatingOption | undefined;
  for (const o of options) if (!best || o.waitMin < best.waitMin) best = o;
  return best;
}

export function toRecommendation(o: SeatingOption, rank: number): Recommendation {
  return {
    rank,
    tables: [...o.tables],
    seats: o.seats,
    waitMin: o.waitMin,
    reasoning: `Quickest fit for this party: ${o.reasons.join("; ")}.`,
    tradeoffs: [...o.tradeoffs],
  };
}

export interface QuickestFitResult {
  recommendations: Recommendation[];
  /**
   * The search this code ran (the model didn't search this turn), returned only with a card it adds: the trace
   * then reports a find_tables_for_party call only when its output is on screen.
   */
  serverSearch?: ToolTraceEntry;
  /** What changed, for the validator notes / logs. */
  note?: string;
}

/**
 * Keep (or add) the quickest capacity fit next to the asked tables. Only when the host named tables, the party
 * size is known and the model returned at least one option. Never re-adds a table set the host named (asked for
 * or ruled out), and never duplicates a card already shown. With MAX_OPTIONS cards, the fit replaces the last
 * card that isn't an asked set (none, if every card is one).
 */
export function keepQuickestFit(
  room: Room,
  message: string,
  recs: readonly Recommendation[],
  tools: readonly ToolTraceEntry[],
  partySize: number | undefined,
  /** The host's earlier messages this conversation: their needs and exclusions still hold. */
  earlier: readonly string[] = [],
): QuickestFitResult {
  const same = { recommendations: [...recs] };
  if (partySize === undefined || !recs.length) return same;
  if (!askedTables(message, tools).length) return same;
  // needs and exclusions from the whole conversation ("one uses a wheelchair" … then "can you do 39 and 40?")
  const host = [...earlier, message].join("\n");
  // "no booth please" / "away from the window" / "not section 4": not ours to override
  if (negatesNeed(host) || excludesSomething(host)) return same;

  const needs = needsIn(host);
  let options = modelSearch(tools, partySize, needs);
  let serverSearch: ToolTraceEntry | undefined;
  if (!options) {
    const input = { partySize, needs };
    const output = findTablesForParty(room, input);
    options = output.options;
    serverSearch = {
      turn: 0,
      id: SERVER_SEARCH_ID,
      name: "find_tables_for_party",
      input,
      ok: true,
      output,
    };
  }
  const fit = quickest(options);
  if (!fit) return same;
  // the host named the quick table (asked for it or ruled it out): theirs to weigh, not ours to add
  // over the whole conversation: "not table 41" said a turn ago still rules 41 out
  const named = tableNumbersIn(host);
  if (fit.tables.some((id) => named.has(tableNo(id)))) return same;
  if (recs.some((r) => sameSet(r.tables, fit.tables))) return same;
  if (recs.some((r) => r.waitMin <= fit.waitMin)) return same;

  // Full: replace the last card that isn't an asked set; if every card is an asked set, leave them all.
  let kept: Recommendation[] = [...recs];
  let where = `added as #${kept.length + 1}`;
  if (recs.length >= MAX_OPTIONS) {
    const asked = askedTables(message, tools);
    const top = recs.slice(0, MAX_OPTIONS);
    let drop = -1;
    for (let i = top.length - 1; i >= 0; i--) {
      if (!onAsked(top[i]?.tables ?? [], asked)) {
        drop = i;
        break;
      }
    }
    if (drop < 0) return same;
    kept = top.filter((_, i) => i !== drop).map((r, i) => ({ ...r, rank: i + 1 }));
    where = `replaced #${drop + 1}`;
  }
  // the built card meets the same schema as a model card, or nothing is added
  const added = Recommendation.safeParse(toRecommendation(fit, kept.length + 1));
  if (!added.success) return same;
  const recommendations = [...kept, added.data];
  return {
    recommendations,
    serverSearch,
    note: `Quickest fit ${fit.tables.join(" + ")} (~${fit.waitMin} min, find_tables_for_party) ${where}.`,
  };
}
