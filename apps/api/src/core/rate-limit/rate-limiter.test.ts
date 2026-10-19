import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('admits the limit per window and key, then refuses until the window ends', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    limiter.take('a');
    limiter.take('a');
    expect(() => limiter.take('a')).toThrow('Too many requests');
    limiter.take('b');
    now = 60_000;
    limiter.take('a');
  });
});
