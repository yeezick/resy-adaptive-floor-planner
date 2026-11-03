import { describe, expect, it } from "vitest";
import { checkTableSet, type Table } from "../../domain";
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
