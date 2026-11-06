import { describe, expect, it } from "vitest";
import { HEADING, MARKER, commentBody, costUsd } from "./ai-review";

// The workflow's verdict step: the comment must contain this run's link and a "### AI review" line,
// and the verdict is the number of lines that start with ❌.
const runUrl = "https://github.com/o/r/actions/runs/123";
const blocking = (body: string) =>
  body.split("\n").filter((l) => /^\s*([-*]\s+)?❌/.test(l)).length;

describe("AI review comment", () => {
  it("keeps the verdict contract for a finished review", () => {
    const body = commentBody({
      runUrl,
      model: "claude-opus-5-5",
      costUsd: 0.0421,
      review: "### AI review\n\n❌ `src/a.ts:3` bug\n⚠️ `src/b.ts:9` naming",
    });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("actions/runs/123");
    expect(body).toMatch(/^### AI review$/m);
    expect(blocking(body)).toBe(1);
    expect(body).toContain("$0.0421");
  });

  it("adds the heading when the model leaves it out", () => {
    const body = commentBody({ runUrl, model: "claude-sonnet-5-5", review: "The diff is clean." });
    expect(body).toMatch(/^### AI review$/m);
    expect(blocking(body)).toBe(0);
  });

  it("an unfinished review has no heading, so it never reads as clean", () => {
    const body = commentBody({
      runUrl,
      model: "claude-opus-5-5",
      error: "API error 400: credit balance too low",
    });
    expect(body).not.toContain(HEADING);
    expect(body).toContain("actions/runs/123");
    expect(body).toContain("credit balance too low");
  });

  it("prices both tiers", () => {
    expect(
      costUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }),
    ).toBeCloseTo(6);
    expect(
      costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }),
    ).toBeCloseTo(3);
    expect(costUsd("unknown", { input_tokens: 5, output_tokens: 5 })).toBe(0);
  });
});
