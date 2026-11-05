import { describe, expect, it } from "vitest";
import type { GuestRequest } from "../../domain/requests";
import { AgentRequest } from "../../shared/api";
import { partyName } from "../lib/names";
import {
  FLOOR_EDIT_ANSWER,
  isFloorEdit,
  openRequestBriefs,
  partyForMessage,
  partyInMessage,
  plannerText,
} from "./screen";

describe("floor-edit asks are answered on the device", () => {
  it("the answer is the fixed sentence", () => {
    expect(FLOOR_EDIT_ANSWER).toBe(
      "Floor changes are made in Shift setup or a request's Discuss chat — nothing changed.",
    );
  });

  it.each([
    // T19 and T20, verbatim
    "Move table 56 into the Library and move tables 63-66 into the Garden Room so the 22-top is in one room",
    "join tables 39 and 40 for them and add 2 chairs from the back",
    "swap 41 and 42",
    "pull 7 and 8 together",
    "push tables 11 and 12 together",
    "put table 56 in the Library",
    "take table 81 out",
    "bring two tables from storage",
    "bring out 2 more chairs",
    "add 2 chairs to table 41",
    "remove T12",
    "split table 41",
    "combine 11 and 12",
    "move the Library tables to the Terrace",
    "open the divider",
    "close the partition between the rooms",
    "open the rooms between Library and Garden Room",
    "Open up the Terrace",
  ])("catches %j", (text) => {
    expect(isFloorEdit(text)).toBe(true);
  });

  it.each([
    "seat them at 41",
    "they're 10 now and want the Terrace",
    "Party of 8 just walked in — where, and how soon?",
    "A party of 4 just walked in. Where can they sit, and how soon?",
    "option 1",
    "table 41",
    "go ahead with the fastest one",
    "can we put them at table 41?",
    "move them to the Terrace",
    "add 2 more people to the party",
    "they want to add 2 guests",
    "push the 8:30 back to 9",
    "when does table 41 open up?",
    "is the Library open tonight?",
    "take a seat at the bar while they wait",
    "they'd like something close to the window",
    "how many tables are open?",
    "where should we build for tonight's large parties?",
  ])("leaves %j to the model", (text) => {
    expect(isFloorEdit(text)).toBe(false);
  });
});

describe("party size from the screen", () => {
  it("reads the message, a corrected headcount, or nothing", () => {
    expect(partyInMessage("Party of 8 just walked in")).toBe(8);
    expect(partyInMessage("they're 10 now and want the Terrace")).toBe(10);
    expect(partyInMessage("now 6, two left")).toBe(6);
    expect(partyInMessage("where can they go?")).toBeUndefined();
    expect(partyInMessage("push the 8:30 back")).toBeUndefined();
  });

  it("message, then the thread's latest stated size, then the walk-in form / open request", () => {
    expect(partyForMessage("party of 4", ["party of 8"], 22)).toBe(4);
    expect(partyForMessage("where can they go?", ["party of 8", "they're 10 now"], 22)).toBe(10);
    expect(partyForMessage("where can they go?", ["hi"], 22)).toBe(22);
    expect(partyForMessage("where can they go?", [], undefined)).toBeUndefined();
  });

  it("the request body carries it (schema)", () => {
    const body = AgentRequest.parse({ roomId: "dinner-peak", message: "hi", partySize: 8 });
    expect(body.partySize).toBe(8);
    expect(AgentRequest.safeParse({ roomId: "x", message: "hi", partySize: 0 }).success).toBe(
      false,
    );
  });
});

describe("open requests", () => {
  const req = (over: Partial<GuestRequest>): GuestRequest => ({
    id: "Q2",
    source: "app",
    receivedAt: "Wed 14:00",
    day: "Fri",
    bookRoomId: "book-fri",
    time: "21:00",
    partySize: 22,
    needs: ["accessible"],
    privateRoom: false,
    contact: "Sam Whitaker",
    message: "A birthday dinner for 22, please.",
    ...over,
  });

  it("go to the AI Planner by guest name, never by id", () => {
    const briefs = openRequestBriefs([req({}), req({ id: "Q7", contact: "free dinner" })]);
    expect(briefs).toEqual([
      { name: "Whitaker", partySize: 22, time: "21:00", needs: ["accessible"] },
      { name: "free dinner", partySize: 22, time: "21:00", needs: ["accessible"] },
    ]);
    expect(JSON.stringify(briefs)).not.toMatch(/Q\d/);
    expect(
      AgentRequest.safeParse({ roomId: "book-fri", message: "hi", openRequests: briefs }).success,
    ).toBe(true);
  });

  it("are capped at 12", () => {
    expect(openRequestBriefs(Array.from({ length: 20 }, () => req({})))).toHaveLength(12);
  });
});

describe("AI Planner text", () => {
  it("names parties instead of reservation ids, and says table 41, not T41", () => {
    const text = plannerText(
      "Which party is the 22-top: is it F4 (booked as 24 at 9:00 PM)? T63–T66 are planned for F1.",
    );
    expect(text).not.toMatch(/\bF\d\b|\bT\d/);
    expect(text).toContain(`is it ${partyName("F4")} (booked as 24`);
    expect(text.endsWith(`for ${partyName("F1")}`)).toBe(true);
    expect(text).toContain("Tables 63–66");
  });

  it("leaves times, counts and plain words alone", () => {
    expect(plannerText("Party of 8 at 9:00 PM, free in about 11 min.")).toBe(
      "Party of 8 at 9:00 PM, free in about 11 min.",
    );
  });
});
