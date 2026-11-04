// Impacts of saying yes to a large party, as pros and cons a manager can scan. Built from the solver's capacity
// fit and its cost (never from a model). Estimates say "est.".
import type { PartyFit } from "./fit";
import { sectionLoad } from "./phases";
import type { Room } from "./types";
import { tableNumbers } from "./wording";

export interface Impacts {
  pros: string[];
  cons: string[];
}

export interface ImpactsInput {
  fit: PartyFit;
  /** The party's needs: the aisle is a pro only when they asked for wheelchair or stroller access. */
  needs: readonly string[];
  /** Large parties already planned for the night whose tables change (from the capacity fit). */
  moved: readonly string[];
  /** The same moves, named for the card ("Moves …"); when given they replace the count line. */
  movedDetail?: readonly string[];
}

/** Pros: covers in one booking, nothing moved, aisle clear (when asked). Cons: hold, covers lost, section load. */
export function impactsOf(
  room: Room,
  { fit: f, needs, moved, movedDetail = [] }: ImpactsInput,
): Impacts {
  const pros: string[] = [`+${f.partySize} covers in one booking`];
  const cons: string[] = [];

  if (moved.length === 0) pros.push("No reservations moved");
  else if (movedDetail.length) cons.push(...movedDetail);
  else
    cons.push(
      `${moved.length} other large ${moved.length === 1 ? "party moves" : "parties move"} to other tables`,
    );

  const who = [
    needs.includes("accessible") ? "a wheelchair" : null,
    needs.includes("stroller") ? "a stroller" : null,
  ].filter((x): x is string => x !== null);
  const a = f.aisle;
  if (a.minIn !== null && a.checked.length > 0 && !a.ok)
    cons.push(`Aisle too narrow at a join: ${a.narrowestIn} in (needs ${a.minIn} in)`);
  else if (who.length && a.minIn !== null)
    pros.push(
      a.checked.length === 0
        ? `Aisle clear for ${who.join(" and ")} (no joins narrow it)`
        : `Aisle clear for ${who.join(" and ")} (narrowest ${a.narrowestIn} in, needs ${a.minIn} in)`,
    );

  if (f.hold.tables.length) {
    cons.push(
      f.hold.runs.length > 1
        ? `Tables held until ${f.hold.until}: ${f.hold.runs.map((r) => `${tableNumbers(r.tables)} from ${r.from}`).join(", ")}`
        : `Tables held ${f.hold.from}–${f.hold.until}`,
    );
    cons.push(`~${f.hold.coversLost} covers lost over one turn (est.)`);
  } else pros.push("Spare tables from storage only: nothing on the floor is held");

  if (f.spansSections)
    cons.push(`Sections ${f.sections.join(" + ")} both take on the party (spans two servers)`);
  else if (f.sections.length === 1) {
    const s = f.sections[0] as number;
    const busy = sectionLoad(room, s);
    cons.push(
      `Section ${s}'s load rises: +${f.partySize} covers on one server${
        busy ? ` (${busy} ${busy === 1 ? "table" : "tables"} there just sat)` : ""
      }`,
    );
  }
  return { pros, cons };
}
