import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom } from "../../domain";
import { walkInCheck } from "./WalkInReview";
import { shownTradeoff } from "../WalkIn/WalkInSheet";
import { applyCombine } from "../../domain";

const room = parseRoom(
  JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
);

describe("review screen capacity check", () => {
  it("the recorded #1 option fits 8 at table 41 with its own wait", () => {
    expect(walkInCheck(room, ["T41"], 8, [], 11)).toMatchObject({ ok: true, waitMin: 11 });
  });

  it("an edit re-runs it: 10 at table 41 is short", () => {
    const c = walkInCheck(room, ["T41"], 10, [], 11);
    expect(c.ok).toBe(false);
    expect(c.text).toMatch(/^short \d+ seat/);
  });

  it("a hand-picked table waits as long as its own slowest table", () => {
    const c = walkInCheck(room, ["T27"], 2, [], null);
    expect(c.waitMin).toBe(11);
  });

  it("a need the tables can't meet fails the check", () => {
    const c = walkInCheck(room, ["T41"], 8, ["booth"], 11);
    expect(c).toMatchObject({ ok: false });
    expect(c.text).toContain("booth");
  });
});

describe("walk-in sheet", () => {
  it("drops 'needs a build' once the option's tables are pushed together", () => {
    const o = { tables: ["T9", "T10"], tradeoffs: ["needs a build: combine tables 9 and 10"] };
    expect(shownTradeoff(room, o)).toBe("needs a build: combine tables 9 and 10");
    expect(shownTradeoff(applyCombine(room, ["T9", "T10"]), o)).toBe("");
  });
});
