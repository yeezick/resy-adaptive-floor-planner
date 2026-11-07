// What one validated chat answer does, decided by code (the app and the evals run this same function):
// answered from plan state ("Already open in this plan: …"), the plain one-room closest, a rejected floor change
// with every reason, or a proposal (constraints, plus a floor change checked by the engine). Pure, no model.
import { oneRoomPlan, oneRoomSentence } from "./alternatives";
import { proposeLayoutEdit, type FloorChange, type LayoutOp } from "./layoutOps";
import {
  adjusted,
  changeDelta,
  checkAdjusted,
  mergeTurn,
  type ChatConstraints,
  type ChatTurnOutput,
} from "./requestChat";
import type { GuestRequest } from "./requests";
import type { Room } from "./types";

export interface FloorEditCore {
  ops: LayoutOp[];
  edited: Room;
  changes: FloorChange[];
  crew: string[];
  crewMinutes: number;
}

export type TurnResult =
  /** Answered by code with no proposal (plan state, the one-room closest, a rejected floor change). */
  | { kind: "answer"; text: string }
  | {
      kind: "proposal";
      constraints: ChatConstraints;
      /** A NEW floor change from this turn (a pending one is carried by the caller). */
      floor?: FloorEditCore;
      /** What the turn changed, for the reply ("the floor (5 changes)", "party of 26"). */
      changed: string[];
      /**
       * Said before the change, when the turn also asked a question code answers (G3 "Already open in this
       * plan: …", G4b the one-room answer), worked out for the changed request.
       */
      lead?: string;
    };

export interface TurnInputs {
  /** The request's night as it stands (layout in use + the night's book). */
  room: Room;
  /** Rooms and tables of the request's current plan. */
  planArea: string | null;
  planTables: readonly string[];
  nameOf?: (id: string) => string;
}

/** "The Garden Room" → "garden room" (how the rooms asked for are compared with the plan's). */
const roomWord = (x: string) =>
  x
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "");

/** Decide what a validated answer does, on top of the request's latest constraints. */
export function resolveTurn(
  r: GuestRequest,
  latest: ChatConstraints,
  out: ChatTurnOutput,
  ctx: TurnInputs,
): TurnResult {
  const next = mergeTurn(latest, out);
  // what the turn changes besides the rooms it asks about ("headcount is now 24, keep them in one room"):
  // an early answer below keeps it and proposes it, never drops it (T37)
  const rest = mergeTurn(latest, { ...out, rooms: [], oneRoom: "unchanged" });
  const restChanged = changeDelta(r, latest, rest);
  // the rooms asked for are the ones the plan already opens (G3)
  // ("no" = rooms may open into each other, which they already do)
  if (!out.ops.length && out.rooms.length && out.oneRoom !== "yes" && ctx.planArea) {
    const asked = new Set(out.rooms.map(roomWord));
    const sameRooms = (area: string) => {
      const plan = area.split(" + ");
      return plan.length === asked.size && plan.every((a) => asked.has(roomWord(a)));
    };
    if (sameRooms(ctx.planArea)) {
      const lead = `Already open in this plan: ${ctx.planArea}.`;
      if (!restChanged.length) return { kind: "answer", text: lead };
      // the asked rooms are not stored, so the changed party re-plans freely: say "already open" only when it
      // still uses exactly those rooms; otherwise keep the rooms as a constraint in the same proposal
      const free = mergeTurn(latest, { ...out, rooms: [] });
      const replanned = checkAdjusted(ctx.room, r, free).fit;
      if (replanned.ok && sameRooms(replanned.build.area))
        return { kind: "proposal", constraints: free, changed: restChanged, lead };
      return { kind: "proposal", constraints: next, changed: changeDelta(r, latest, next) };
    }
  }
  // "close the divider" with no floor change: when no single room fits, the plain closest + the offer (G4b)
  if (!out.ops.length && out.oneRoom === "yes" && !checkAdjusted(ctx.room, r, next).fit.ok) {
    if (!restChanged.length) {
      const req = adjusted(r, latest);
      return { kind: "answer", text: oneRoomSentence(req, oneRoomPlan(ctx.room, req)) };
    }
    // the one-room answer for the changed party first, then the change itself (one room stays as it was)
    const req = adjusted(r, rest);
    return {
      kind: "proposal",
      constraints: rest,
      changed: restChanged,
      lead: oneRoomSentence(req, oneRoomPlan(ctx.room, req)),
    };
  }
  let floor: FloorEditCore | undefined;
  if (out.ops.length) {
    const e = proposeLayoutEdit(ctx.room, out.ops, { nameOf: ctx.nameOf, near: ctx.planTables });
    if (!e.ok || !e.edited) {
      // rejected as a whole: every reason, one plain line each; a question back stays a question (R1)
      const lines = [...e.rejects.map((x) => x.text), ...e.notes];
      const question = lines.length === 1 && lines[0]?.endsWith("?");
      return {
        kind: "answer",
        text: question ? (lines[0] as string) : `${lines.join(" ")} Nothing changed.`,
      };
    }
    floor = {
      ops: out.ops,
      edited: e.edited,
      changes: e.changes,
      crew: e.crew,
      crewMinutes: e.crewMinutes,
    };
  }
  const changed = changeDelta(r, latest, next);
  if (floor)
    changed.unshift(
      `the floor (${floor.changes.length} change${floor.changes.length === 1 ? "" : "s"})`,
    );
  return { kind: "proposal", constraints: next, ...(floor ? { floor } : {}), changed };
}
