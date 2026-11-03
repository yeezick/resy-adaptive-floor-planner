import { describe, expect, it } from "vitest";
import { fakeMessage } from "./agent/fake";
import { callMetrics } from "./metrics";
import { maxPrice } from "./pricing";

const meta = {
  traceId: "t",
  role: "agent" as const,
  promptVersion: "agent.v1.0",
  latencyMs: 12,
  requestedModel: "claude-opus-5-5",
};

describe("callMetrics", () => {
  it("costs a plain response from top-level usage and the served model", () => {
    const m = callMetrics(
      fakeMessage([], "end_turn", {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      }),
      meta,
    );
    expect(m).toMatchObject({
      model: "claude-opus-5-5",
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 1000,
      cacheWriteTokens: 50,
      stopReason: "end_turn",
      latencyMs: 12,
    });
    expect(m.costUsd).toBeCloseTo((100 * 4 + 10 * 20 + 1000 * 0.2 + 50 * 5) / 1e6, 12);
  });

  it("costs each fallback attempt at the rates of the model that ran it", () => {
    const msg = fakeMessage(
      [],
      "end_turn",
      {
        input_tokens: 500,
        output_tokens: 100,
        iterations: [
          {
            type: "message",
            model: "claude-opus-5-5",
            input_tokens: 500,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation: null,
          },
          {
            type: "fallback_message",
            model: "claude-opus-4-8",
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation: null,
          },
        ],
      },
      "claude-opus-4-8",
    );
    const m = callMetrics(msg, meta);
    expect(m.model).toBe("claude-opus-4-8");
    expect(m.inputTokens).toBe(1000);
    expect(m.costUsd).toBeCloseTo((500 * 4 + 500 * 5 + 100 * 25) / 1e6, 12);
  });

  it("charges an unknown served model at the highest rate instead of throwing", () => {
    const m = callMetrics(
      fakeMessage([], "end_turn", { input_tokens: 1000, output_tokens: 100 }, "claude-unknown"),
      meta,
    );
    const p = maxPrice();
    expect(m.costUsd).toBeCloseTo((1000 * p.input + 100 * p.output) / 1e6, 12);
    expect(p.output).toBe(50);
  });

  it("bills an iteration without a model at the requested model", () => {
    const msg = fakeMessage(
      [],
      "end_turn",
      {
        iterations: [
          {
            type: "message",
            model: null,
            input_tokens: 1000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation: null,
          },
        ],
      },
      "claude-opus-4-8",
    );
    expect(callMetrics(msg, { ...meta, requestedModel: "claude-sonnet-5-5" }).costUsd).toBeCloseTo(
      (1000 * 2) / 1e6,
      12,
    );
  });
});
