import { describe, expect, it } from 'vitest';
import { healthCheckSchema, livenessSchema } from './health-check.js';

describe('health checks', () => {
  it('accept only an ok answer', () => {
    expect(healthCheckSchema.parse({ status: 'ok', database: 'ok' })).toEqual({
      status: 'ok',
      database: 'ok',
    });
    expect(healthCheckSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(livenessSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(livenessSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
