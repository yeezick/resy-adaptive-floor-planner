import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom, partyFits } from "../../domain";
import { checkRequest, parseRequestBook, SERVICE, toReservation } from "../../domain/requests";
import { localAnswer, notedLine, turnSentence } from "./chatReply";

const room = parseRoom(JSON.parse(readFileSync("fixtures/rooms/book-fri.json", "utf8")) as unknown);
const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const q2 = book.requests.find((r) => r.id === "Q2");
if (!q2) throw new Error("Q2 missing");
const fit = checkRequest(room, q2);
const cost = fit.ok
  ? (partyFits(
      { ...room, reservations: [...room.reservations, toReservation(q2)] },
      fit.plan.builds,
      SERVICE.from,
    ).find((f) => f.reservationId === q2.id) ?? null)
  : null;
const ctx = { room, request: q2, fit, cost };

describe("request chat answers from the capacity check", () => {
  it("names the triage needs first", () => {
    expect(notedLine(q2, cost)).toBe("Noted: wheelchair + stroller, aisle clearance kept.");
  });

  it("“a single table for all 22” gets a plain no and the nearest plan, outlined", () => {
    const a = localAnswer(
      "The guest may want a single table for all 22 guests. Where could we find the space?",
      ctx,
    );
    expect(a?.text).toBe(
      "No single room fits 22, even with tables from storage (closest: Garden Room, 20 seats). The nearest is the current plan: Garden Room + Library with the divider open.",
    );
    expect(a?.alt?.label).toBe("Nearest · Garden Room + Library");
  });

  it("“bring tables from the back” names storage, then the one-room answer", () => {
    const a = localAnswer("bring tables from the back if available", ctx);
    expect(a?.text).toMatch(
      /^Storage tonight: \d+ of 6 spare tables free, 6 extenders, 40 chairs\. No single room fits 22/,
    );
  });

  it("a need already set: “Already covered”, with the aisle", () => {
    const a = localAnswer("make sure there's room for the wheelchair", ctx);
    expect(a?.text).toMatch(
      /^Already covered: wheelchair \+ stroller, aisle \d+ in \(needs \d+ in\)\.$/,
    );
    expect(localAnswer("they no longer need the stroller space", ctx)).toBeNull();
  });

  it("everything else goes to the AI", () => {
    for (const m of ["headcount is now 26", "can we push it to 7pm?", "find space in tables 30–50"])
      expect(localAnswer(m, ctx)).toBeNull();
  });

  it("a model turn reads as a sentence that points at the proposal", () => {
    expect(
      turnSentence({ changed: ["tables 30–50"], outcome: "No capacity fit in tables 30–50." }),
    ).toBe(
      "I'd change tables 30–50 — see Proposed changes above. No capacity fit in tables 30–50.",
    );
    expect(turnSentence({ outcome: "Question: which night?" })).toBe("Question: which night?");
  });
});
