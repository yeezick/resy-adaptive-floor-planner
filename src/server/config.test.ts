import { afterEach, describe, expect, it } from "vitest";
import { checkEffort, checkModel, parseTrustProxy, validateEnv } from "./config";
import { costUsdSafe, reservationUsd } from "./pricing";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("config", () => {
  it("rejects unknown models and efforts with a clear message", () => {
    expect(() => checkModel("ANTHROPIC_MODEL", "claude-nope")).toThrow(
      /ANTHROPIC_MODEL="claude-nope" has no price/,
    );
    expect(() => checkModel("JUDGE_MODEL", "claude-sonnet-5-5")).not.toThrow();
    expect(() => checkEffort("AGENT_EFFORT", "turbo")).toThrow(/AGENT_EFFORT must be one of/);
  });

  it("validateEnv fails fast on bad values", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
    process.env.AGENT_EFFORT = "low";
    expect(() => validateEnv()).not.toThrow();
    process.env.JUDGE_MODEL = "gpt-x";
    expect(() => validateEnv()).toThrow(/JUDGE_MODEL/);
    delete process.env.JUDGE_MODEL;
    process.env.MAX_CONCURRENT_RUNS = "zero";
    expect(() => validateEnv()).toThrow(/MAX_CONCURRENT_RUNS/);
  });

  it("parses TRUST_PROXY as a hop count or boolean", () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy(" 2 ")).toBe(2);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("FALSE")).toBe(false);
    expect(() => parseTrustProxy("yes")).toThrow(/TRUST_PROXY/);
  });
});

describe("pricing helpers", () => {
  it("reserves output at max_tokens plus input at the cache-write rate", () => {
    // 2000 chars ≈ 1000 tokens × $5 + 1000 output × $20
    expect(reservationUsd("claude-opus-5-5", 1000, 2000)).toBeCloseTo(
      (1000 * 5 + 1000 * 20) / 1e6,
      12,
    );
  });
  it("costUsdSafe flags unknown models instead of throwing", () => {
    expect(costUsdSafe("claude-opus-5-5", { input_tokens: 1, output_tokens: 0 }).priced).toBe(
      "table",
    );
    expect(costUsdSafe("mystery", { input_tokens: 1, output_tokens: 0 }).priced).toBe("max-rate");
  });
});
