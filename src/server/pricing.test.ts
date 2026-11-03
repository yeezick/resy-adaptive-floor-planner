import { describe, expect, it } from "vitest";
import { costUsd, knownModels, priceFor } from "./pricing";

describe("costUsd", () => {
  it("prices Opus 5.5 input, output and cache tokens", () => {
    const usd = costUsd("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(4 + 20 + 5 + 0.2, 10);
  });

  it("treats null cache fields as zero", () => {
    const usd = costUsd("claude-sonnet-5-5", {
      input_tokens: 2000,
      output_tokens: 500,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });
    expect(usd).toBeCloseTo((2000 * 2 + 500 * 10) / 1e6, 12);
  });

  it("uses the Haiku long-context tier above 100K prompt tokens", () => {
    expect(priceFor("claude-haiku-5-5", 100_000).input).toBe(0.1);
    expect(priceFor("claude-haiku-5-5", 100_001).input).toBe(0.5);
    const usd = costUsd("claude-haiku-5-5", {
      input_tokens: 50_000,
      output_tokens: 0,
      cache_read_input_tokens: 60_000,
    });
    expect(usd).toBeCloseTo((50_000 * 0.5 + 60_000 * 0.05) / 1e6, 12);
  });

  it("prices Fable 5.1 and the fallback targets", () => {
    expect(costUsd("claude-fable-5-1", { input_tokens: 1e6, output_tokens: 0 })).toBe(10);
    expect(costUsd("claude-opus-5", { input_tokens: 0, output_tokens: 1e6 })).toBe(25);
    expect(knownModels()).toContain("claude-opus-4-8");
  });

  it("throws for an unknown model instead of returning 0", () => {
    expect(() => costUsd("claude-imaginary-9", { input_tokens: 1, output_tokens: 1 })).toThrow(
      /no price/,
    );
  });
});
