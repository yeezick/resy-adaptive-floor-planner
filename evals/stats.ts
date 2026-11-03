// Small, pure statistics helpers for the eval rollups.

/** Wilson score interval for a binomial proportion (95% by default). n = 0 → the uninformative [0, 1]. */
export function wilson(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number; method: string } {
  const method = "wilson-95";
  if (n === 0) return { low: 0, high: 1, method };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), method };
}

/** Nearest-rank percentile (q in [0, 1]). Empty → 0. */
export function percentile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] as number;
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resample<T>(items: readonly T[], next: () => number): T[] {
  return items.map(() => items[Math.floor(next() * items.length)] as T);
}

export const round = (x: number, digits = 6) => Math.round(x * 10 ** digits) / 10 ** digits;
