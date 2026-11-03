import type { Room } from "../../domain";
import { describe, expect, it } from "vitest";
import { TEST_ROOM } from "../testRoom";
import { getRoom } from "../rooms";
import { FinalOutput, toStrictJsonSchema } from "./schemas";
import { compactRoom, executeTool, toolDefinitions, tonightForAgent } from "./tools";

const room: Room = TEST_ROOM;

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

describe("tool definitions", () => {
  it("are strict, closed objects without unsupported keywords", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([
      "get_room_state",
      "find_tables_for_party",
      "estimate_free_time",
      "propose_combine",
      "plan_builds",
    ]);
    for (const d of defs) {
      expect(d.strict).toBe(true);
      walk(d.input_schema, (n) => {
        if (n.type === "object") expect(n.additionalProperties).toBe(false);
        for (const k of ["minimum", "maximum", "maxItems", "minLength", "$schema"])
          expect(n).not.toHaveProperty(k);
        if (typeof n.minItems === "number") expect(n.minItems).toBeLessThanOrEqual(1);
      });
    }
  });

  it("final output schema turns nullable into anyOf", () => {
    const s = toStrictJsonSchema(FinalOutput) as { properties: Record<string, unknown> };
    expect(s.properties.clarifyingQuestion).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });
});

describe("executeTool", () => {
  it("get_room_state returns a compact view without geometry", () => {
    const out = executeTool(room, "get_room_state", {});
    expect(out.ok).toBe(true);
    const view = compactRoom(room);
    expect(view.tables[0]).not.toHaveProperty("x");
    expect(view.tables.find((t) => t.id === "T12")?.attrs).toEqual(["accessible", "quiet"]);
  });

  it("find_tables_for_party delegates to the domain", () => {
    const out = executeTool(room, "find_tables_for_party", { partySize: 2, needs: [] });
    expect(out.ok && (out.output as { options: unknown[] }).options.length).toBeGreaterThan(0);
  });

  it("returns a typed error for invalid input instead of throwing", () => {
    const out = executeTool(room, "find_tables_for_party", { partySize: 0, needs: ["sunny"] });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/invalid input/);
    expect(executeTool(room, "get_room_state", { extra: 1 }).ok).toBe(false);
  });

  it("rejects unknown tools and unknown tables", () => {
    expect(executeTool(room, "seat_party", {})).toEqual({
      ok: false,
      error: 'unknown tool "seat_party"',
    });
    const out = executeTool(room, "estimate_free_time", { tableIds: ["T99"] });
    expect(!out.ok && out.error).toMatch(/T99/);
  });

  it("estimate_free_time uses meal phase", () => {
    const out = executeTool(room, "estimate_free_time", { tableIds: ["T10", "T12"] });
    expect(out.ok && out.output).toMatchObject({
      tables: [{ tableId: "T10", minutes: 11 }, { minutes: 0 }],
    });
  });

  it("propose_combine checks legality and never applies", () => {
    const ok = executeTool(room, "propose_combine", { tableIds: ["T11", "T12"] });
    expect(ok.ok && ok.output).toEqual({
      tableIds: ["T11", "T12"],
      legal: true,
      seats: 6,
      applied: false,
    });
    const bad = executeTool(room, "propose_combine", { tableIds: ["T12", "T22"] });
    expect(bad.ok && bad.output).toMatchObject({ legal: false, applied: false });
    expect(room.combos).toEqual([]);
  });

  it("plan_builds validates HH:MM", () => {
    const next = getRoom("next-day") as Room;
    const out = executeTool(next, "plan_builds", { from: "17:00", to: "20:00" });
    expect(out.ok && (out.output as { parties: unknown[] }).parties.length).toBeGreaterThan(0);
    expect(executeTool(next, "plan_builds", { from: "5pm", to: "20:00" }).ok).toBe(false);
  });

  it("plan_builds returns tonight's proposal in compact form, read-only", () => {
    const heavy = getRoom("heavy-saturday") as Room;
    const before = JSON.stringify(heavy);
    const t = tonightForAgent(heavy, "17:00", "23:00");
    expect(JSON.stringify(heavy)).toBe(before);
    expect(t.applied).toBe(false);
    expect(t).not.toHaveProperty("variant");
    expect(t.summary.placed).toBe(t.parties.length);
    for (const p of t.parties) {
      expect(p.tables.length).toBeGreaterThan(0);
      expect(p.reason).not.toBe("");
      expect(p.buildWindow).not.toBeNull();
    }
    for (const u of t.infeasible) expect(u.reason.length).toBeGreaterThan(10);
    expect(t.crew.length).toBe(t.parties.length);
  });
});
