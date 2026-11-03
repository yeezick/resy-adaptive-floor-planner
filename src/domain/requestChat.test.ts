import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import bookFriJson from "../../fixtures/rooms/book-fri.json";
import { planBuilds } from "./buildplan";
import {
  baseConstraints,
  changeDelta,
  changeList,
  chatTurnProblems,
  checkAdjusted,
  mergeTurn,
  tablesInRange,
  timesIn,
  type ChatTurnOutput,
} from "./requestChat";
import { parseRequestBook, type GuestRequest } from "./requests";
import { parseRoom } from "./room";

const book = parseRequestBook(JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")));
const q2 = book.requests.find((r) => r.id === "Q2") as GuestRequest;
const fri = () => parseRoom(structuredClone(bookFriJson));
const none: ChatTurnOutput = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
};

describe("chatTurnProblems (solver-first)", () => {
  it("accepts numbers the manager typed", () => {
    expect(
      chatTurnProblems({ ...none, tableRange: { from: 30, to: 50 } }, "between tables 30–50"),
    ).toEqual([]);
    expect(chatTurnProblems({ ...none, time: "19:00" }, "push it to 7pm")).toEqual([]);
    expect(chatTurnProblems({ ...none, time: "19:00" }, "can we push it to 19:00?")).toEqual([]);
  });

  it("rejects invented numbers, table names, booking claims and empty answers", () => {
    expect(chatTurnProblems({ ...none, partySize: 24 }, "two more people")).toContain(
      "headcount isn't a number from the message",
    );
    expect(chatTurnProblems({ ...none, tableRange: { from: 50, to: 30 } }, "50 to 30")).toContain(
      "table range runs backwards",
    );
    expect(chatTurnProblems({ ...none, notes: ["by table 41"] }, "near the window")).toContain(
      "names a table",
    );
    expect(chatTurnProblems({ ...none, clarify: "Sure, T41?" }, "x")).toContain("names a table");
    expect(chatTurnProblems({ ...none, time: "16:00" }, "at 16:00")).toContain(
      "time is outside service (17:00–22:00)",
    );
    expect(chatTurnProblems({ ...none, clarify: "It's confirmed." }, "x")).toHaveLength(1);
    expect(chatTurnProblems(none, "hmm")).toEqual(["no change and no question"]);
  });
});

describe("mergeTurn and changeList", () => {
  it("layers turns and lists what changed versus the guest's request", () => {
    let c = baseConstraints(q2);
    c = mergeTurn(c, { ...none, tableRange: { from: 30, to: 50 } });
    c = mergeTurn(c, { ...none, partySize: 26, addNeeds: ["quiet"], notes: ["high chair"] });
    c = mergeTurn(c, { ...none, removeNeeds: ["stroller"], notes: ["High chair"] });
    expect(c).toEqual({
      tableRange: { from: 30, to: 50 },
      partySize: 26,
      time: null,
      needs: ["accessible", "quiet"],
      notes: ["high chair"],
    });
    expect(changeList(q2, c)).toEqual([
      "tables 30–50",
      "party of 26",
      "needs quiet",
      "no longer stroller",
      "high chair",
    ]);
  });
});

describe("checkAdjusted (the planner re-runs)", () => {
  it("keeps the party inside the manager's table range, or says so in one line with the closest option", () => {
    const room = fri();
    const inRange = new Set(tablesInRange(room, { from: 30, to: 50 }));
    expect(inRange.size).toBeGreaterThan(0);
    for (const id of inRange) expect(Number(id.slice(1))).toBeGreaterThanOrEqual(30);
    const c = { ...baseConstraints(q2), tableRange: { from: 30, to: 50 } };
    const a = checkAdjusted(room, q2, c);
    if (a.fit.ok) expect(a.fit.build.tables.every((t) => inRange.has(t))).toBe(true);
    else {
      expect(a.line).toMatch(/^No capacity fit in tables 30–50 for 22 at 18:30\./);
      expect(a.line).toMatch(/Closest: tables .*, outside tables 30–50\.$/);
    }
    expect(a.line).not.toMatch(/\bT\d/);
  });

  it("re-plans for a new headcount and time", () => {
    const a = checkAdjusted(fri(), q2, { ...baseConstraints(q2), partySize: 26, time: "19:00" });
    expect(a.request).toMatchObject({ partySize: 26, time: "19:00" });
    expect(a.fit.ok).toBe(true);
    if (a.fit.ok) expect(a.fit.build.partySize).toBe(26);
  });

  it("limits only the request, never the other bookings", () => {
    const room = fri();
    const all = planBuilds(room, "17:00", "22:00");
    const first = all.builds[0];
    expect(first).toBeDefined();
    if (!first) return;
    // its own tables: same plan; no tables at all: only that party drops out
    const own = planBuilds(room, "17:00", "22:00", {
      onlyTables: { [first.reservationId]: first.tables },
    });
    expect(own.builds.find((b) => b.reservationId === first.reservationId)?.tables).toEqual(
      first.tables,
    );
    const none = planBuilds(room, "17:00", "22:00", { onlyTables: { [first.reservationId]: [] } });
    expect(none.builds.map((b) => b.reservationId)).not.toContain(first.reservationId);
    expect(none.unplaced.map((u) => u.reservationId)).toEqual([first.reservationId]);
  });
});

describe("timesIn (a time must be written as a time)", () => {
  it("reads clock times and ignores other numbers", () => {
    const has = (t: string, hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number) as [number, number];
      return timesIn(t).has(h * 60 + m);
    };
    expect(has("can we push it to 19:00?", "19:00")).toBe(true);
    expect(has("push it to 7:30pm", "19:30")).toBe(true);
    expect(has("7pm works", "19:00")).toBe(true);
    expect(has("push it to 1900", "19:00")).toBe(true);
    expect(has("move it to 19", "19:00")).toBe(true);
    expect(has("push it to 19", "19:45")).toBe(false);
    expect(has("party of 7 now", "19:00")).toBe(false);
    expect(chatTurnProblems({ ...none, time: "19:00" }, "party of 7 now")).toContain(
      "time isn't one the manager typed",
    );
  });

  it("doesn't read a headcount as a time", () => {
    expect(chatTurnProblems({ ...none, time: "20:00" }, "make it 20 people")).toContain(
      "time isn't one the manager typed",
    );
    expect(chatTurnProblems({ ...none, time: "22:00" }, "party of 22, can it go later?")).toContain(
      "time isn't one the manager typed",
    );
    expect(
      chatTurnProblems({ ...none, time: "20:00" }, "can we do a table for 8 instead"),
    ).toContain("time isn't one the manager typed");
    expect(chatTurnProblems({ ...none, time: "20:00" }, "seat up to 8")).toContain(
      "time isn't one the manager typed",
    );
  });
});

describe("changeDelta", () => {
  it("lists only what one turn changed", () => {
    const before = { ...baseConstraints(q2), tableRange: { from: 30, to: 50 } };
    const after = mergeTurn(before, { ...none, partySize: 26 });
    expect(changeDelta(q2, before, after)).toEqual(["party of 26"]);
  });
});
