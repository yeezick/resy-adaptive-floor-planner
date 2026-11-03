// A small, fixed room for server and eval unit tests, so they do not depend on the (large, evolving) fixtures.
// Clock 19:10. Phases → minutes until free: entrees 45, appetizers 65, dessert 20, check 11.
import { parseRoom, type Room, type TableAttrs } from "../domain";

type Attr = keyof TableAttrs;
const attrs = (...on: Attr[]): TableAttrs => ({
  accessible: on.includes("accessible"),
  strollerSpace: on.includes("strollerSpace"),
  quiet: on.includes("quiet"),
  view: on.includes("view"),
  booth: on.includes("booth"),
});

let x = 0;
const t = (
  id: string,
  area: string,
  seats: number,
  status: "open" | "occupied" | "reserved" | "blocked",
  extra: Record<string, unknown> = {},
) => ({
  id,
  area,
  section: 1,
  x: (x += 5),
  y: 1,
  w: 4,
  h: 4,
  shape: "rect",
  seats,
  joinable: true,
  maxExtraChairs: 0,
  attrs: attrs(),
  status,
  ...extra,
});

export const TEST_ROOM: Room = parseRoom({
  id: "test-room",
  name: "Test room (fictional)",
  clock: "19:10",
  areas: [
    { id: "main", name: "Main dining", x: 0, y: 0, w: 100, h: 20 },
    { id: "patio", name: "Patio", x: 0, y: 30, w: 40, h: 20 },
    {
      id: "pa",
      name: "Private A",
      kind: "private",
      suite: "S",
      order: 1,
      x: 0,
      y: 60,
      w: 20,
      h: 10,
    },
    {
      id: "pb",
      name: "Private B",
      kind: "private",
      suite: "S",
      order: 2,
      x: 20,
      y: 60,
      w: 20,
      h: 10,
    },
  ],
  tables: [
    t("T1", "Main dining", 4, "occupied", {
      shape: "booth",
      joinable: false,
      phase: "entrees",
      attrs: attrs("booth", "quiet"),
    }),
    t("T5", "Main dining", 4, "reserved", { reservedAt: "19:30" }),
    t("T10", "Main dining", 4, "occupied", { phase: "check" }),
    t("T11", "Main dining", 4, "occupied", {
      phase: "entrees",
      maxExtraChairs: 1,
      attrs: attrs("accessible", "strollerSpace", "quiet"),
    }),
    t("T12", "Main dining", 4, "open", { maxExtraChairs: 1, attrs: attrs("accessible", "quiet") }),
    t("T21", "Main dining", 2, "occupied", { phase: "dessert" }),
    t("T22", "Main dining", 2, "open"),
    t("T28", "Patio", 4, "open", { attrs: attrs("accessible", "view") }),
    t("T29", "Patio", 4, "blocked"),
    t("T40", "Private A", 4, "open"),
    t("T41", "Private A", 4, "open"),
    t("T50", "Private B", 4, "open"),
    t("T51", "Private B", 4, "open"),
  ],
  joins: [
    ["T11", "T12"],
    ["T21", "T22"],
    ["T40", "T41"],
    ["T50", "T51"],
  ],
  combos: [],
  inventory: { extenders: 2, spareChairs: 1, spareTables: [] },
  reservations: [{ id: "R1", time: "20:00", partySize: 12, area: "Private A" }],
});
