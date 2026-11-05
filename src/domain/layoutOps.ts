// Floor edits by conversation: the engine. The AI only turns a manager's words into structured operations
// ("move tables 63–66 into the Garden Room"); this code alone resolves which tables they mean, places them on
// free spots, checks every rule, and re-plans the night. Nothing here calls a model, and the same input always
// gives the same output. A proposal changes nothing until the manager applies it.
import { z } from "zod";
import { planBuilds } from "./buildplan";
import { checkJoin } from "./clearance";
import { canJoin } from "./joins";
import { estimateFreeTime } from "./phases";
import { SERVICE } from "./requests";
import { areaByName, neighbours, tableById } from "./room";
import { allHomes, clearanceForLayout, positionOf, spotsFor, type VenueSpots } from "./spots";
import { clock12, toMinutes } from "./time";
import { nextTableId } from "./tonight";
import { MAX_NEIGHBOURS, type Room, type Table, type TableAttrs } from "./types";
import { listAnd, tableNo } from "./wording";

/** Which tables an operation means. Unused fields carry sentinels (0 / "any" / ""), never null. */
export const TableRef = z
  .object({
    by: z.enum(["number", "range", "description", "room"]),
    /** by "number": the table number the manager typed. */
    n: z.number().int(),
    /** by "range": both ends as typed ("63–66"); the engine expands it. */
    from: z.number().int(),
    to: z.number().int(),
    /** by "description": "the round 8-top in the Garden Room". */
    shape: z.enum(["any", "round", "rect", "diamond", "booth"]),
    seats: z.number().int(),
    /** by "room" (all of that room's tables), or narrowing a description. */
    room: z.string(),
  })
  .strict();
export type TableRef = z.infer<typeof TableRef>;

export const OP_KINDS = [
  "move",
  "swap",
  "join",
  "split",
  "from_storage",
  "to_storage",
  "arrange_rows",
] as const;

export const LayoutOp = z
  .object({
    op: z.enum(OP_KINDS),
    tables: z.array(TableRef),
    /** Destination room (move, from_storage, arrange_rows); "" when unused. */
    to: z.string(),
    /** from_storage: the size of table to bring (2 or 4 seats); 0 when unused. */
    seats: z.literal([0, 2, 4]),
    /** from_storage: how many (1–6); 0 when unused. */
    count: z.number().int(),
    /** arrange_rows: the rows the room should end with, as a multiset ("2 rows of 4 and 5" → [4, 5]). */
    rows: z.array(z.number().int()),
  })
  .strict();
export type LayoutOp = z.infer<typeof LayoutOp>;

/** Most operations in one proposal (more → one plain reason, not a JSON failure). */
export const MAX_OPS = 6;
/** Crew estimate per table carried (moved, swapped, to or from storage). Labelled "est." on screen. */
export const MOVE_MIN = 3;

export type Rule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11";

export interface FloorChange {
  kind: "move" | "swap" | "join" | "split" | "to_storage" | "from_storage";
  tables: string[];
  /** Before → after positions (for the ghost + arrow on the floor); absent for joinability changes. */
  from?: { area: string; x: number; y: number };
  to?: { area: string; x: number; y: number };
  /** "Table 63 · Library → Garden Room back row" */
  text: string;
}

export interface LayoutEdit {
  ok: boolean;
  /** The floor after the edit (null when rejected). */
  edited: Room | null;
  changes: FloorChange[];
  /** One line per physical move, in build order. */
  crew: string[];
  crewMinutes: number;
  /** Every reason the whole proposal is rejected (nothing changes). */
  rejects: { rule: Rule; text: string }[];
  /** Plan-state answers that need no change ("Already joinable; …"). */
  notes: string[];
}

export interface EditContext {
  /** A party's display name (default: its id). */
  nameOf?: (id: string) => string;
  /** Tables of the request's current plan: a description's candidates are listed nearest these first. */
  near?: readonly string[];
  /** The edit would land on the base layout (never allowed from chat). */
  onBase?: boolean;
}

/** Where a table could go: a listed spot, or a home position another table has left. */
interface Candidate {
  key: string;
  room: string;
  /** "Garden Room back row" · "Library (where table 62 stood)" */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fits: "square" | "round";
  spare: boolean;
  attrs: TableAttrs;
  maxExtraChairs: number;
  row: string | null;
  /** Home candidates: the table whose home this is. */
  home?: string;
}

