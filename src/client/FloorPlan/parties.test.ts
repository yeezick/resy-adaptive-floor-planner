import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom, type Room } from "../../domain";
import { checkRequest, parseRequestBook } from "../../domain/requests";
import { areaLabelY } from "./FloorAreas";
import { partiesOnTables } from "./parties";

const room = (id: string): Room =>
  parseRoom(JSON.parse(readFileSync(`fixtures/rooms/${id}.json`, "utf8")) as unknown);
const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);

describe("party size on each table", () => {
  it("the 22-top's nine tables read 22 and Oduya's new tables read 12 (Friday, Whitaker outlined)", () => {
    const fri = room("book-fri");
    const q2 = book.requests.find((r) => r.id === "Q2");
    if (!q2) throw new Error("Q2 missing");
    const fit = checkRequest(fri, q2);
    if (!fit.ok) throw new Error("Q2 should fit");
    const parties = partiesOnTables(fri, fit.plan.builds);
    for (const id of ["T57", "T58", "T59", "T60", "T61", "T63", "T64", "T65", "T66"])
      expect(parties.get(id)).toBe(22);
    for (const id of ["T77", "T78", "T79", "T80"]) expect(parties.get(id)).toBe(12);
  });

  it("a seated party wins; a held plan beats the build plan; a table with no party has no entry", () => {
    const peak = room("dinner-peak");
    const seated = peak.tables.find((t) => t.status === "occupied" && t.partySize);
    const open = peak.tables.find((t) => t.status === "open");
    if (!seated || !open) throw new Error("fixture changed");
    const parties = partiesOnTables(
      peak,
      [
        { partySize: 9, buildBy: "18:00", tables: [seated.id, open.id] },
        { partySize: 5, buildBy: "20:00", tables: [open.id, "T999"] },
      ],
      new Map([[open.id, { partySize: 22 }]]),
    );
    expect(parties.get(seated.id)).toBe(seated.partySize);
    expect(parties.get(open.id)).toBe(22);
    expect(parties.has("T999")).toBe(false);
    const free = peak.tables.find((t) => t.status === "open" && t.id !== open.id);
    if (free) expect(parties.has(free.id)).toBe(false);
  });

  it("the earliest party on a table that hosts two tonight", () => {
    const fri = room("book-fri");
    const parties = partiesOnTables(fri, [
      { partySize: 24, buildBy: "20:30", tables: ["T57"] },
      { partySize: 22, buildBy: "18:00", tables: ["T57"] },
    ]);
    expect(parties.get("T57")).toBe(22);
  });
});

describe("room names never cut off at the edge of the view", () => {
  const area = {
    id: "terrace",
    name: "Terrace",
    kind: "dining" as const,
    x: 0,
    y: 50,
    w: 40,
    h: 20,
  };
  const caption = 1.2;
  it("above the room when it fits", () => {
    expect(areaLabelY({ ...area, spareSlots: 0 }, caption, { x: 0, y: 0, w: 60, h: 80 })).toBe(
      49.4,
    );
  });
  it("left out when the room only peeks in at the bottom edge (Terrace under table 27)", () => {
    expect(
      areaLabelY({ ...area, spareSlots: 0 }, caption, { x: 0, y: 0, w: 60, h: 49.6 }),
    ).toBeNull();
  });
  it("inside the room's top edge when the space above is off screen", () => {
    const y = areaLabelY({ ...area, spareSlots: 0 }, caption, { x: 0, y: 49.5, w: 60, h: 30 });
    expect(y).not.toBeNull();
    expect(y as number).toBeGreaterThan(50);
  });
});
