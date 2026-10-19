import { describe, expect, it, vi } from 'vitest';
import { forceRightToLeft } from './rtl';

describe('right to left at start', () => {
  it('allows and forces RTL whatever the device language', () => {
    const manager = { allowRTL: vi.fn(), forceRTL: vi.fn() };
    forceRightToLeft(manager);
    expect(manager.allowRTL).toHaveBeenCalledWith(true);
    expect(manager.forceRTL).toHaveBeenCalledWith(true);
  });
});
