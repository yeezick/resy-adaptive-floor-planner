import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeterministicChecks } from "../src/shared/evals";

describe("published deterministic checks (public/evals/checks.json)", () => {
  it("parses, and every group passes", () => {
    const c = DeterministicChecks.parse(
      JSON.parse(readFileSync("public/evals/checks.json", "utf8")) as unknown,
    );
    expect(c.groups.map((g) => g.id)).toEqual([
      "holds",
      "section",
      "aisle",
      "cant-fit",
      "activity",
      "request-chat",
    ]);
    for (const g of c.groups) expect(g.passed).toBe(g.total);
  });
});
