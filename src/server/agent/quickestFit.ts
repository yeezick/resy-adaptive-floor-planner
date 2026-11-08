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
import type { Recommendation } from "../../shared/api";
import type { ToolTraceEntry } from "./loop";

/** The prompt's maximum number of options. With this many already, the quickest fit replaces the last one. */
export const MAX_OPTIONS = 3;

const NEED_WORDS: [RegExp, Need][] = [
  [/wheel ?chair|accessible|mobility/i, "accessible"],
  [/stroller|pram|buggy/i, "stroller"],
  [/\bquiet\b/i, "quiet"],
  [/\bview\b|window/i, "view"],
  [/\bbooth\b/i, "booth"],
];

/** Needs named in the host's message (same words as the client's review screen). */
export function needsIn(message: string): Need[] {
  return NEED_WORDS.filter(([re]) => re.test(message)).map(([, n]) => n);
}

const numbersIn = (message: string) => new Set(message.match(/\d{1,3}/g) ?? []);

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

/** The last ok find_tables_for_party output for this party size this turn, if the model called it. */
function modelSearch(tools: readonly ToolTraceEntry[], partySize: number) {
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t?.name !== "find_tables_for_party" || !t.ok) continue;
    const out = t.output as { partySize?: number; options?: SeatingOption[] };
    if (out.partySize === partySize && Array.isArray(out.options)) return out.options;
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
  /** A trace entry for the search this code ran (when the model didn't search this turn). */
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
): QuickestFitResult {
  const same = { recommendations: [...recs] };
  if (partySize === undefined || !recs.length) return same;
  if (!askedTables(message, tools).length) return same;

  let options = modelSearch(tools, partySize);
  let serverSearch: ToolTraceEntry | undefined;
  if (!options) {
    const input = { partySize, needs: needsIn(message) };
    const output = findTablesForParty(room, input);
    options = output.options;
    serverSearch = {
      turn: 0,
      id: "server-quickest-fit",
      name: "find_tables_for_party",
      input,
      ok: true,
      output,
    };
  }
  const fit = quickest(options);
  if (!fit) return same;
  const nums = numbersIn(message);
  if (fit.tables.some((id) => nums.has(tableNo(id)))) return { ...same, serverSearch };
  if (recs.some((r) => sameSet(r.tables, fit.tables))) return { ...same, serverSearch };
  if (recs.some((r) => r.waitMin <= fit.waitMin)) return { ...same, serverSearch };

  // Full: replace the last card that isn't an asked set; if every card is an asked set, leave them all.
  let kept: Recommendation[] = [...recs];
  let where = `added as #${kept.length + 1}`;
  if (recs.length >= MAX_OPTIONS) {
    const asked = askedTables(message, tools);
    const top = recs.slice(0, MAX_OPTIONS);
    let drop = -1;
    for (let i = top.length - 1; i >= 0; i--) {
      if (!sameSet(top[i]?.tables ?? [], asked)) {
        drop = i;
        break;
      }
    }
    if (drop < 0) return { ...same, serverSearch };
    kept = top.filter((_, i) => i !== drop).map((r, i) => ({ ...r, rank: i + 1 }));
    where = `replaced #${drop + 1}`;
  }
  const recommendations = [...kept, toRecommendation(fit, kept.length + 1)];
  return {
    recommendations,
    serverSearch,
    note: `Quickest fit ${fit.tables.join(" + ")} (~${fit.waitMin} min, find_tables_for_party) ${where}.`,
  };
}
