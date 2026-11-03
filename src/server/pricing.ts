// Dated price table for computing the cost of every Anthropic call from its response `usage`.
//
// Source: https://claude.com/pricing (anthropic.com/pricing 301-redirects there), read 2026-11-02.
// claude-opus-5, claude-opus-4-8 and claude-sonnet-5 are not listed on that page; their rows come from
// https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-02. They are here because a
// server-side refusal fallback (`fallbacks: "default"`) can serve a response from them.
//
// All values are USD per million tokens. Cache write = 5-minute TTL.

export const PRICING_SOURCE = "https://claude.com/pricing";
export const PRICING_READ_ON = "2026-11-02";

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface PriceEntry extends ModelPrice {
  /** Prompts above this many tokens are billed at `longContext` instead. */
  longContextAbove?: number;
  longContext?: ModelPrice;
}

const PRICES: Record<string, PriceEntry> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    longContextAbove: 100_000,
    longContext: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  // Fallback targets (docs pricing page, see header).
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/** The subset of the API `usage` object that is billed. Null cache fields count as zero. */
export interface BilledUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function knownModels(): string[] {
  return Object.keys(PRICES);
}

/** Price for a model and prompt size. Throws for an unknown model — never prices a call at $0. */
export function priceFor(model: string, promptTokens = 0): ModelPrice {
  const entry = PRICES[model];
  if (!entry)
    throw new Error(`no price for model "${model}" (pricing.ts, read ${PRICING_READ_ON})`);
  if (
    entry.longContext &&
    entry.longContextAbove !== undefined &&
    promptTokens > entry.longContextAbove
  )
    return entry.longContext;
  return entry;
}

export function costUsd(model: string, usage: BilledUsage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheWrite + cacheRead;
  const p = priceFor(model, prompt);
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      cacheWrite * p.cacheWrite +
      cacheRead * p.cacheRead) /
    1_000_000
  );
}

/** The highest rate in the table for each component — used to charge a model we have no price for. */
export function maxPrice(): ModelPrice {
  const all = Object.values(PRICES).flatMap((p) => (p.longContext ? [p, p.longContext] : [p]));
  return {
    input: Math.max(...all.map((p) => p.input)),
    output: Math.max(...all.map((p) => p.output)),
    cacheWrite: Math.max(...all.map((p) => p.cacheWrite)),
    cacheRead: Math.max(...all.map((p) => p.cacheRead)),
  };
}

export function isKnownModel(model: string): boolean {
  return model in PRICES;
}

/**
 * Never throws: an unknown model (e.g. a fallback model added after this table was read) is charged at the
 * highest rate in the table, and `priced` says so.
 */
export function costUsdSafe(
  model: string,
  usage: BilledUsage,
): { usd: number; priced: "table" | "max-rate" } {
  if (isKnownModel(model)) return { usd: costUsd(model, usage), priced: "table" };
  const p = maxPrice();
  const usd =
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000;
  return { usd, priced: "max-rate" };
}

/**
 * Worst-case cost of one call, reserved against a budget before the call: every input token at the cache-write
 * rate (estimated at 2 characters per token, which over-counts JSON) plus max_tokens of output.
 */
export function reservationUsd(model: string, maxTokens: number, inputChars: number): number {
  const p = isKnownModel(model) ? priceFor(model, Math.ceil(inputChars / 2)) : maxPrice();
  return (
    (Math.ceil(inputChars / 2) * Math.max(p.input, p.cacheWrite) + maxTokens * p.output) / 1_000_000
  );
}
