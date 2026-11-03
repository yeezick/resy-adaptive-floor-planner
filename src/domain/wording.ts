// Host-facing wording shared by the floor, the request card and the crew list. Table numbers never carry the
// fixture's "T" prefix in anything a person reads ("tables 72, 73 and 74", not "T72 + T73").
import { z } from "zod";
import minutesJson from "../../fixtures/crew/build-minutes.json";
import type { Build } from "./buildplan";

/** "T72" → "72". Ids without the prefix (spare tables, test ids) pass through. */
export function tableNo(id: string): string {
  return /^T\d+$/.test(id) ? id.slice(1) : id;
}

/**
 * Any "T72" left in a sentence (model text, older strings) → "table 72"; "tables T1" → "tables 1". A sentence
 * that starts with one gets a capital ("Table 72 frees…").
 */
export function plainTables(text: string): string {
  return text.replace(
    /\b([Tt]ables?\s+)?T(\d{1,4})\b/g,
    (_m, pre: string | undefined, n: string, at: number, all: string) => {
      if (pre) return `${pre}${n}`;
      const start = at === 0 || /[.!?]\s+$/.test(all.slice(0, at));
      return `${start ? "Table" : "table"} ${n}`;
    },
  );
}

/** "a", "a and b", "a, b and c". */
export function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Table numbers, with runs of three or more collapsed: ["T57","T58","T59","T63"] → "57–59 and 63". */
export function tableNumbers(ids: readonly string[]): string {
  const nums = ids.map(tableNo);
  if (!nums.every((n) => /^\d+$/.test(n))) return listAnd(nums);
  const sorted = nums.map(Number).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j++;
    if (j - i >= 2) out.push(`${sorted[i]}–${sorted[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(sorted[k]));
    i = j + 1;
  }
  return listAnd(out);
}

/** "table 31" or "tables 72, 73 and 74". */
export function tablesPhrase(ids: readonly string[]): string {
  return `${ids.length === 1 ? "table" : "tables"} ${tableNumbers(ids)}`;
}

function article(n: number): string {
  // "an 8-top", "an 11-top", "an 18-top", "an 80-top"; "a 12-top"
  return String(n).startsWith("8") || n === 11 || n === 18 ? "an" : "a";
}

/** Storage for a build as a crew reads it: "2 tables, 1 extender and 6 chairs". Empty when none. */
export function storagePhrase(b: Pick<Build, "spareTables" | "extenders" | "extraChairs">): string {
  const parts = [
    b.spareTables && `${b.spareTables} table${b.spareTables === 1 ? "" : "s"}`,
    b.extenders && `${b.extenders} extender${b.extenders === 1 ? "" : "s"}`,
    b.extraChairs && `${b.extraChairs} chair${b.extraChairs === 1 ? "" : "s"}`,
  ].filter((x): x is string => Boolean(x));
  return listAnd(parts);
}

/**
 * The build as one crew note: "Combine tables 72, 73 and 74 into an 11-top; bring 2 tables and 6 chairs from
 * storage." Several long tables in opened rooms read "Open the divider …; combine … and …".
 */
export function crewNote(b: Build): string {
  const steps: string[] = [];
  for (const d of b.dividersOpened)
    steps.push(`open the divider between ${d.replace(" | ", " and ")}`);
  if (b.rows.length === 1) {
    const row = b.rows[0] ?? [];
    steps.push(
      row.length > 1
        ? `combine ${tablesPhrase(row)} into ${article(b.seats)} ${b.seats}-top`
        : `set ${tablesPhrase(row)} as ${article(b.seats)} ${b.seats}-top`,
    );
  } else {
    steps.push(
      `combine ${listAnd(b.rows.map((r) => tablesPhrase(r)))} into ${b.rows.length} long tables seating ${b.seats}`,
    );
  }
  const storage = storagePhrase(b);
  if (storage) steps.push(`bring ${storage} from storage`);
  const text = steps.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export const BuildMinutes = z
  .object({
    note: z.string(),
    perTable: z.number().nonnegative(),
    extender: z.number().nonnegative(),
    spareTable: z.number().nonnegative(),
    chairsPerMinute: z.number().positive(),
    openDivider: z.number().nonnegative(),
    minimum: z.number().nonnegative(),
  })
  .strict();
export type BuildMinutes = z.infer<typeof BuildMinutes>;
export const BUILD_MINUTES: BuildMinutes = BuildMinutes.parse(minutesJson);

/**
 * Crew minutes for one build (estimate), from the per-step constants in fixtures/crew/build-minutes.json:
 * each floor table, extender, spare table and divider, plus chairs carried at a fixed rate; never below the
 * minimum. The crew list's time windows and the card's "Build time ~X min (est.)" both use it.
 */
export function buildMinutes(
  b: Pick<Build, "tables" | "dividersOpened" | "spareTables" | "extenders" | "extraChairs">,
  m: BuildMinutes = BUILD_MINUTES,
): number {
  return Math.max(
    m.minimum,
    m.perTable * b.tables.length +
      m.extender * b.extenders +
      m.spareTable * b.spareTables +
      Math.ceil(b.extraChairs / m.chairsPerMinute) +
      m.openDivider * b.dividersOpened.length,
  );
}

export interface CoverTrade {
  /** Covers the party brings. */
  gain: number;
  /** Covers the hold costs (estimate: seats × minutes held ÷ one turn). */
  lost: number;
  net: number;
}

/** Saying yes vs no, in covers: the party's seats minus the covers its hold costs. Decline is always 0. */
export function coverTrade(partySize: number, coversLost: number): CoverTrade {
  return { gain: partySize, lost: coversLost, net: partySize - coversLost };
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

/** "Accept: +22 covers (the party) · −13 covers lost to the hold (est.) = net +9". */
export function acceptLine(t: CoverTrade): string {
  return `Accept: +${t.gain} covers (the party) · −${t.lost} covers lost to the hold (est.) = net ${signed(t.net)}`;
}

export const DECLINE_LINE = "Decline: 0 · request leaves Resy";

/** Minutes from `now` to `at` as "in 2h 10m", "in 45m", "now" or "15m ago". */
export function countdown(minutes: number): string {
  const m = Math.round(minutes);
  if (m === 0) return "now";
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const rest = a % 60;
  const text = h ? (rest ? `${h}h ${rest}m` : `${h}h`) : `${rest}m`;
  return m > 0 ? `in ${text}` : `${text} ago`;
}
