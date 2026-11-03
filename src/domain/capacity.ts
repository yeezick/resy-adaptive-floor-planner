import { checkCombine, combinedSeats } from "./combine";
import { estimateFreeTime, RESET_MIN, REMAINING_MIN, sectionLoad } from "./phases";
import { neighbours, tableById } from "./room";
import { toHHMM, toMinutes } from "./time";
import type { Need, Room, Table } from "./types";
import { tablesPhrase } from "./wording";

/** Expected minutes a newly seated party holds the table, including reset. */
export const TURN_MIN = REMAINING_MIN.seated + RESET_MIN;
/** Prefer options that waste at most this many seats; relaxed only when nothing else fits. */
export const WASTE_CAP = 4;
export const MAX_OPTION_TABLES = 4;
/** Hard cap on groups considered, so a pathological room cannot stall the server. */
export const MAX_GROUPS = 5000;

export interface PartyRequest {
  partySize: number;
  needs?: Need[];
  maxOptions?: number;
}

export interface SeatingOption {
  tables: string[];
  /** Seats including any extra chairs from storage. */
  seats: number;
  extraChairs: number;
  waitMin: number;
  freeAt: string;
  waste: number;
  area: string;
  sections: number[];
  sectionLoad: number;
  needsMet: Need[];
  score: number;
  reasons: string[];
  tradeoffs: string[];
}

export interface FitResult {
  partySize: number;
  needs: Need[];
  clock: string;
  options: SeatingOption[];
  excluded: { tables: string[]; reason: string }[];
  note?: string;
}

export function meetsNeeds(tables: readonly Table[], needs: readonly Need[]): boolean {
  return needs.every((need) => {
    switch (need) {
      case "accessible":
        return tables.every((t) => t.attrs.accessible);
      case "stroller":
        return tables.some((t) => t.attrs.strollerSpace);
      case "quiet":
        return tables.every((t) => t.attrs.quiet);
      case "view":
        return tables.some((t) => t.attrs.view);
      case "booth":
        return tables.length === 1 && tables[0]?.shape === "booth";
    }
  });
}

/** All single tables plus connected joinable groups of 2..maxTables in one area. */
export function candidateGroups(room: Room, maxTables = MAX_OPTION_TABLES): string[][] {
  const out = new Map<string, string[]>();
  for (const t of room.tables) {
    if (t.status === "blocked") continue;
    out.set(t.id, [t.id]);
  }
  let frontier = room.tables.filter((t) => t.joinable && t.status !== "blocked").map((t) => [t.id]);
  for (let size = 2; size <= maxTables; size++) {
    const next: string[][] = [];
    for (const group of frontier) {
      for (const member of group) {
        for (const n of neighbours(room, member)) {
          if (group.includes(n)) continue;
          const cand = [...group, n].sort(sortIds);
          const key = cand.join("+");
          if (out.has(key)) continue;
          if (!checkCombine(room, cand).ok) continue;
          out.set(key, cand);
          next.push(cand);
          if (out.size >= MAX_GROUPS) return [...out.values()];
        }
      }
    }
    frontier = next;
  }
  return [...out.values()];
}

function sortIds(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}

export function findTablesForParty(room: Room, req: PartyRequest): FitResult {
  const needs = req.needs ?? [];
  const maxOptions = req.maxOptions ?? 3;
  const now = toMinutes(room.clock);
  const excluded: FitResult["excluded"] = [];
  const all: SeatingOption[] = [];

  for (const ids of candidateGroups(room)) {
    const tables = ids.map((id) => tableById(room, id) as Table);
    if (tables.length === 1 && req.partySize < (tables[0]?.minSeats ?? 1)) continue;
    const base = combinedSeats(tables);
    const chairRoom = Math.min(
      room.inventory.spareChairs,
      tables.reduce((n, t) => n + t.maxExtraChairs, 0),
    );
    const extraChairs = Math.max(0, req.partySize - base);
    if (extraChairs > chairRoom) continue;
    const seats = base + extraChairs;
    if (!meetsNeeds(tables, needs)) continue;

    const waits = tables.map((t) => estimateFreeTime(t).minutes);
    if (waits.some((w) => w === null)) continue;
    const waitMin = Math.max(...(waits as number[]));

    const held = tables.find(
      (t) =>
        t.status === "reserved" &&
        t.reservedAt &&
        toMinutes(t.reservedAt) - now < waitMin + TURN_MIN,
    );
    if (held) {
      if (ids.length === 1)
        excluded.push({ tables: ids, reason: `held for a ${held.reservedAt} reservation` });
      continue;
    }

    const sections = [...new Set(tables.map((t) => t.section))].sort((a, b) => a - b);
    const load = Math.max(...sections.map((s) => sectionLoad(room, s)));
    const waste = seats - req.partySize;
    const reasons = [
      `${seats} seats for ${req.partySize}`,
      waitMin === 0
        ? "free now"
        : `free in ~${waitMin} min (${tables.map((t) => estimateFreeTime(t).basis).join("; ")})`,
      `section ${sections.join("/")} has ${load} table(s) sat in the last few minutes`,
    ];
    if (needs.length) reasons.push(`meets: ${needs.join(", ")}`);
    const tradeoffs: string[] = [];
    if (ids.length > 1) tradeoffs.push(`needs a build: combine ${tablesPhrase(ids)}`);
    if (extraChairs) tradeoffs.push(`tight: add ${extraChairs} chair(s) from storage`);
    if (load >= 2) tradeoffs.push(`section ${sections.join("/")} is already slammed`);
    if (waste > WASTE_CAP) tradeoffs.push(`${waste} empty seats`);

    all.push({
      tables: ids,
      seats,
      extraChairs,
      waitMin,
      freeAt: toHHMM(now + waitMin),
      waste,
      area: tables[0]?.area ?? "",
      sections,
      sectionLoad: load,
      needsMet: [...needs],
      score: waitMin + 6 * load + 2 * Math.min(waste, 20) + 3 * (ids.length - 1) + 4 * extraChairs,
      reasons,
      tradeoffs,
    });
  }

  const tight = all.filter((o) => o.waste <= WASTE_CAP);
  const pool = tight.length ? tight : all;
  pool.sort((a, b) => a.score - b.score || a.tables.join().localeCompare(b.tables.join()));
  const result: FitResult = {
    partySize: req.partySize,
    needs: [...needs],
    clock: room.clock,
    options: pool.slice(0, maxOptions),
    excluded,
  };
  if (!all.length)
    result.note = "no table or legal combination fits this party and its needs today";
  else if (!tight.length) result.note = `every option wastes more than ${WASTE_CAP} seats`;
  return result;
}
