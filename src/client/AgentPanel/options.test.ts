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
  });

  it("leaves everything else to the AI Planner (questions, combines it should refuse)", () => {
    for (const msg of [
      "combine tables 1 and 4 in section 2, rotate them parallel to the left wall",
      "where could a party of 6 go?",
      "how long for a booth?",
    ])
      expect(resolveOption(msg, recs)).toEqual({ kind: "none" });
    expect(resolveOption("option 1", [])).toEqual({ kind: "none" });
  });

  it("pre-fills needs named in the message; fixes 'any combine'", () => {
    expect(needsFromMessage("party of 6, one in a wheelchair and a stroller")).toEqual([
      "accessible",
      "stroller",
    ]);
    expect(fixCopy("seat them and make any combine")).toBe("seat them and make any combination");
  });
});
