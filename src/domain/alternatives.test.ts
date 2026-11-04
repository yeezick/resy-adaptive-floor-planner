import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom } from "./room";
import { parseRequestBook } from "./requests";
import { oneRoomPlan, oneRoomSentence, stockOf, storageSentence } from "./alternatives";

const room = parseRoom(JSON.parse(readFileSync("fixtures/rooms/book-fri.json", "utf8")) as unknown);
const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const q2 = book.requests.find((r) => r.id === "Q2");
if (!q2) throw new Error("Q2 missing");

describe("one room for the 22-top, with storage", () => {
  it("no single room seats 22 on Friday, even with storage; the closest room is named", () => {
    const plan = oneRoomPlan(room, q2);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.largest).toEqual({ area: "Garden Room", seats: 20 });
    expect(oneRoomSentence(q2, plan, { area: "Garden Room + Library" })).toBe(
      "No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats). The nearest is the current plan: Garden Room + Library with the divider open.",
    );
  });

  it("a party one room can seat gets that room's tables", () => {
    const plan = oneRoomPlan(room, { ...q2, partySize: 12 });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.build.area).toBe(plan.area);
  });

  it("names what storage has, or says plainly there are no spare tables", () => {
    const stock = stockOf(room);
    expect(stock).toEqual({ spareTables: 6, extenders: 6, chairs: 40 });
    expect(storageSentence(stock, { spareTables: 2, extenders: 1, extraChairs: 8 })).toBe(
      "Storage tonight: 4 of 6 spare tables free, 5 of 6 extenders, 32 of 40 chairs.",
    );
    expect(storageSentence(stock, { spareTables: 6, extenders: 0, extraChairs: 0 })).toBe(
      "No spare tables in storage tonight: 0 of 6.",
    );
  });

  it("words the other cases: a room that works, no closest room, rooms not free then", () => {
    const ok = oneRoomPlan(room, { ...q2, partySize: 12 });
    expect(oneRoomSentence({ partySize: 12 }, ok, null)).toBe(
      "One room works: tables 63–66 in the Library with 2 chairs from storage, seats 12. It's shown on the floor; ask to switch and I'll propose it.",
    );
    expect(oneRoomSentence({ partySize: 40 }, { ok: false, largest: null, busy: [] }, null)).toBe(
      "No single room fits 40, even with tables from storage.",
    );
    expect(
      oneRoomSentence(
        { partySize: 22 },
        { ok: false, largest: { area: "Garden Room", seats: 20 }, busy: ["Cellar"] },
        null,
      ),
    ).toBe(
      "No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats). Cellar isn't free at that time.",
    );
  });
});
