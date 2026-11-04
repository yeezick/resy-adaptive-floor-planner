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
    expect(storageSentence(stock, 2)).toBe(
      "Storage tonight: 4 of 6 spare tables free, 6 extenders, 40 chairs.",
    );
    expect(storageSentence(stock, 6)).toBe("No spare tables in storage tonight: 0 of 6.");
  });
});