const ROUND_WORD: Record<Table["shape"], string> = {
  round: "round",
  rect: "rectangular",
  diamond: "diamond",
  booth: "booth",
};

/** "Table 56 (round, 8)" */
const tableDesc = (t: Table) => `Table ${tableNo(t.id)} (${ROUND_WORD[t.shape]}, ${t.seats})`;

const box = (t: { x: number; y: number; w: number; h: number }) => t;
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 0,
) =>
  a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

function accepts(c: { fits: "square" | "round"; w: number; h: number }, t: Table): boolean {
  if (t.shape === "booth") return false;
  if ((t.shape === "round") !== (c.fits === "round")) return false;
  return t.w <= c.w && t.h <= c.h;
}

/** Match a room name the model sent ("the garden room") to an area on this floor. */
export function roomByName(room: Room, name: string) {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "");
  if (!n) return undefined;
  return room.areas.find((a) => a.name.toLowerCase() === n);
}

/** Seating rooms (not the service station or the bar). */
export const isSeatingRoom = (a: { kind: string }) => a.kind === "dining" || a.kind === "private";

function sectionOf(room: Room, area: string): number {
  return (
    room.tables.find((t) => t.area === area)?.section ??
    room.tables.reduce((n, t) => Math.max(n, t.section), 0) + 1
  );
}

/** Base-layout rows of home positions: home id → row id, and which homes are neighbours in a row. */
function homeRows(v: VenueSpots, base: Room): { rowOf: Map<string, string>; adj: Set<string> } {
  const adj = new Set<string>();
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    return p === x ? x : find(p);
  };
  for (const id of Object.keys(v.homes)) parent.set(id, id);
  const pairs = new Set<string>(
    Object.keys(clearanceForLayout(base)?.joins ?? {}).concat(base.joins.map((j) => j.join("|"))),
  );
  for (const k of pairs) {
    const [a, b] = k.split("|") as [string, string];
    if (!v.homes[a] || !v.homes[b]) continue;
    adj.add(`${a}|${b}`);
    adj.add(`${b}|${a}`);
    parent.set(find(a), find(b));
  }
  const rowOf = new Map<string, string>();
  for (const k of pairs)
    for (const id of k.split("|")) if (v.homes[id]) rowOf.set(id, `home:${find(id)}`);
  return { rowOf, adj };
}

function candidates(v: VenueSpots, before: Room, area: string): Candidate[] {
  const listed: Candidate[] = v.spots
    .filter((s) => s.room === area)
    .map((s) => ({
      key: s.id,
      room: s.room,
      label: s.label,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      fits: s.fits,
      spare: s.spare,
      attrs: s.attrs,
      maxExtraChairs: s.maxExtraChairs,
      row: s.row,
    }));
  const { rowOf } = homeRows(v, before);
  const homes: Candidate[] = [];
  for (const h of allHomes(v)) {
    if (h.room !== area || h.shape === "booth") continue;
    // its attributes come from the table that lives there (on the floor before this edit)
    const owner = tableById(before, h.tableId);
    if (!owner) continue;
    homes.push({
      key: h.tableId,
      room: h.room,
      label: `${h.room} (where table ${tableNo(h.tableId)} stood)`,
      x: h.x,
      y: h.y,
      w: h.w,
      h: h.h,
      fits: h.shape === "round" ? "round" : "square",
      spare: false,
      attrs: owner.attrs,
      maxExtraChairs: owner.maxExtraChairs,
      row: rowOf.get(h.tableId) ?? null,
      home: h.tableId,
    });
  }
  // row spots left to right, then other spots (home positions, the round spot), spare spots last
  const rank = (c: Candidate) => (c.row ? 0 : c.spare ? 2 : 1);
  return [...listed, ...homes].sort(
    (a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x || a.key.localeCompare(b.key),
  );
}

/** Are two tables side by side in one row (same line, at most 1.5 grid units apart)? */
export function sideBySide(a: Table, b: Table): boolean {
  if (a.area !== b.area) return false;
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  if (Math.abs(a.y - b.y) < 0.25 && gapX >= -0.01 && gapX <= 1.5) return true;
  return Math.abs(a.x - b.x) < 0.25 && gapY >= -0.01 && gapY <= 1.5;
}

/** "round 8-top" · "8-top" · "round table" */
function descPhrase(ref: TableRef): string {
  const shape = ref.shape === "any" ? "" : ref.shape === "rect" ? "rectangular" : ref.shape;
  const size = ref.seats > 0 ? `${ref.seats}-top` : "table";
  return [shape, size].filter(Boolean).join(" ");
}

const centre = (t: Table) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });

