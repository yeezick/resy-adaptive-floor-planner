import { describe, expect, it } from "vitest";
import { ChatTurnOutput } from "../domain/requestChat";
import { toStrictJsonSchema } from "./agent/schemas";

/** Union-typed parameters in a JSON schema: `anyOf` nodes and type arrays (e.g. ["string", "null"]). */
function unionCount(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + unionCount(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  let n = Array.isArray(o.anyOf) || Array.isArray(o.type) ? 1 : 0;
  for (const v of Object.values(o)) n += unionCount(v);
  return n;
}

describe("request chat output schema", () => {
  const schema = toStrictJsonSchema(ChatTurnOutput);
  it("stays within the API's 16 union-typed parameters (the floor fields add none)", () => {
    expect(unionCount(schema)).toBe(4);
    expect(unionCount(schema)).toBeLessThanOrEqual(16);
  });
  it("uses enums, never unions, for the op fields", () => {
    const text = JSON.stringify(schema);
    expect(text).toContain('"enum":[0,2,4]');
    expect(text).toContain('"enum":["yes","no","unchanged"]');
    expect(text).not.toContain('"default"');
  });
});
