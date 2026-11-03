// Per-client sliding-window rate limit, in memory. Keys are sha256 hashes of the client IP, so raw IPs are
// never stored or logged.
import { createHash } from "node:crypto";

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  static fromEnv(): RateLimiter {
    const n = Number(process.env.RATE_LIMIT_PER_MIN ?? 10);
    return new RateLimiter(Number.isFinite(n) && n > 0 ? n : 10);
  }

  /** Records a hit and returns whether it is allowed. */
  hit(clientIp: string): boolean {
    const key = createHash("sha256").update(clientIp).digest("hex");
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }

  private prune(t: number): void {
    for (const [k, v] of this.hits) if (!v.some((x) => t - x < 60_000)) this.hits.delete(k);
  }
}