interface Resolved {
  ids: string[];
  rejects: { rule: Rule; text: string }[];
}

/** Turn one reference into table ids on this floor (R1 / R2 when it can't). */
export function resolveRef(room: Room, ref: TableRef, ctx: EditContext = {}): Resolved {
  const area = ref.room ? roomByName(room, ref.room) : undefined;
  if (ref.room && !area)
    return { ids: [], rejects: [{ rule: "R2", text: `There's no ${ref.room} on this floor.` }] };
  switch (ref.by) {
    case "number": {
      const id = `T${ref.n}`;
      return tableById(room, id)
        ? { ids: [id], rejects: [] }
        : { ids: [], rejects: [{ rule: "R1", text: `Table ${ref.n} isn't on this floor.` }] };
    }
    case "range": {
      const lo = Math.min(ref.from, ref.to);
      const hi = Math.max(ref.from, ref.to);
      const ids = room.tables
        .map((t) => t.id)
        .filter((id) => {
          const n = Number(tableNo(id));
          return n >= lo && n <= hi;
        })
        .sort((a, b) => Number(tableNo(a)) - Number(tableNo(b)));
      return ids.length
        ? { ids, rejects: [] }
        : {
            ids: [],
            rejects: [{ rule: "R1", text: `No tables numbered ${lo}–${hi} on this floor.` }],
          };
    }
    case "room": {
      if (!area) return { ids: [], rejects: [{ rule: "R2", text: "Which room do you mean?" }] };
      const ids = room.tables
        .filter((t) => t.area === area.name)
        .map((t) => t.id)
        .sort((a, b) => Number(tableNo(a)) - Number(tableNo(b)));
      return ids.length
        ? { ids, rejects: [] }
        : { ids: [], rejects: [{ rule: "R1", text: `The ${area.name} has no tables.` }] };
    }
    case "description": {
      const hits = room.tables.filter(
        (t) =>
          (ref.shape === "any" || t.shape === ref.shape) &&
          (ref.seats <= 0 || t.seats === ref.seats) &&
          (!area || t.area === area.name),
      );
      const what = descPhrase(ref);
      if (hits.length === 1) return { ids: [(hits[0] as Table).id], rejects: [] };
      if (!hits.length)
        return {
          ids: [],
          rejects: [
            { rule: "R1", text: `No ${what} on this floor${area ? ` in the ${area.name}` : ""}.` },
          ],
        };
      // nearest the request's current plan first, then by number
      const near = (ctx.near ?? []).map((id) => tableById(room, id)).filter((t): t is Table => !!t);
      const dist = (t: Table) =>
        near.length
          ? Math.min(
              ...near.map((n) => Math.hypot(centre(n).x - centre(t).x, centre(n).y - centre(t).y)),
            )
          : 0;
      const sorted = [...hits].sort(
        (a, b) => dist(a) - dist(b) || Number(tableNo(a.id)) - Number(tableNo(b.id)),
      );
      const names = sorted.map((t) => `table ${tableNo(t.id)} (${t.area})`);
      const list = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
      return {
        ids: [],
        rejects: [{ rule: "R1", text: `Which ${what} do you mean: ${list}?` }],
      };
    }
  }
}

function refsToIds(room: Room, refs: readonly TableRef[], ctx: EditContext): Resolved {
  const out: Resolved = { ids: [], rejects: [] };
  for (const ref of refs) {
    const r = resolveRef(room, ref, ctx);
    for (const id of r.ids) if (!out.ids.includes(id)) out.ids.push(id);
    out.rejects.push(...r.rejects);
  }
  return out;
}

/** Is this table free to move at the move time (live night: now; planning night: by service start)? */
function busyReason(room: Room, t: Table): string | null {
  const now = toMinutes(room.clock);
  const start = toMinutes(SERVICE.from);
  const live = now >= start;
  const n = tableNo(t.id);
  if (t.status === "blocked") return `Table ${n} is blocked tonight.`;
  if (t.status === "reserved")
    return `Table ${n} is held${t.reservedAt ? ` for ${clock12(t.reservedAt)}` : ""}.`;
  if (t.status === "occupied") {
    if (live) return `Table ${n} is occupied now.`;
    const free = estimateFreeTime(t).minutes;
    if (free === null || now + free > start)
      return `Table ${n} won't be free by ${clock12(SERVICE.from)}.`;
  }
  return null;
}

