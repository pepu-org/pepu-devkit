/**
 * In-memory sliding-window rate limiter. Single-process by design (this service is a single process; see the spec's
 * residual risks). Keys are caller-chosen strings (e.g. `auth:<ip>`, `owner:<address>`). Memory is bounded: when the
 * key table grows past `maxKeys`, expired windows are swept, and if it is still full the oldest keys are dropped.
 */
export interface RateLimitDecision {
  ok: boolean;
  /** Seconds until a slot frees up (only meaningful when ok is false). */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly opts: { windowMs: number; max: number; maxKeys?: number },
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitDecision {
    const t = this.now();
    const cutoff = t - this.opts.windowMs;
    let list = this.hits.get(key);
    if (list) {
      let i = 0;
      while (i < list.length && (list[i] as number) <= cutoff) i++;
      if (i > 0) list = list.slice(i);
    } else {
      list = [];
      this.evictIfFull();
    }
    if (list.length >= this.opts.max) {
      this.hits.set(key, list);
      const retry = Math.ceil(((list[0] as number) + this.opts.windowMs - t) / 1000);
      return { ok: false, retryAfterSeconds: Math.max(1, retry) };
    }
    list.push(t);
    this.hits.set(key, list);
    return { ok: true, retryAfterSeconds: 0 };
  }

  /** Like `check` but never records a hit: is `key` currently over its limit? */
  peek(key: string): RateLimitDecision {
    const t = this.now();
    const cutoff = t - this.opts.windowMs;
    const live = (this.hits.get(key) ?? []).filter((x) => x > cutoff);
    if (live.length >= this.opts.max) {
      const retry = Math.ceil(((live[0] as number) + this.opts.windowMs - t) / 1000);
      return { ok: false, retryAfterSeconds: Math.max(1, retry) };
    }
    return { ok: true, retryAfterSeconds: 0 };
  }

  private evictIfFull(): void {
    const maxKeys = this.opts.maxKeys ?? 20_000;
    if (this.hits.size < maxKeys) return;
    const cutoff = this.now() - this.opts.windowMs;
    for (const [k, list] of this.hits) {
      if ((list[list.length - 1] as number) <= cutoff) this.hits.delete(k);
    }
    if (this.hits.size >= maxKeys) {
      let n = Math.ceil(maxKeys / 10);
      for (const k of this.hits.keys()) {
        this.hits.delete(k);
        if (--n <= 0) break;
      }
    }
  }
}
