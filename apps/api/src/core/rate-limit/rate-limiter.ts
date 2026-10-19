import { DomainError } from '@vertex-food/contracts';

/**
 * A fixed-window limit per key, in the memory of this process: enough while the API runs as one
 * process (ADR 0017). Keys are ids (tenant, route), never personal data. Copied from Vertex Shifa.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request for `key`, or refuses with `RATE_LIMITED` past the limit. */
  take(key: string): void {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.sweep(now);
      this.windows.set(key, { start: now, count: 1 });
      return;
    }
    if (window.count >= this.limit) {
      throw new DomainError('RATE_LIMITED', 'Too many requests');
    }
    window.count += 1;
  }

  /** Forgets expired windows, so keys never seen again do not stay in memory. */
  private sweep(now: number) {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
