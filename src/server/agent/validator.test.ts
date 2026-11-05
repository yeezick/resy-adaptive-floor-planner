import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTableSet, clearanceFor, parseRoom, type Table } from "../../domain";
import { nextDay } from "../../domain/__fixtures__/build";
import type { Recommendation } from "../../shared/api";
import { TEST_ROOM as room } from "../testRoom";
import {
  expectedWait,
  headerChairs,
  heldTable,
  meetsNeeds,
  validateRecommendations,
  validationContext,
  type ValidationContext,
} from "./validator";

const rec = (r: Partial<Recommendation> & Pick<Recommendation, "tables">): Recommendation => ({
  rank: 1,
  seats: 4,
  waitMin: 0,
  reasoning: "fits",
  tradeoffs: [],
  ...r,
});
const fit = (partySize: number): ValidationContext => ({
  fit: { partySize, needs: [] },
  builds: [],
});
const msgs = (p: { message: string }[]) => p.map((x) => x.message).join(" | ");

describe("validateRecommendations", () => {
  it("accepts an open table that fits", () => {
    expect(validateRecommendations(room, [rec({ tables: ["T12"] })], fit(4))).toEqual([]);
  });

  it("rejects unknown, blocked and illegal sets", () => {
    expect(msgs(validateRecommendations(room, [rec({ tables: ["T99"] })]))).toMatch(
      /not in room state: T99/,
    );
    expect(msgs(validateRecommendations(room, [rec({ tables: ["T29"] })]))).toMatch(/blocked/);
    expect(
      msgs(validateRecommendations(room, [rec({ tables: ["T12", "T22"], seats: 6 })])),
    ).toMatch(/illegal combine/);
  });

  it("rejects a join that fails the aisle check on the Juniper & Pine room", () => {
    const jp = nextDay();
    expect(clearanceFor(jp)).not.toBeNull();
    expect(
      msgs(validateRecommendations(jp, [rec({ tables: ["T43", "T44"], seats: 8 })], fit(8))),
    ).toMatch(/joining tables 43 and 44 leaves 32 in of aisle \(needs 36 in\)/);
  });

  it("fit answers may add header chairs only (capped by spare chairs)", () => {
    // T11+T12 seat 6; header room 2 but only 1 spare chair in storage.
    expect(headerChairs(room, ["T11", "T12"])).toBe(1);
    expect(
      validateRecommendations(
        room,
        [rec({ tables: ["T11", "T12"], seats: 7, waitMin: 45 })],
        fit(7),
      ),
    ).toEqual([]);
    expect(
      msgs(validateRecommendations(room, [rec({ tables: ["T11", "T12"], seats: 8, waitMin: 45 })])),
    ).toMatch(/storage is only for planned builds/);
  });

  it("only plan_builds-backed recommendations may use storage up to maxSeats", () => {
    const ids = ["T40", "T41", "T50", "T51"];
    const set = checkTableSet(room, ids);
    expect(set.ok).toBe(true);
    const max = set.ok ? set.maxSeats : 0;
    const build = { reservationId: "R1", partySize: 12, tables: ids };
    const ctx: ValidationContext = { builds: [build] };
    expect(validateRecommendations(room, [rec({ tables: ids, seats: max })], ctx)).toEqual([]);
    expect(msgs(validateRecommendations(room, [rec({ tables: ids, seats: max })]))).toMatch(
      /storage/,
    );
    expect(msgs(validateRecommendations(room, [rec({ tables: ids, seats: 10 })], ctx))).toMatch(
      /fewer than the party of 12/,
    );
  });

  it("uses party size and needs from the tools", () => {
    expect(
      msgs(validateRecommendations(room, [rec({ tables: ["T22"], seats: 2 })], fit(4))),
    ).toMatch(/fewer than the party of 4/);
    const view = { fit: { partySize: 2, needs: ["view" as const] }, builds: [] };
    expect(msgs(validateRecommendations(room, [rec({ tables: ["T22"], seats: 2 })], view))).toMatch(
      /does not meet: view/,
    );
    expect(validateRecommendations(room, [rec({ tables: ["T28"] })], view)).toEqual([]);
  });

  it("rejects a table held for a reservation inside the turn", () => {
    expect(msgs(validateRecommendations(room, [rec({ tables: ["T5"] })]))).toMatch(
      /held for a 19:30/,
    );
  });

  it("rejects double assignment and duplicate ranks, keyed by position", () => {
    const p = validateRecommendations(room, [
      rec({ rank: 1, tables: ["T12"] }),
      rec({ rank: 1, tables: ["T11", "T12"], seats: 6, waitMin: 45 }),
    ]);
    expect(p.every((x) => x.index === 1)).toBe(true);
    expect(msgs(p)).toMatch(/rank 1 is used twice/);
    expect(msgs(p)).toMatch(/T12 is already assigned in recommendation #1/);
  });

  it("rejects a waitMin that disagrees with estimateFreeTime by more than 5 min", () => {
    // T10 is at check: 6 + 5 = 11 min.
    expect(validateRecommendations(room, [rec({ tables: ["T10"], waitMin: 15 })])).toEqual([]);
    expect(msgs(validateRecommendations(room, [rec({ tables: ["T10"], waitMin: 30 })]))).toMatch(
      /waitMin 30 .* \(11 min\)/,
    );
  });
});

describe("validationContext", () => {
  it("takes fit from the last find call, cleared by a later plan_builds", () => {
    const find = {
      name: "find_tables_for_party",
      ok: true,
      input: { partySize: 4, needs: ["quiet"] },
    };
    const plan = {
      name: "plan_builds",
      ok: true,
      input: {},
      output: { parties: [{ reservationId: "R1", partySize: 12, tables: ["T40"] }] },
    };
    expect(validationContext([find]).fit).toEqual({ partySize: 4, needs: ["quiet"] });
    const ctx = validationContext([find, plan]);
    expect(ctx.fit).toBeUndefined();
    expect(ctx.builds).toHaveLength(1);
    expect(validationContext([{ ...find, ok: false }]).fit).toBeUndefined();
  });
});

describe("helpers", () => {
  it("expectedWait is the slowest table and null for blocked", () => {
    expect(expectedWait(room, ["T12", "T10"])).toBe(11);
    expect(expectedWait(room, ["T29"])).toBeNull();
  });
  it("heldTable finds a reservation hold inside the turn", () => {
    expect(heldTable(room, ["T5"], 0)?.id).toBe("T5");
    expect(heldTable(room, ["T12"], 0)).toBeUndefined();
  });
  it("meetsNeeds matches the domain semantics", () => {
    const t = (id: string) => room.tables.find((x) => x.id === id) as Table;
    expect(meetsNeeds([t("T12")], ["accessible", "quiet"])).toBe(true);
    expect(meetsNeeds([t("T11"), t("T12")], ["stroller"])).toBe(true);
    expect(meetsNeeds([t("T22")], ["view"])).toBe(false);
    expect(meetsNeeds([t("T1")], ["booth"])).toBe(true);
  });
});

describe("party size from the host's screen", () => {
  // the walk-in-8-peak floor (dinner-peak, 7:10 PM): tables 39 + 40 seat 6 joined, +1 header chair each = 8
  const peak = parseRoom(
    JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
  );
  const join = (seats: number) => rec({ tables: ["T39", "T40"], seats, waitMin: 80 });
  // only propose_combine + estimate_free_time ran: no party size from the tools
  const tools = [
    { name: "propose_combine", ok: true, input: { tables: ["T39", "T40"] } },
    { name: "estimate_free_time", ok: true, input: { tableId: "T40" } },
  ];

  it("golden: tables 39 + 40 seat 8 using their 2 header chairs (6 joined + 1 + 1)", () => {
    const set = checkTableSet(peak, ["T39", "T40"]);
    expect(set.ok && set.baseSeats).toBe(6);
    expect(headerChairs(peak, ["T39", "T40"])).toBe(2);
    expect(expectedWait(peak, ["T39", "T40"])).toBe(80);
  });

  it("golden: a recommendation claiming 6 seats for a party of 8 is rejected; 8 is accepted", () => {
    const ctx = validationContext(tools, 8);
    expect(ctx.partySize).toBe(8);
    expect(msgs(validateRecommendations(peak, [join(6)], ctx))).toBe(
      "6 seats is fewer than the party of 8",
    );
    expect(validateRecommendations(peak, [join(8)], ctx)).toEqual([]);
    // before: no tool-derived size, so the short recommendation slipped through
    expect(validateRecommendations(peak, [join(6)], validationContext(tools))).toEqual([]);
  });

  it("wins over the tool-derived size; the tools stay the fallback", () => {
    const find = { name: "find_tables_for_party", ok: true, input: { partySize: 4, needs: [] } };
    expect(msgs(validateRecommendations(peak, [join(6)], validationContext([find], 8)))).toContain(
      "fewer than the party of 8",
    );
    expect(validateRecommendations(peak, [join(6)], validationContext([find]))).toEqual([]);
    const ten = { ...find, input: { partySize: 10, needs: [] } };
    expect(msgs(validateRecommendations(peak, [join(8)], validationContext([ten])))).toContain(
      "fewer than the party of 10",
    );
  });

  it("a plan_builds build keeps its own party", () => {
    const ctx: ValidationContext = {
      partySize: 2,
      builds: [{ reservationId: "F1", partySize: 12, tables: ["T39", "T40"] }],
    };
    expect(msgs(validateRecommendations(peak, [join(8)], ctx))).toContain(
      "fewer than the party of 12",
    );
  });
});
