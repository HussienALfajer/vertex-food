import { idSchema } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('makes ids the contracts accept, ordered by time', () => {
    const first = uuidv7(1_761_700_000_000);
    const later = uuidv7(1_761_700_000_001);
    expect(idSchema.safeParse(first).success).toBe(true);
    expect(first < later).toBe(true);
    expect(first.slice(0, 13)).toBe('019a2d80-b100');
  });
});
