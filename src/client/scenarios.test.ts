import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECORDED_FLOOR_EDIT, SCENARIOS } from "./scenarios";

describe("recorded scenarios", () => {
  it("floor-edit replays exactly the golden floor-g1-w9 transcript (no hand drift)", () => {
    const golden = JSON.parse(
      readFileSync("evals/floor-chat/transcripts/floor-g1-w9.json", "utf8"),
    ) as { output: unknown; promptVersion: string; model: string };
    expect(RECORDED_FLOOR_EDIT.result.output).toEqual(golden.output);
    expect(RECORDED_FLOOR_EDIT.result.promptVersion).toBe(golden.promptVersion);
    expect(RECORDED_FLOOR_EDIT.result.model).toBe(golden.model);
    const line = readFileSync("evals/floor-chat/golden.jsonl", "utf8")
      .split("\n")
      .find((l) => l.includes('"floor-g1-w9"'));
    expect(RECORDED_FLOOR_EDIT.message).toBe(
      (JSON.parse(line ?? "{}") as { message: string }).message,
    );
  });

  it("the Scenarios menu lists floor-edit right after the tables 30–50 chat", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids.indexOf("floor-edit")).toBe(ids.indexOf("request-chat") + 1);
  });
});
