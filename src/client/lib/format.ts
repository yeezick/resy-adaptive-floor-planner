export function usd(n: number, digits = 4): string {
  return `$${n.toFixed(digits)}`;
}

/** Formats a 0..1 fraction as a percentage. */
export function pct(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function waitLabel(min: number): string {
  return min === 0 ? "free now" : `~${min} min`;
}

/** "7pm" / "7:30pm" in model text → "7:00 PM" / "7:30 PM", the app's one time format (display only). */
export function normalTimes(text: string): string {
  return text.replace(
    /\b(\d{1,2})(?::([0-5]\d))?\s?(am|pm)\b/gi,
    (_m, h: string, m: string | undefined, ap: string) => `${h}:${m ?? "00"} ${ap.toUpperCase()}`,
  );
}
