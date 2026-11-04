import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRequest, parseRequestBook, parseRoom, toReservation } from "../../domain";
import { planHolds } from "./holds";
import { setPhase } from "./service";

const fri = parseRoom(JSON.parse(readFileSync("fixtures/rooms/book-fri.json", "utf8")) as unknown);
const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const q2 = book.requests.find((r) => r.id === "Q2");

describe("plan holds", () => {
  it("an accepted plan holds its tables with the party and window; nothing is blocked", () => {
    if (!q2) throw new Error("Q2 missing");
    const fit = checkRequest(fri, q2);
    if (!fit.ok) throw new Error("Q2 should fit");
    const room = { ...fri, reservations: [...fri.reservations, toReservation(q2)] };
    const holds = planHolds(room, {
      book,
      decisions: { Q2: { kind: "accepted", at: "", iso: "", tables: fit.build.tables } },
    });
    expect(holds.size).toBe(fit.build.tables.length);
    expect(holds.get(fit.build.tables[0] as string)).toEqual({
      name: "Whitaker",
      partySize: 22,
      from: "17:00",
      until: "18:30",
    });
    expect(room.tables.some((t) => t.status === "blocked")).toBe(false);
  });

  it("nothing accepted, nothing held", () => {
    expect(planHolds(fri, { book, decisions: {} }).size).toBe(0);
  });
});

describe("manual meal phase", () => {
  it("sets only seated tables", () => {
    const peak = parseRoom(
      JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
    );
    const seated = peak.tables.find((t) => t.status === "occupied");
    const open = peak.tables.find((t) => t.status === "open");
    const next = setPhase(peak, [seated?.id ?? "", open?.id ?? ""], "check");
    expect(next.tables.find((t) => t.id === seated?.id)?.phase).toBe("check");
    expect(next.tables.find((t) => t.id === open?.id)?.phase).toBeUndefined();
  });
});
