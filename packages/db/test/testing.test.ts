import { describe, expect, it } from 'vitest';
import { isStaleTestDatabase } from '../src/testing.js';

// The throwaway databases of the test runs (src/testing.ts): a run killed before its teardown
// leaves one behind, and a later run's setup drops it once it is stale and nobody is connected.

const now = Date.parse('2026-10-26T12:00:00.000Z');
const hour = 60 * 60_000;

describe('isStaleTestDatabase', () => {
  it('takes a test run database six hours old or more', () => {
    expect(isStaleTestDatabase(`food_test_${now - 6 * hour}_0a1b2c`, now)).toBe(true);
    expect(isStaleTestDatabase(`food_test_${now - 30 * 24 * hour}_ffffff`, now)).toBe(true);
  });

  it('keeps a run that may still be going', () => {
    expect(isStaleTestDatabase(`food_test_${now - 6 * hour + 1}_0a1b2c`, now)).toBe(false);
    expect(isStaleTestDatabase(`food_test_${now}_0a1b2c`, now)).toBe(false);
  });

  it('never takes a database that is not a test run', () => {
    for (const name of [
      'vertex_food',
      'postgres',
      'food_test',
      `food_test_${now - 30 * 24 * hour}`,
      `food_test_${now - 30 * 24 * hour}_0A1B2C`,
      `food_test_${now - 30 * 24 * hour}_0a1b2c_copy`,
      `my_food_test_${now - 30 * 24 * hour}_0a1b2c`,
    ]) {
      expect(isStaleTestDatabase(name, now), name).toBe(false);
    }
  });
});