const countWord = (k: number) =>
  k === 0 ? "No free spot" : k === 1 ? "Only 1 free spot" : `${k} free spots`;

/**
 * Propose a floor edit: apply every operation as ONE proposal on a copy of the floor and check it. Rejected as a
 * whole (nothing changes) with every reason; otherwise the edited floor, the changes and the crew steps.
 */
export function proposeLayoutEdit(
  room: Room,
  ops: readonly LayoutOp[],
  ctx: EditContext = {},
): LayoutEdit {
  const nameOf = ctx.nameOf ?? ((id: string) => id);
  const rejects: LayoutEdit["rejects"] = [];
  const notes: string[] = [];
  const fail = (): LayoutEdit => ({
    ok: false,
    edited: null,
    changes: [],
    crew: [],
    crewMinutes: 0,
    rejects: dedupe(rejects),
    notes,
  });
  const v = spotsFor(room);
  if (!v) {
    rejects.push({
      rule: "R2",
      text: "This floor has no listed spots, so tables can't be moved here.",
    });
    return fail();
  }
  if (ctx.onBase)
    rejects.push({
      rule: "R10",
      text: "I only change tonight's floor — not the base layout.",
    });
  if (ops.length > MAX_OPS)
    rejects.push({
      rule: "R10",
      text: `That's ${ops.length} changes at once; ask for up to ${MAX_OPS}.`,
    });
  if (rejects.length) return fail();

  // ---- 1. resolve every reference and destination
  const fixed = new Set<string>();
  const busy = new Set<string>();
  const checkMovable = (ids: readonly string[]) => {
    for (const id of ids) {
      const t = tableById(room, id) as Table;
      if (t.shape === "booth") {
        if (!fixed.has(id))
          rejects.push({
            rule: "R11",
            text: `Table ${tableNo(id)} is a booth — booths are fixed, so it stays where it is.`,
          });
        fixed.add(id);
        continue;
      }
      const why = busyReason(room, t);
      if (why && !busy.has(id)) {
        busy.add(id);
        rejects.push({ rule: "R3", text: why });
      }
    }
  };
  const dest = (name: string) => {
    const a = roomByName(room, name);
    if (!a) {
      rejects.push({
        rule: "R2",
        text: name.trim()
          ? `There's no ${name.trim()} on this floor.`
          : "Which room should they go to?",
      });
      return null;
    }
    if (!isSeatingRoom(a)) {
      rejects.push({ rule: "R2", text: `The ${a.name} isn't a seating room.` });
      return null;
    }
    return a.name;
  };

  interface Placement {
    id: string;
    to: string | null;
    /** swap: the exact position to take */
    target?: Candidate;
  }
  const outgoing: { id: string; kind: "move" | "swap" | "to_storage" }[] = [];
  const placements: Placement[] = [];
  const storageAdds: { seats: 2 | 4; to: string }[] = [];
  const joinOps: { ids: string[]; on: boolean }[] = [];
  const rowChecks: { area: string; rows: number[] }[] = [];
  const claimed = new Set<string>();
  const claim = (id: string) => {
    if (claimed.has(id)) {
      rejects.push({ rule: "R9", text: `Table ${tableNo(id)} is in two changes at once.` });
      return false;
    }
    claimed.add(id);
    return true;
  };

  for (const op of ops) {
    const res = refsToIds(room, op.tables, ctx);
    rejects.push(...res.rejects);
    switch (op.op) {
      case "move": {
        const to = dest(op.to);
        checkMovable(res.ids);
        for (const id of res.ids) {
          if (fixed.has(id) || !claim(id)) continue;
          outgoing.push({ id, kind: "move" });
          placements.push({ id, to });
        }
        break;
      }
      case "swap": {
        const [a, b] = res.ids;
        if (!a || !b || res.ids.length !== 2) {
          if (!res.rejects.length)
            rejects.push({ rule: "R1", text: "Which two tables should swap places?" });
          break;
        }
        checkMovable([a, b]);
        if (fixed.has(a) || fixed.has(b) || !claim(a) || !claim(b)) break;
        const ta = tableById(room, a) as Table;
        const tb = tableById(room, b) as Table;
        const spotOf = (t: Table): Candidate => ({
          key: positionOf(v, t).key,
          room: t.area,
          label: `${t.area} (where table ${tableNo(t.id)} stood)`,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          fits: t.shape === "round" ? "round" : "square",
          spare: false,
          attrs: t.attrs,
          maxExtraChairs: t.maxExtraChairs,
          row: null,
          home: t.id,
        });
        for (const [x, y] of [
          [ta, tb],
          [tb, ta],
        ] as const)
          if (!accepts(spotOf(y), x))
            rejects.push({
              rule: "R5",
              text: `${tableDesc(x)} doesn't fit where table ${tableNo(y.id)} stands.`,
            });
        outgoing.push({ id: a, kind: "swap" }, { id: b, kind: "swap" });
        placements.push({ id: a, to: tb.area, target: spotOf(tb) });
        placements.push({ id: b, to: ta.area, target: spotOf(ta) });
        break;
      }
      case "to_storage": {
        checkMovable(res.ids);
        for (const id of res.ids)
          if (!fixed.has(id) && claim(id)) outgoing.push({ id, kind: "to_storage" });
        break;
      }
      case "from_storage": {
        const to = dest(op.to);
        const seats = op.seats === 2 ? 2 : 4;
        const count = op.count;
        if (count < 1 || count > MAX_OPS) {
          rejects.push({
            rule: "R7",
            text: "Bring between 1 and 6 tables from storage at a time.",
          });
          break;
        }
        if (to) for (let i = 0; i < count; i++) storageAdds.push({ seats, to });
        break;
      }
      case "join":
      case "split": {
        for (const id of res.ids)
          if ((tableById(room, id) as Table).shape === "booth" && !fixed.has(id)) {
            fixed.add(id);
            rejects.push({
              rule: "R11",
              text: `Table ${tableNo(id)} is a booth — booths are fixed, so it stays where it is.`,
            });
          }
        if (res.ids.length < 2 && !res.rejects.length)
          rejects.push({ rule: "R9", text: "Name at least two tables to join or split." });
        else joinOps.push({ ids: res.ids.filter((id) => !fixed.has(id)), on: op.op === "join" });
        break;
      }
      case "arrange_rows": {
        const to = dest(op.to);
        if (to && op.rows.length) rowChecks.push({ area: to, rows: [...op.rows] });
        break;
      }
    }
  }

  // ---- 2. storage stock (after the night's other builds)
  const before = planBuilds(room, SERVICE.from, SERVICE.to);
  const inventory = structuredClone(room.inventory);
  for (const seats of [2, 4] as const) {
    const want = storageAdds.filter((s) => s.seats === seats).length;
    if (!want) continue;
    const have = inventory.spareTables.find((x) => x.seats === seats)?.count ?? 0;
    // the planner uses spare tables of 4+ seats as joinable 4-tops
    const used = seats === 4 ? before.totals.spareTables : 0;
    const free = Math.max(0, have - used);
    if (want > free)
      rejects.push({
        rule: "R7",
        text: `Only ${free} spare ${seats}-top${free === 1 ? "" : "s"} in storage tonight${
          used ? " after the night's other builds" : ""
        }, not ${want}.`,
      });
  }

  // ---- 3. place: vacate every outgoing table first, then fill spots
  const outIds = new Set(outgoing.map((o) => o.id));
  let next: Room = {
    ...room,
    tables: room.tables.filter((t) => !outIds.has(t.id)),
    joins: room.joins.filter(([a, b]) => !outIds.has(a) && !outIds.has(b)),
    combos: room.combos.filter((c) => !c.some((id) => outIds.has(id))),
    inventory,
    areas: room.areas.map((a) => ({ ...a })),
  };
  // spare spots the night's plan already fills with storage tables
  const spareUsed = new Map<string, number>();
  for (const b of before.builds)
    if (b.spareTables) {
      const a = b.area.split(" + ")[0] as string;
      spareUsed.set(a, (spareUsed.get(a) ?? 0) + b.spareTables);
    }
  const spareFree = (area: string) =>
    Math.max(0, (areaByName(next, area)?.spareSlots ?? 0) - (spareUsed.get(area) ?? 0));
  const placed: { table: Table; cand: Candidate; from: Table | null }[] = [];
  const isFree = (c: Candidate) =>
    !next.tables.some((t) => overlaps(box(t), box(c))) && (!c.spare || spareFree(c.room) > 0);
  const put = (t: Table, c: Candidate, from: Table | null) => {
    const moved: Table = {
      ...t,
      area: c.room,
      section: sectionOf(room, c.room),
      x: c.x,
      y: c.y,
      attrs: { ...c.attrs },
      maxExtraChairs: c.maxExtraChairs,
    };
    next = { ...next, tables: [...next.tables, moved] };
    if (c.spare)
      next = {
        ...next,
        areas: next.areas.map((a) =>
          a.name === c.room ? { ...a, spareSlots: Math.max(0, a.spareSlots - 1) } : a,
        ),
      };
    placed.push({ table: moved, cand: c, from });
  };

  // swaps take each other's exact place
  for (const p of placements)
    if (p.target) {
      const t = tableById(room, p.id) as Table;
      if (accepts(p.target, t)) put(t, p.target, t);
    }
  // moves and storage tables fill free spots room by room, in the order asked
  const byRoom = new Map<string, { table: Table; from: Table | null }[]>();
  for (const p of placements)
    if (!p.target && p.to)
      byRoom.set(p.to, [
        ...(byRoom.get(p.to) ?? []),
        { table: tableById(room, p.id) as Table, from: tableById(room, p.id) as Table },
      ]);
  const newId = nextTableId(room);
  for (const s of storageAdds) {
    const small = s.seats === 2;
    const t: Table = {
      id: newId(),
      area: s.to,
      section: sectionOf(room, s.to),
      x: 0,
      y: 0,
      w: small ? 3 : 4,
      h: small ? 3 : 4,
      shape: "rect",
      maxExtraChairs: 0,
      minSeats: 1,
      seats: s.seats,
      joinable: true,
      attrs: { accessible: false, strollerSpace: false, quiet: false, view: false, booth: false },
      status: "open",
    };
    byRoom.set(s.to, [...(byRoom.get(s.to) ?? []), { table: t, from: null }]);
  }
  for (const [area, list] of byRoom) {
    const cands = candidates(v, room, area);
    const unplaced: Table[] = [];
    // free spots at the start, for the reason when they run out
    const freeAt = cands.filter(isFree);
    for (const { table, from } of list) {
      // a move is never back onto the table's own home
      const c = cands.find((x) => x.home !== table.id && isFree(x) && accepts(x, table));
      if (c) put(table, c, from);
      else unplaced.push(table);
    }
    if (!unplaced.length) continue;
    const groups = new Map<"round" | "square", Table[]>();
    for (const t of unplaced) {
      const g = t.shape === "round" ? "round" : "square";
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    for (const [g, ts] of groups) {
      const want = list.filter((x) => (x.table.shape === "round" ? "round" : "square") === g);
      const fitting = freeAt.filter((c) => want.some((x) => accepts(c, x.table))).length;
      if (fitting === 0 && freeAt.length > 0)
        for (const t of ts)
          rejects.push({
            rule: "R5",
            text: `${tableDesc(t)} doesn't fit the free spots in the ${area}.`,
          });
      else
        rejects.push({
          rule: "R4",
          text: `${countWord(fitting)} in the ${area} for ${want.length} table${want.length === 1 ? "" : "s"}.`,
        });
    }
  }
  if (rejects.length) return fail();

  // ---- 4. joins: moved tables join their new row neighbours; then the asked joinability changes
  const { adj } = homeRows(v, room);
  const posKey = (t: Table) => positionOf(v, t).key;
  const rowNeighbour = (a: string, b: string) =>
    adj.has(`${a}|${b}`) ||
    v.pairs[`${a}|${b}`] !== undefined ||
    v.pairs[`${b}|${a}`] !== undefined;
  const addJoin = (a: string, b: string) => {
    if (canJoin(next, a, b) === null) next = { ...next, joins: [...next.joins, [a, b]] };
  };
  for (const p of placed) {
    const k = posKey(p.table);
    for (const o of next.tables) {
      if (o.id === p.table.id || o.area !== p.table.area) continue;
      if (rowNeighbour(k, posKey(o))) addJoin(p.table.id, o.id);
    }
  }
  const joinChanges: FloorChange[] = [];
  const newJoins: [string, string][] = [];
  for (const j of joinOps) {
    const ts = j.ids
      .map((id) => tableById(next, id))
      .filter((t): t is Table => !!t)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const pairs: [Table, Table][] = [];
    if (j.on) for (let i = 1; i < ts.length; i++) pairs.push([ts[i - 1] as Table, ts[i] as Table]);
    else
      for (let i = 0; i < ts.length; i++)
        for (let k = i + 1; k < ts.length; k++) pairs.push([ts[i] as Table, ts[k] as Table]);
    const done: string[] = [];
    let already = 0;
    for (const [a, b] of pairs) {
      const linked = neighbours(next, a.id).includes(b.id);
      if (!j.on) {
        if (!linked) continue;
        next = {
          ...next,
          joins: next.joins.filter(
            ([x, y]) => !((x === a.id && y === b.id) || (x === b.id && y === a.id)),
          ),
          combos: next.combos.filter((c) => !(c.includes(a.id) && c.includes(b.id))),
        };
        done.push(`${tableNo(a.id)}–${tableNo(b.id)}`);
        continue;
      }
      if (linked) {
        already++;
        continue;
      }
      const why = canJoin(next, a.id, b.id);
      if (why) {
        rejects.push({
          rule: "R9",
          text: `Tables ${tableNo(a.id)} and ${tableNo(b.id)} can't join: ${why}.`,
        });
        continue;
      }
      if (!sideBySide(a, b)) {
        rejects.push({
          rule: "R9",
          text: `Tables ${tableNo(a.id)} and ${tableNo(b.id)} aren't side by side in a row.`,
        });
        continue;
      }
      next = { ...next, joins: [...next.joins, [a.id, b.id]] };
      newJoins.push([a.id, b.id]);
      done.push(`${tableNo(a.id)}–${tableNo(b.id)}`);
    }
    if (j.on && already && !done.length && pairs.length === already)
      notes.push("Already joinable; the planner pushes them together when a party needs it.");
    if (!j.on && !done.length && pairs.length)
      notes.push(
        `${ts.length === 2 ? "Those two tables aren't" : "None of those tables are"} joinable now, so there's nothing to split.`,
      );
    if (done.length) {
      const ids = ts.map((t) => t.id);
      joinChanges.push({
        kind: j.on ? "join" : "split",
        tables: ids,
        text: j.on
          ? `${listAnd(done.map((d) => `Tables ${d}`))} · may be pushed together tonight`
          : `Tables ${listAnd(done)} · not pushed together tonight`,
      });
    }
  }
  // no table may end with more than MAX_NEIGHBOURS joinable neighbours (R9)
  for (const t of next.tables)
    if (neighbours(next, t.id).length > MAX_NEIGHBOURS)
      rejects.push({
        rule: "R9",
        text: `Table ${tableNo(t.id)} would have more than ${MAX_NEIGHBOURS} joinable neighbours.`,
      });
  // rows the manager asked the room to end with ("2 rows of 4 and 5")
  for (const rc of rowChecks) {
    const got = rowSizes(next, rc.area);
    const a = [...got].sort((x, y) => x - y).join();
    const b = [...rc.rows].sort((x, y) => x - y).join();
    if (a !== b)
      rejects.push({
        rule: "R9",
        text: `The ${rc.area} would end with ${
          got.length ? `rows of ${listAnd(got.map(String))}` : "no rows"
        }, not ${listAnd(rc.rows.map(String))}.`,
      });
  }

  // ---- 5. aisles beside every join a moved table now has, and room around each placed table (R6)
  const c = clearanceForLayout(next);
  const touched = new Set([...placed.map((p) => p.table.id), ...newJoins.flat()]);
  if (c)
    for (const [a, b] of next.joins) {
      if (!touched.has(a) && !touched.has(b)) continue;
      const j = checkJoin(c, a, b);
      if (!j.ok && j.reason) rejects.push({ rule: "R6", text: capital(j.reason) + "." });
    }
  for (const p of placed)
    for (const o of next.tables) {
      if (o.id === p.table.id || overlaps(o, p.table)) continue;
      if (overlaps(o, p.table, 1 - 0.01))
        rejects.push({
          rule: "R6",
          text: `Table ${tableNo(p.table.id)} would stand closer than 1 grid unit to table ${tableNo(o.id)}.`,
        });
    }

  // ---- 6. every large party already placed tonight keeps a table (R8)
  if (!rejects.length) {
    const after = planBuilds(next, SERVICE.from, SERVICE.to);
    const placedAfter = new Set(after.builds.map((b) => b.reservationId));
    for (const b of before.builds)
      if (!placedAfter.has(b.reservationId))
        rejects.push({
          rule: "R8",
          text: `${nameOf(b.reservationId)} (${b.partySize}) would have no table at ${clock12(b.time)}.`,
        });
  }
  if (rejects.length) return fail();

  // ---- 7. what changes, and the crew steps in build order
  const changes: FloorChange[] = [];
  const crew: string[] = [];
  let minutes = 0;
  const at = (t: Table) => ({ area: t.area, x: t.x, y: t.y });
  for (const o of outgoing.filter((x) => x.kind === "to_storage")) {
    const t = tableById(room, o.id) as Table;
    const stored = t.shape === "rect" && t.joinable;
    if (stored) {
      const e = next.inventory.spareTables.find((x) => x.seats === t.seats);
      next = {
        ...next,
        inventory: {
          ...next.inventory,
          spareTables: e
            ? next.inventory.spareTables.map((x) =>
                x.seats === t.seats ? { ...x, count: x.count + 1 } : x,
              )
            : [...next.inventory.spareTables, { seats: t.seats, count: 1 }],
        },
      };
    }
    changes.push({
      kind: "to_storage",
      tables: [t.id],
      from: at(t),
      text: `Table ${tableNo(t.id)} · ${t.area} → ${stored ? "storage" : "set aside for tonight"}`,
    });
    crew.push(
      stored
        ? `Take table ${tableNo(t.id)} out of the ${t.area} to storage`
        : `Take table ${tableNo(t.id)} out of the ${t.area} and set it aside for tonight`,
    );
    minutes += MOVE_MIN;
  }
  for (const p of placed) {
    const n = tableNo(p.table.id);
    if (p.from) {
      const swap = outgoing.find((o) => o.id === p.table.id)?.kind === "swap";
      changes.push({
        kind: swap ? "swap" : "move",
        tables: [p.table.id],
        from: at(p.from),
        to: at(p.table),
        text: `Table ${n} · ${p.from.area} → ${p.cand.label}`,
      });
      crew.push(
        p.from.area === p.table.area
          ? `Move table ${n} within the ${p.table.area} to the ${p.cand.label}`
          : `Move table ${n} from the ${p.from.area} to the ${p.cand.label}`,
      );
    } else {
      const inv = next.inventory.spareTables;
      next = {
        ...next,
        inventory: {
          ...next.inventory,
          spareTables: inv.map((x) =>
            x.seats === p.table.seats ? { ...x, count: Math.max(0, x.count - 1) } : x,
          ),
        },
      };
      changes.push({
        kind: "from_storage",
        tables: [p.table.id],
        to: at(p.table),
        text: `New table ${n} (${p.table.seats}-top from storage) · → ${p.cand.label}`,
      });
      crew.push(`Bring a ${p.table.seats}-top from storage to the ${p.cand.label} (table ${n})`);
    }
    minutes += MOVE_MIN;
  }
  for (const j of joinChanges) {
    changes.push(j);
    crew.push(
      j.kind === "join"
        ? `Mark ${listAnd(j.tables.map((id) => `table ${tableNo(id)}`))} as joinable tonight (no move)`
        : `Keep ${listAnd(j.tables.map((id) => `table ${tableNo(id)}`))} apart tonight (no move)`,
    );
  }
  if (!changes.length) return fail();
  return {
    ok: true,
    edited: next,
    changes,
    crew,
    crewMinutes: minutes,
    rejects: [],
    notes,
  };
}

/** Table counts of each row (joined run of 2+) in one room, in floor order. */
export function rowSizes(room: Room, area: string): number[] {
  const ids = room.tables.filter((t) => t.area === area).map((t) => t.id);
  const left = new Set(ids);
  const out: number[] = [];
  for (const id of ids) {
    if (!left.has(id)) continue;
    const run = [id];
    left.delete(id);
    for (let i = 0; i < run.length; i++)
      for (const n of neighbours(room, run[i] as string))
        if (left.has(n)) {
          left.delete(n);
          run.push(n);
        }
    if (run.length > 1) out.push(run.length);
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dedupe<T extends { text: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}
