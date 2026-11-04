import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRequest, parseRequestBook, parseRoom } from "../domain";
import { heldCount } from "./ConsoleBar";

const room = parseRoom(JSON.parse(readFileSync("fixtures/rooms/book-fri.json", "utf8")) as unknown);
const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);

describe("console Held", () => {
  it("is 0 on the Friday book before any request is accepted", () => {
    expect(heldCount(room, { book, decisions: {} })).toBe(0);
  });

  it("counts the tables an accepted plan holds for the night on screen", () => {
    const q2 = book.requests.find((r) => r.id === "Q2");
    const fit = q2 ? checkRequest(room, q2) : null;
    if (!fit?.ok) throw new Error("Q2 should fit on Friday");
    const decisions = {
      Q2: { kind: "accepted" as const, at: "Tue 10:41", iso: "x", tables: fit.build.tables },
      // accepted for another night: not held here
      Q3: { kind: "accepted" as const, at: "Tue 10:41", iso: "x", tables: ["T1"] },
    };
    expect(heldCount(room, { book, decisions })).toBe(fit.build.tables.length);
  });
});
