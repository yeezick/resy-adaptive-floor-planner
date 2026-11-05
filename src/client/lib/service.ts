// Client-side service actions (seat, finish) and display helpers. Pure: every function returns new data.
import {
  applyCombine,
  applySplit,
  checkTableSet,
  comboOf,
  estimateFreeTime,
  PHASES,
  tableById,
  type Need,
  type Phase,
  type Room,
  type SeatingOption,
  type Table,
} from "../../domain";

export const PHASE_LABEL: Record<Phase, string> = {
  seated: "Seated",
  drinks: "Drinks",
  appetizers: "Apps",
  entrees: "Entrées",
  dessert: "Dessert",
  check: "Check",
};

/** Short phase words drawn on seated tables. */
export const PHASE_ABBR: Record<Phase, string> = {
  seated: "SEAT",
  drinks: "DRK",
  appetizers: "APP",
  entrees: "ENT",
  dessert: "DES",
  check: "CHK",
};

export const NEEDS: Need[] = ["accessible", "stroller", "quiet", "view", "booth"];

export interface SeatedParty {
  key: string;
  ids: string[];
  partySize: number;
  phase: Phase;
  area: string;
}

/** Occupied tables grouped into parties; a combo is one party. Closest to leaving first. */
export function seatedParties(room: Room): SeatedParty[] {
  const parties = new Map<string, SeatedParty>();
  for (const t of room.tables) {
    if (t.status !== "occupied") continue;
    const ids = comboOf(room, t.id) ?? [t.id];
    const key = ids.join("+");
    const phase = t.phase ?? "seated";
    const prev = parties.get(key);
    parties.set(key, {
      key,
      ids,
      partySize: Math.max(prev?.partySize ?? 0, t.partySize ?? t.seats),
      phase: prev && PHASES.indexOf(prev.phase) < PHASES.indexOf(phase) ? prev.phase : phase,
      area: t.area,
    });
  }
  return [...parties.values()].sort(
    (a, b) => PHASES.indexOf(b.phase) - PHASES.indexOf(a.phase) || a.key.localeCompare(b.key),
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Seat a party: combine multi-table picks (one long table per row), mark tables occupied. */
export function seatParty(room: Room, ids: readonly string[], partySize: number): Room {
  if (!ids.length) throw new Error("pick at least one table");
  for (const id of ids) {
    const t = tableById(room, id);
    if (!t) throw new Error(`table ${id} does not exist`);
    if (t.status === "occupied") throw new Error(`${id} is already seated`);
    if (t.status === "blocked") throw new Error(`${id} is blocked`);
  }
  let next = room;
  if (ids.length > 1) {
    const check = checkTableSet(room, ids);
    if (!check.ok) throw new Error(check.reason);
    for (const row of check.rows) {
      if (row.length < 2) continue;
      const existing = comboOf(next, row[0] as string);
      if (existing && sameSet(existing, row)) continue;
      next = applyCombine(next, row);
    }
  }
  return {
    ...next,
    tables: next.tables.map((t) =>
      ids.includes(t.id)
        ? { ...t, status: "occupied", phase: "seated", partySize, reservedAt: undefined }
        : t,
    ),
  };
}

/** Party leaves: split its combo and reset its tables to open. */
export function finishParty(room: Room, ids: readonly string[]): Room {
  let next = room;
  for (const id of ids) if (comboOf(next, id)) next = applySplit(next, id);
  return {
    ...next,
    tables: next.tables.map((t) =>
      ids.includes(t.id) ? { ...t, status: "open", phase: undefined, partySize: undefined } : t,
    ),
  };
}

/**
 * Undo one action against the room as it is now: only the combos that action made are split and only `ids`
 * get their service state (status, phase, party) back from `before`. Anything else the host did since stays.
 */
export function revertAction(now: Room, before: Room, after: Room, ids: readonly string[]): Room {
  const key = (c: readonly string[]) => [...c].sort().join(",");
  const had = new Set(before.combos.map(key));
  const made = new Set(after.combos.map(key).filter((k) => !had.has(k)));
  return {
    ...now,
    combos: now.combos.filter((c) => !made.has(key(c))),
    tables: now.tables.map((t) => {
      const was = ids.includes(t.id) ? tableById(before, t.id) : undefined;
      return was
        ? {
            ...t,
            status: was.status,
            phase: was.phase,
            partySize: was.partySize,
            reservedAt: was.reservedAt,
          }
        : t;
    }),
  };
}

/** Synthetic "typical" quote by party size — a stand-in for a venue's historical ladder. */
export function typicalWait(partySize: number): number {
  if (partySize <= 2) return 15;
  if (partySize <= 4) return 25;
  if (partySize <= 6) return 35;
  if (partySize <= 8) return 50;
  if (partySize <= 12) return 65;
  return 80;
}

/** "now" or "~20 min — 3 tables on Dessert" (the phase holding the option up). */
export function etaText(room: Room, opt: SeatingOption): string {
  if (opt.waitMin === 0) return "now";
  const tables = opt.tables.map((id) => tableById(room, id)).filter((t): t is Table => !!t);
  const slowest = tables.reduce<Table | undefined>(
    (worst, t) =>
      (estimateFreeTime(t).minutes ?? 0) > (worst ? (estimateFreeTime(worst).minutes ?? 0) : -1)
        ? t
        : worst,
    undefined,
  );
  if (!slowest || slowest.status !== "occupied") return `~${opt.waitMin} min`;
  const phase = slowest.phase ?? "seated";
  const n = tables.filter((t) => t.status === "occupied" && (t.phase ?? "seated") === phase).length;
  return `~${opt.waitMin} min (est.) — ${n} table${n === 1 ? "" : "s"} on ${PHASE_LABEL[phase].toLowerCase()}`;
}

/** Party size mentioned in a host's message ("party of 8", "8-top", "for 6"), if any. */
export function partyFromMessage(text: string): number | undefined {
  const m =
    /party of (\d{1,2})/i.exec(text) ??
    /(\d{1,2})[\s-]?(?:top|people|guests|pax|covers)\b/i.exec(text) ??
    // "for 8:30" and "for 15 minutes" are a time or a duration, not a headcount.
    /\bfor (\d{1,2})\b(?!\s*(?::\d|min(?:ute)?s?\b|hrs?\b|hours?\b|[ap]\.?m\b))/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface WaitEntry {
  id: string;
  partySize: number;
  needs: Need[];
  quoteMin: number;
  addedAt: string;
  /** The tables the party waits for (from an AI Planner option), when one was picked. */
  tables?: string[];
  name?: string;
  /** The host's note from the review screen (allergies, celebrations). */
  note?: string;
}

export interface DoneEntry {
  id: string;
  partySize: number;
  tables: string[];
  finishedAt: string;
}

/** The host sets a seated table's meal phase by hand (parity with the simulated POS feed). */
export function setPhase(room: Room, ids: readonly string[], phase: Phase): Room {
  return {
    ...room,
    tables: room.tables.map((t) =>
      ids.includes(t.id) && t.status === "occupied" ? { ...t, phase } : t,
    ),
  };
}
