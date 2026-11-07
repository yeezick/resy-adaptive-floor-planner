import { describe, expect, it } from "vitest";
import friJson from "../../../fixtures/rooms/book-fri.json";
import { proposeLayoutEdit, type LayoutOp, type TableRef } from "../../domain/layoutOps";
import { parseRoom } from "../../domain/room";
import { roomTabs, tabForChange } from "./geometry";

const room = parseRoom(friJson);
const ref = (p: Partial<TableRef>): TableRef => ({
  by: "number",
  n: 0,
  from: 0,
  to: 0,
  shape: "any",
  seats: 0,
  room: "",
  ...p,
});
const op = (p: Partial<LayoutOp>): LayoutOp => ({
  op: "move",
  tables: [],
  to: "",
  seats: 0,
  count: 0,
  rows: [],
  ...p,
});
const tabOf = (ops: LayoutOp[]) => {
  const e = proposeLayoutEdit(room, ops);
  if (!e.ok || !e.edited) throw new Error(e.rejects.map((r) => r.text).join(" "));
  const id = tabForChange(e.edited, e.changes);
  return roomTabs(e.edited).find((t) => t.id === id)?.label ?? id;
};

describe("tabForChange (T35): the floor opens on the tab with the proposed change", () => {
  it("a swap inside the Library opens its suite, not the Dining room", () => {
    expect(tabOf([op({ op: "swap", tables: [ref({ n: 68 }), ref({ n: 69 })] })])).toBe(
      "East suite",
    );
  });
  it("a set-aside table counts by the area it leaves; new tables from storage where they land", () => {
    expect(
      tabOf([
        op({ op: "to_storage", tables: [ref({ n: 62 })] }),
        op({ op: "from_storage", seats: 4, count: 2, to: "Library" }),
      ]),
    ).toBe("East suite");
  });
  it("a move between the Garden Room and the Library stays on their suite", () => {
    expect(
      tabOf([op({ tables: [ref({ by: "range", from: 63, to: 66 })], to: "Garden Room" })]),
    ).toBe("East suite");
  });
});
