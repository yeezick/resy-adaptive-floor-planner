// Read-only agent tools over the pure room logic in src/domain. Nothing here mutates the room.
import type Anthropic from "@anthropic-ai/sdk";
import {
  checkCombine,
  estimateFreeTime,
  findTablesForParty,
  generateTonight,
  planBuilds,
  tableById,
  type Room,
  type Table,
} from "../../domain";
import {
  EstimateFreeTimeInput,
  FindTablesInput,
  GetRoomStateInput,
  PlanBuildsInput,
  ProposeCombineInput,
  TOOL_SPECS,
  toStrictJsonSchema,
} from "./schemas";

export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/** Tool definitions for the Messages API (strict JSON Schema from the Zod contracts). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOL_SPECS.map((t) => ({
    name: t.name,
    description: t.description,
    strict: true,
    input_schema: toStrictJsonSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

/** Compact room view for the model: no floor-plan geometry. */
export function compactRoom(room: Room) {
  return {
    clock: room.clock,
    areas: room.areas.map((a) => ({
      name: a.name,
      kind: a.kind,
      ...(a.suite ? { suite: a.suite, order: a.order } : {}),
      ...(a.spareSlots ? { spareSlots: a.spareSlots } : {}),
    })),
    tables: room.tables.map((t) => ({
      id: t.id,
      area: t.area,
      section: t.section,
      shape: t.shape,
      seats: t.seats,
      joinable: t.joinable,
      ...(t.maxExtraChairs ? { maxExtraChairs: t.maxExtraChairs } : {}),
      status: t.status,
      ...(t.phase ? { phase: t.phase } : {}),
      ...(t.partySize ? { partySize: t.partySize } : {}),
      ...(t.reservedAt ? { reservedAt: t.reservedAt } : {}),
      attrs: Object.entries(t.attrs)
        .filter(([, v]) => v)
        .map(([k]) => k),
    })),
    joins: room.joins,
    combos: room.combos,
    inventory: room.inventory,
    reservations: room.reservations,
  };
}

/** One placed party in the compact tonight proposal. */
export interface TonightParty {
  reservationId: string;
  time: string;
  partySize: number;
  area: string;
  /** Floor tables used (storage tables are counted in `storage`, not named here). */
  tables: string[];
  rows: string[][];
  seats: number;
  dividersOpened: string[];
  storage: { extenders: number; chairs: number; spareTables: number };
  buildWindow: { start: string; end: string; when: "set" | "rebuild"; tight: boolean } | null;
  reason: string;
}

/**
 * Tonight's layout for the agent, compact: per party the tables, rows, dividers, storage pulls, build window
 * and reason; the crew list; infeasible parties with plain-language reasons; and the summary. The full
 * one-day layout variant (geometry) is left out. Read-only: nothing is applied.
 */
export function tonightForAgent(room: Room, from: string, to: string) {
  const plan = planBuilds(room, from, to);
  const proposal = generateTonight(room, from, to);
  const crewBy = new Map(proposal.crew.map((c) => [c.reservationId, c]));
  const reasonBy = new Map(proposal.reasons.map((r) => [r.reservationId, r.text]));
  const parties: TonightParty[] = plan.builds.map((b) => {
    const c = crewBy.get(b.reservationId);
    return {
      reservationId: b.reservationId,
      time: b.time,
      partySize: b.partySize,
      area: b.area,
      tables: b.tables,
      rows: b.rows,
      seats: b.seats,
      dividersOpened: b.dividersOpened,
      storage: { extenders: b.extenders, chairs: b.extraChairs, spareTables: b.spareTables },
      buildWindow: c ? { start: c.start, end: c.end, when: c.when, tight: c.tight } : null,
      reason: reasonBy.get(b.reservationId) ?? "",
    };
  });
  return {
    clock: room.clock,
    window: proposal.window,
    parties,
    crew: proposal.crew.map((c) => ({
      start: c.start,
      end: c.end,
      reservationId: c.reservationId,
      when: c.when,
      tight: c.tight,
      actions: c.actions,
    })),
    infeasible: proposal.infeasible,
    summary: proposal.summary,
    applied: false,
  };
}

function issues(e: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return e.issues.map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`).join("; ");
}

/** Validates the input with Zod and runs the tool. Never throws: failures come back as typed errors. */
export function executeTool(room: Room, name: string, input: unknown): ToolOutcome {
  try {
    switch (name) {
      case "get_room_state": {
        const p = GetRoomStateInput.safeParse(input);
        if (!p.success) return { ok: false, error: `invalid input: ${issues(p.error)}` };
        return { ok: true, output: compactRoom(room) };
      }
      case "find_tables_for_party": {
        const p = FindTablesInput.safeParse(input);
        if (!p.success) return { ok: false, error: `invalid input: ${issues(p.error)}` };
        return { ok: true, output: findTablesForParty(room, p.data) };
      }
      case "estimate_free_time": {
        const p = EstimateFreeTimeInput.safeParse(input);
        if (!p.success) return { ok: false, error: `invalid input: ${issues(p.error)}` };
        const unknown = p.data.tableIds.filter((id) => !tableById(room, id));
        if (unknown.length) return { ok: false, error: `unknown table(s): ${unknown.join(", ")}` };
        return {
          ok: true,
          output: {
            clock: room.clock,
            tables: p.data.tableIds.map((id) => estimateFreeTime(tableById(room, id) as Table)),
          },
        };
      }
      case "propose_combine": {
        const p = ProposeCombineInput.safeParse(input);
        if (!p.success) return { ok: false, error: `invalid input: ${issues(p.error)}` };
        const check = checkCombine(room, p.data.tableIds);
        return {
          ok: true,
          output: check.ok
            ? { tableIds: p.data.tableIds, legal: true, seats: check.seats, applied: false }
            : { tableIds: p.data.tableIds, legal: false, reason: check.reason, applied: false },
        };
      }
      case "plan_builds": {
        const p = PlanBuildsInput.safeParse(input);
        if (!p.success) return { ok: false, error: `invalid input: ${issues(p.error)}` };
        return { ok: true, output: tonightForAgent(room, p.data.from, p.data.to) };
      }
      default:
        return { ok: false, error: `unknown tool "${name}"` };
    }
  } catch (e) {
    return { ok: false, error: `tool failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
