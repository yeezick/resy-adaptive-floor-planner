// "Generate tonight's layout": tonight's book + base layout + storage → a one-day layout variant,
// the changes from the base, an ordered crew build list and a reason for every choice. Read-only:
// it returns a proposal; a person edits it and applies it.
import { buildMinutes, tableNo, tablesPhrase } from "./wording";

export { buildMinutes };
import { planBuilds, type Build } from "./buildplan";
import { TURN_MIN } from "./capacity";
import { holdConflicts, partyFits, type HoldConflict, type PartyFit } from "./fit";
import { tableById } from "./room";
import { toHHMM, toMinutes } from "./time";
import type { Room, Table } from "./types";

export type ChangeKind =
  "open-divider" | "move" | "join" | "pull-table" | "pull-extenders" | "pull-chairs";

export interface LayoutChange {
  kind: ChangeKind;
  reservationId: string;
  tables: string[];
  /** For moves: where the table was and where it goes (grid units). */
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  count?: number;
  text: string;
}

export interface CrewStep {
  start: string;
  end: string;
  reservationId: string;
  partySize: number;
  /** "set" = before the night (part of the variant); "rebuild" = mid-shift, after an earlier party leaves. */
  when: "set" | "rebuild";
  /** True when the clock leaves less than the estimated build time. */
  tight: boolean;
  actions: string[];
}

export interface TonightProposal {
  window: { from: string; to: string };
  /** The one-day layout: base layout with tonight's first builds applied (joins, moves, pulled tables). */
  variant: Room;
  changes: LayoutChange[];
  crew: CrewStep[];
  reasons: { reservationId: string; text: string }[];
  infeasible: { reservationId: string; partySize: number; reason: string; partial?: string }[];
  /** Per placed large party: hold + covers lost, section(s), aisle check. In arrival order. */
  parties: PartyFit[];
  /** A hold or setup that starts while an earlier party is still seated at the same table (should be none). */
  conflicts: HoldConflict[];
  /** The planner's build per placed party (rows, storage), for crew notes and build time. */
  builds: Build[];
  summary: {
    /** Covers the holds cost tonight (sum over parties). */
    coversLostToHolds: number;
    largeParties: number;
    placed: number;
    coversBooked: number;
    peakCovers: { at: string; covers: number };
    seatsOnFloor: number;
    seatsAddedFromStorage: number;
    storageUsed: { extenders: number; chairs: number; spareTables: number };
    storageInStock: { extenders: number; chairs: number; spareTables: number };
  };
}

/** Push a row's tables together along its long axis, keeping the first table where it is. */
type Move = { id: string; from: { x: number; y: number }; to: { x: number; y: number } };

/** Returns the moves and the row's physical order (first → last along its axis). */
function closeRow(variant: Room, row: string[]): { moves: Move[]; ordered: string[] } {
  const tables = row.map((id) => tableById(variant, id) as Table);
  if (tables.length < 2) return { moves: [], ordered: [...row] };
  const xs = tables.map((t) => t.x);
  const ys = tables.map((t) => t.y);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const sorted = [...tables].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const moves: Move[] = [];
  const first = sorted[0] as Table;
  let edge = horizontal ? first.x + first.w : first.y + first.h;
  for (const t of sorted.slice(1)) {
    const to = horizontal ? { x: edge, y: first.y } : { x: first.x, y: edge };
    if (Math.abs(to.x - t.x) > 0.25 || Math.abs(to.y - t.y) > 0.25)
      moves.push({ id: t.id, from: { x: t.x, y: t.y }, to });
    t.x = to.x;
    t.y = to.y;
    edge += horizontal ? t.w : t.h;
  }
  return { moves, ordered: sorted.map((t) => t.id) };
}

function nextTableId(room: Room): () => string {
  let n = Math.max(0, ...room.tables.map((t) => Number(t.id.slice(1))));
  return () => `T${++n}`;
}

/** Peak booked covers in any 15-minute slot, counting each party for one turn. */
function peakCovers(room: Room, from: number, to: number): { at: string; covers: number } {
  let best = { at: toHHMM(from), covers: 0 };
  for (let m = from; m <= to; m += 15) {
    const covers = room.reservations
      .filter((r) => toMinutes(r.time) <= m && m < toMinutes(r.time) + TURN_MIN)
      .reduce((n, r) => n + r.partySize, 0);
    if (covers > best.covers) best = { at: toHHMM(m), covers };
  }
  return best;
}

