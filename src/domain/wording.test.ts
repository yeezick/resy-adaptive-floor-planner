import { describe, expect, it } from "vitest";
import { demoNight } from "./__fixtures__/build";
import { checkRequest, type GuestRequest } from "./requests";
import {
  acceptLine,
  buildMinutes,
  countdown,
  coverTrade,
  crewNote,
  DECLINE_LINE,
  plainTables,
  tableNo,
  tableNumbers,
  tablesPhrase,
} from "./wording";

const build = {
  reservationId: "R1",
  time: "19:00",
  buildBy: "18:45",
  partySize: 11,
  area: "Main",
  rows: [["T72", "T73", "T74"]],
  tables: ["T72", "T73", "T74"],
  seats: 11,
  extenders: 0,
  extraChairs: 6,
  spareTables: 2,
  dividersOpened: [],
  steps: [],
};

describe("table wording (no T prefix)", () => {
  it("drops the T from table ids and lists numbers", () => {
    expect(tableNo("T72")).toBe("72");
    expect(tableNo("S1")).toBe("S1");
    expect(tablesPhrase(["T31"])).toBe("table 31");
    expect(tablesPhrase(["T72", "T73", "T74"])).toBe("tables 72–74");
    expect(tablesPhrase(["T72", "T74"])).toBe("tables 72 and 74");
    expect(tableNumbers(["T59", "T57", "T58", "T63"])).toBe("57–59 and 63");
  });

  it("rewrites T ids left in model text", () => {
    expect(plainTables("T41 frees in about 11 minutes.")).toBe(
      "Table 41 frees in about 11 minutes.",
    );
    expect(plainTables("Join T7 + T8, then tables T9.")).toBe(
      "Join table 7 + table 8, then tables 9.",
    );
    expect(plainTables("Tables in the Terrace")).toBe("Tables in the Terrace");
  });
});

describe("crew note", () => {
  it("reads like a note to the crew", () => {
    expect(
      crewNote({ ...build, rows: [["T72", "T74", "T76"]], tables: ["T72", "T74", "T76"] }),
    ).toBe(
      "Combine tables 72, 74 and 76 into an 11-top; bring 2 tables and 6 chairs from storage.",
    );
    expect(crewNote({ ...build, extraChairs: 0, spareTables: 0, seats: 12 })).toBe(
      "Combine tables 72–74 into a 12-top.",
    );
    expect(
      crewNote({
        ...build,
        rows: [["T1", "T2"], ["T4"]],
        tables: ["T1", "T2", "T4"],
        seats: 30,
        dividersOpened: ["P1 | P2"],
        extraChairs: 0,
        spareTables: 0,
        extenders: 1,
      }),
    ).toBe(
      "Open the divider between P1 and P2; combine tables 1 and 2 and table 4 into 2 long tables seating 30; bring 1 extender from storage.",
    );
  });

  it("never names a table with a T on a real request", () => {
    const fit = checkRequest(demoNight(), {
      id: "Q1",
      source: "app",
      receivedAt: "Tue 09:12",
      day: "Sat",
      bookRoomId: "demo-night",
      time: "19:00",
      partySize: 14,
      needs: [],
      privateRoom: false,
      contact: "Test Guest",
      message: "x",
    } satisfies GuestRequest);
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(crewNote(fit.build)).not.toMatch(/\bT\d/);
  });
});

describe("build time and the cost of yes vs no", () => {
  it("adds per-step crew minutes from the fixture, never below the minimum", () => {
    // 3 tables × 3 + 2 spare × 4 + ceil(6 chairs ÷ 4) = 9 + 8 + 2
    expect(buildMinutes(build)).toBe(19);
    expect(buildMinutes({ ...build, tables: ["T1"], spareTables: 0, extraChairs: 0 })).toBe(10);
  });

  it("nets the party's covers against the hold", () => {
    const t = coverTrade(22, 13);
    expect(t).toEqual({ gain: 22, lost: 13, net: 9 });
    expect(acceptLine(t)).toBe(
      "Accept: +22 covers (the party) · −13 covers lost to the hold (est.) = net +9",
    );
    expect(acceptLine(coverTrade(10, 14))).toMatch(/= net −4$/);
    expect(DECLINE_LINE).toBe("Decline: 0 · request leaves Resy");
  });

  it("counts down in hours and minutes", () => {
    expect(countdown(130)).toBe("in 2h 10m");
    expect(countdown(45)).toBe("in 45m");
    expect(countdown(120)).toBe("in 2h");
    expect(countdown(0)).toBe("now");
    expect(countdown(-15)).toBe("15m ago");
  });
});
