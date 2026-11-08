import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom } from "../../domain";
import walkin from "../../../fixtures/scenarios/walkin-8-peak.json";
import {
  actionLabel,
  actionSentence,
  fixCopy,
  needsBuild,
  needsFromMessage,
  reasonTag,
  resolveOption,
} from "./options";

const room = parseRoom(
  JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
);
const recs = walkin.response.recommendations;

describe("AI Planner option cards", () => {
  it("tags each recorded option by rule: Fastest, then the section's trait", () => {
    expect(recs.map((r) => reasonTag(room, r, recs))).toEqual([
      "Fastest",
      "Quiet section",
      "Quiet section",
    ]);
  });

  it("T44: with {41 ~11, 39+40 ~80} only table 41 is Fastest", () => {
    const asked = { rank: 1, tables: ["T39", "T40"], seats: 8, waitMin: 80 };
    const quick = { rank: 2, tables: ["T41"], seats: 8, waitMin: 11 };
    const cards = [asked, quick];
    expect(reasonTag(room, quick, cards)).toBe("Fastest");
    expect(reasonTag(room, asked, cards)).not.toBe("Fastest");
  });

  it("a lone card is never Fastest, even when it is the quickest (falls through to the other rules)", () => {
    const asked = { rank: 1, tables: ["T39", "T40"], seats: 8, waitMin: 80 };
    expect(reasonTag(room, asked, [asked])).not.toBe("Fastest");
    const t41 = { rank: 1, tables: ["T41"], seats: 8, waitMin: 11 };
    expect(reasonTag(room, t41, [t41])).toBe("No build");
  });

  it("no Fastest when every card waits the same", () => {
    const a = { rank: 1, tables: ["T7", "T8", "T9", "T10"], seats: 8, waitMin: 20 };
    const b = { rank: 2, tables: ["T11", "T12"], seats: 8, waitMin: 20 };
    expect([a, b].map((r) => reasonTag(room, r, [a, b]))).not.toContain("Fastest");
  });

  it("“the fastest one” still picks the shortest-wait card, even a lone one", () => {
    const asked = { rank: 1, tables: ["T39", "T40"], seats: 8, waitMin: 80 };
    expect(resolveOption("the fastest one", [asked])).toEqual({
      kind: "one",
      rank: 1,
      why: "fastest",
    });
  });

  it("a single table needs no build; a join does", () => {
    expect(needsBuild(room, { tables: ["T41"] })).toBe(false);
    expect(needsBuild(room, { tables: ["T7", "T8", "T9", "T10"] })).toBe(true);
    const noBuild = { rank: 2, tables: ["T29"], seats: 4, waitMin: 30 };
    expect(reasonTag(room, noBuild, [...recs.slice(0, 1), noBuild])).toBe("No build");
  });

  it("one verb per card: Seat when free now, else Waitlist with the quote", () => {
    expect(actionLabel({ tables: ["T41"], waitMin: 11 })).toBe("Waitlist · ~11 min");
    expect(actionLabel({ tables: ["T29"], waitMin: 0 })).toBe("Seat at table 29");
    expect(actionSentence({ tables: ["T41"], waitMin: 11 }, 8)).toBe(
      "Waitlist party of 8 · table 41 · ~11 min",
    );
  });
});

describe("the chat reads which option the host means", () => {
  it.each([
    ["go ahead with option 1", 1],
    ["#2", 2],
    ["the first one", 1],
    ["take the second option", 2],
    ["the fastest one", 1],
    ["table 41", 1],
    ["seat them at tables 11 and 12", 3],
  ])("%s → #%i", (msg, rank) => {
    expect(resolveOption(msg, recs)).toMatchObject({ kind: "one", rank });
  });

  it("asks when the words fit more than one option", () => {
    expect(resolveOption("put them on the waitlist", recs)).toEqual({
      kind: "many",
      ranks: [1, 2, 3],
    });
    expect(resolveOption("option 7", recs)).toMatchObject({ kind: "many" });
    expect(resolveOption("go ahead", recs)).toMatchObject({ kind: "many" });
    expect(resolveOption("go ahead", recs, 2)).toMatchObject({ kind: "one", rank: 2 });
  });

  it("leaves everything else to the AI Planner (questions, combines it should refuse)", () => {
    for (const msg of [
      "combine tables 1 and 4 in section 2, rotate them parallel to the left wall",
      "where could a party of 6 go?",
      "how long for a booth?",
    ])
      expect(resolveOption(msg, recs)).toEqual({ kind: "none" });
    expect(resolveOption("option 1", [])).toEqual({ kind: "none" });
    for (const msg of [
      "should I go ahead and combine 41 and 42?",
      "table 41 is too loud",
      "not table 41",
      "go ahead with option 1 but only if the booth frees up before the next seating",
      "why option 2?",
    ])
      expect(resolveOption(msg, recs), msg).toEqual({ kind: "none" });
  });

  it("pre-fills needs named in the message; fixes 'any combine'", () => {
    expect(needsFromMessage("party of 6, one in a wheelchair and a stroller")).toEqual([
      "accessible",
      "stroller",
    ]);
    expect(fixCopy("seat them and make any combine")).toBe("seat them and make any combination");
  });
});