export function generateTonight(base: Room, from: string, to: string): TonightProposal {
  const plan = planBuilds(base, from, to);
  const variant: Room = structuredClone(base);
  const newId = nextTableId(variant);
  const changes: LayoutChange[] = [];
  const crew: CrewStep[] = [];
  const reasons: TonightProposal["reasons"] = [];
  const firstUse = new Set<string>();
  const lastParty = new Map<string, Build>();
  const builds = [...plan.builds].sort((a, b) => toMinutes(a.buildBy) - toMinutes(b.buildBy));

  for (const b of builds) {
    const rebuild = b.tables.some((id) => firstUse.has(id));
    const actions: string[] = [];
    const prior = [
      ...new Set(b.tables.map((id) => lastParty.get(id)).filter((x): x is Build => !!x)),
    ];
    for (const p of prior)
      actions.push(
        `After ~${toHHMM(toMinutes(p.time) + TURN_MIN)}, split the tables ${p.reservationId} used`,
      );
    for (const d of b.dividersOpened) {
      actions.push(`Open the divider ${d}`);
      if (!rebuild)
        changes.push({
          kind: "open-divider",
          reservationId: b.reservationId,
          tables: [],
          text: `Open the divider ${d}`,
        });
    }
    let sparesLeft = b.spareTables;
    for (const row of b.rows) {
      const ids = [...row];
      if (!rebuild) {
        const { moves, ordered } = closeRow(variant, ids);
        for (const m of moves) {
          changes.push({
            kind: "move",
            reservationId: b.reservationId,
            tables: [m.id],
            from: m.from,
            to: m.to,
            text: `Push table ${tableNo(m.id)} up against its neighbour`,
          });
        }
        // spare tables go on the end of a joinable row
        const last = tableById(variant, ordered[ordered.length - 1] as string) as Table;
        const firstT = tableById(variant, ordered[0] as string) as Table;
        const horizontal = Math.abs(last.x - firstT.x) >= Math.abs(last.y - firstT.y);
        let end = last;
        while (sparesLeft > 0 && last.joinable && ids.length > 1) {
          const id = newId();
          const { phase, partySize, reservedAt, ...shell } = end;
          const t: Table = {
            ...shell,
            id,
            seats: 4,
            minSeats: 1,
            maxExtraChairs: 0,
            status: "open",
            x: horizontal ? end.x + end.w : end.x,
            y: horizontal ? end.y : end.y + end.h,
            w: 4,
            h: 4,
            shape: "rect",
            joinable: true,
          };
          variant.tables.push(t);
          variant.joins.push([end.id, id]);
          ids.push(id);
          changes.push({
            kind: "pull-table",
            reservationId: b.reservationId,
            tables: [id],
            to: { x: t.x, y: t.y },
            text: "Bring a spare 4-top from storage to the end of the row",
          });
          actions.push(`Bring a spare 4-top from storage to the end of table ${tableNo(end.id)}`);
          end = t;
          sparesLeft--;
        }
        if (ids.length > 1) {
          variant.combos.push(ids);
          changes.push({
            kind: "join",
            reservationId: b.reservationId,
            tables: ids,
            text: `Combine ${tablesPhrase(ids)}`,
          });
        }
      }
      actions.push(ids.length > 1 ? `Combine ${tablesPhrase(ids)}` : `Set ${tablesPhrase(ids)}`);
    }
    if (rebuild && b.spareTables)
      actions.push(`Bring ${b.spareTables} spare 4-top(s) from storage to the row end`);
    if (b.extenders) {
      actions.push(`Add ${b.extenders} extender(s)`);
      changes.push({
        kind: "pull-extenders",
        reservationId: b.reservationId,
        tables: b.tables,
        count: b.extenders,
        text: `${b.extenders} extender(s) from storage`,
      });
    }
    if (b.extraChairs) {
      actions.push(`Bring ${b.extraChairs} chair(s) from storage`);
      changes.push({
        kind: "pull-chairs",
        reservationId: b.reservationId,
        tables: b.tables,
        count: b.extraChairs,
        text: `${b.extraChairs} chair(s) from storage`,
      });
    }
    const minutes = buildMinutes(b);
    // never before the room clock or before the earlier party on these tables leaves; when that leaves
    // too little time the window runs on (up to the party's arrival) and is flagged as tight
    const earliest = Math.max(
      toMinutes(base.clock),
      ...prior.map((p) => toMinutes(p.time) + TURN_MIN),
    );
    const startM = Math.max(earliest, toMinutes(b.buildBy) - minutes);
    const endM = Math.max(toMinutes(b.buildBy), Math.min(toMinutes(b.time), startM + minutes));
    actions.push(
      endM > toMinutes(b.buildBy)
        ? `Set for ${b.partySize} by ${toHHMM(endM)} (tight: the party arrives at ${b.time})`
        : `Set for ${b.partySize} by ${b.buildBy}`,
    );
    crew.push({
      start: toHHMM(startM),
      end: toHHMM(endM),
      reservationId: b.reservationId,
      partySize: b.partySize,
      when: rebuild ? "rebuild" : "set",
      tight: toMinutes(b.buildBy) - minutes < earliest,
      actions,
    });
    reasons.push({ reservationId: b.reservationId, text: reasonFor(base, b) });
    for (const id of b.tables) {
      firstUse.add(id);
      lastParty.set(id, b);
    }
  }
  crew.sort(
    (a, b) =>
      toMinutes(a.start) - toMinutes(b.start) || a.reservationId.localeCompare(b.reservationId),
  );

  const spareStock = base.inventory.spareTables
    .filter((t) => t.seats >= 4)
    .reduce((n, t) => n + t.count, 0);
  variant.inventory = {
    extenders: base.inventory.extenders - plan.totals.extenders,
    spareChairs: base.inventory.spareChairs - plan.totals.extraChairs,
    spareTables: base.inventory.spareTables.map((t) => ({ ...t })),
  };
  let toTake = plan.totals.spareTables;
  for (const t of variant.inventory.spareTables) {
    if (t.seats < 4 || !toTake) continue;
    const k = Math.min(t.count, toTake);
    t.count -= k;
    toTake -= k;
  }
  const window = { from, to };
  const inWindow = base.reservations.filter(
    (r) => toMinutes(r.time) >= toMinutes(from) && toMinutes(r.time) <= toMinutes(to),
  );
  const parties = partyFits(base, plan.builds, from);
  const setupStarts: Record<string, string> = {};
  for (const c of crew)
    if (!setupStarts[c.reservationId] || c.start < (setupStarts[c.reservationId] as string))
      setupStarts[c.reservationId] = c.start;
  const conflicts = holdConflicts(parties, setupStarts);
  return {
    conflicts,
    window,
    variant,
    changes,
    crew,
    reasons,
    infeasible: plan.unplaced,
    builds: plan.builds,
    parties,
    summary: {
      coversLostToHolds: parties.reduce((n, f) => n + f.hold.coversLost, 0),
      largeParties: plan.builds.length + plan.unplaced.length,
      placed: plan.builds.length,
      coversBooked: inWindow.reduce((n, r) => n + r.partySize, 0),
      peakCovers: peakCovers(base, toMinutes(from), toMinutes(to)),
      seatsOnFloor: base.tables
        .filter((t) => t.status !== "blocked")
        .reduce((n, t) => n + t.seats, 0),
      seatsAddedFromStorage: plan.totals.extraChairs,
      storageUsed: {
        extenders: plan.totals.extenders,
        chairs: plan.totals.extraChairs,
        spareTables: plan.totals.spareTables,
      },
      storageInStock: {
        extenders: base.inventory.extenders,
        chairs: base.inventory.spareChairs,
        spareTables: spareStock,
      },
    },
  };
}

function reasonFor(room: Room, b: Build): string {
  const r = room.reservations.find((x) => x.id === b.reservationId);
  const parts: string[] = [];
  parts.push(`${b.reservationId} (${b.partySize}) → ${b.area}`);
  if (b.dividersOpened.length)
    parts.push(
      `${b.rows.length} long tables across ${b.dividersOpened.length + 1} neighbouring rooms, dividers open`,
    );
  else if (b.rows.length > 1) parts.push(`${b.rows.length} long tables in one room`);
  else if (b.tables.length > 1) parts.push(`one long table of ${b.tables.length}`);
  if (r?.area) parts.push(`room requested`);
  if (r?.needs.length) parts.push(`meets ${r.needs.join(", ")}`);
  const storage = [
    b.extenders && `${b.extenders} extender(s)`,
    b.spareTables && `${b.spareTables} spare table(s)`,
    b.extraChairs && `${b.extraChairs} chair(s)`,
  ].filter(Boolean);
  parts.push(storage.length ? `storage: ${storage.join(", ")}` : "no storage needed");
  parts.push(`seats ${b.seats} for ${b.partySize}, build by ${b.buildBy}`);
  return parts.join(" · ");
}
