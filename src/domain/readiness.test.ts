import { describe, expect, it } from "vitest";
import { dinnerPeak, room, table } from "./__fixtures__/build";
import { REMAINING_MIN, RESET_MIN } from "./phases";
import {
  joinBadge,
  joinReadiness,
  readinessBadge,
  readinessChip,
  readinessPill,
  readinessTarget,
} from "./readiness";

describe("readiness of a proposed join (from meal phase, est.)", () => {
  it("is Ready when every table is free now", () => {
    const r = room({
      tables: [table("T1"), table("T2", { status: "reserved", reservedAt: "20:00" })],
    });
    const j = joinReadiness(r, ["T1", "T2"]);
    expect(j.ready).toBe(true);
    expect(j.tables.map(readinessBadge)).toEqual(["now", "now"]);
    expect(readinessPill(j)).toBe("capacity fit ✓ · Ready");
  });

  it("waits for the slowest table and shows each table's stage", () => {
    const r = room({
      tables: [
        table("T1"),
        table("T2", { status: "occupied", phase: "dessert", partySize: 2 }),
        table("T3", { status: "occupied", phase: "entrees", partySize: 4 }),
      ],
    });
    const j = joinReadiness(r, ["T1", "T2", "T3"]);
    const entrees = REMAINING_MIN.entrees + RESET_MIN;
    expect(j.ready).toBe(false);
    expect(j.readyInMin).toBe(entrees);
    expect(j.tables.map((t) => t.phase)).toEqual([null, "dessert", "entrees"]);
    expect(j.tables.map(readinessBadge)).toEqual([
      "now",
      `~${REMAINING_MIN.dessert + RESET_MIN}m`,
      `~${entrees}m`,
    ]);
    expect(readinessPill(j)).toBe(`capacity fit ✓ · ready to set up in ~${entrees} min`);
  });

  it("skips spare tables from storage and says when a table is blocked", () => {
    const r = room({ tables: [table("T1"), table("T2", { status: "blocked" })] });
    expect(joinReadiness(r, ["T1", "S9"]).tables.map((t) => t.id)).toEqual(["T1"]);
    const j = joinReadiness(r, ["T1", "T2"]);
    expect(j.readyInMin).toBeNull();
    expect(j.tables.map(readinessBadge)).toEqual(["now", "blocked"]);
    expect(readinessPill(j)).toBe("capacity fit ✓ · a table is blocked this service");
  });

  it("works on a live-service night", () => {
    const r = dinnerPeak();
    const seated = r.tables.filter((t) => t.status === "occupied").map((t) => t.id);
    const j = joinReadiness(r, seated.slice(0, 3));
    expect(j.ready).toBe(false);
    expect(j.tables.every((t) => (t.minutes ?? 0) > 0)).toBe(true);
  });
});

describe("readiness projected to the hold start (a future request)", () => {
  // floor clock 17:00; T2 on dessert frees at 17:00 + dessert + reset, T3 on entrées later
  const r = room({
    clock: "17:00",
    tables: [
      table("T1"),
      table("T2", { status: "occupied", phase: "dessert", partySize: 2 }),
      table("T3", { status: "occupied", phase: "entrees", partySize: 4 }),
    ],
  });
  const entreesFree = 17 * 60 + REMAINING_MIN.entrees + RESET_MIN;
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const h12 = (m: number) =>
    `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} PM`;

  it("is Ready when every table is free by the hold start, even though some are seated now", () => {
    const at = hhmm(entreesFree + 15);
    const j = joinReadiness(r, ["T1", "T2", "T3"], at);
    expect(j.ready).toBe(true);
    expect(j.tables.map((t) => joinBadge(t, j))).toEqual(["free", "free", "free"]);
    expect(j.tables.map((t) => readinessChip(t, j))).toEqual(
      Array(3).fill(`free by ${h12(entreesFree + 15)}`),
    );
    expect(readinessPill(j)).toBe("capacity fit ✓ · Ready");
  });

  it("names the clock time a table stays busy until, and the set-up time, when the hold starts first", () => {
    const at = hhmm(entreesFree - 10);
    const j = joinReadiness(r, ["T1", "T3"], at);
    expect(j.ready).toBe(false);
    expect(j.readyAt).toBe(hhmm(entreesFree));
    expect(j.tables.map((t) => joinBadge(t, j))).toEqual(["free", `~${h12(entreesFree)}`]);
    expect(j.tables.map((t) => readinessChip(t, j))[1]).toBe(
      `busy until ~${h12(entreesFree)} (est.)`,
    );
    expect(readinessPill(j)).toBe(`capacity fit ✓ · ready to set up at ~${h12(entreesFree)}`);
  });

  it("keeps live minutes when there is no hold start (a request for now)", () => {
    const j = joinReadiness(r, ["T1", "T3"], null);
    expect(j.tables.map((t) => joinBadge(t, j))).toEqual([
      "now",
      `~${REMAINING_MIN.entrees + RESET_MIN}m`,
    ]);
    expect(j.tables.map(readinessBadge)).toEqual(j.tables.map((t) => joinBadge(t, j)));
  });
});

describe("readinessTarget: live minutes for now, projection for later", () => {
  it("is live for a request arriving within one turn of the floor clock", () => {
    expect(readinessTarget("20:00", "19:10", "18:30")).toBeNull();
  });

  it("is live once the hold has begun", () => {
    expect(readinessTarget("21:00", "19:10", "19:00")).toBeNull();
  });

  it("projects a later request to its hold start", () => {
    expect(readinessTarget("18:30", "15:00", "17:00")).toBe("17:00");
  });

  it("is live when there is no hold to project to", () => {
    expect(readinessTarget("21:00", "15:00", null)).toBeNull();
  });
});
