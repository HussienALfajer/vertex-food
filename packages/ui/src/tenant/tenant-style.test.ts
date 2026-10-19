import { palette } from '@vertex-food/tokens';
import { describe, expect, it } from 'vitest';
import { tenantStyle } from './tenant-style';

describe('tenantStyle', () => {
  it('sets nothing without a valid accent, so the theme defaults apply', () => {
    expect(tenantStyle(undefined)).toEqual({});
    expect(tenantStyle({ logoUrl: '/files/logo.png' })).toEqual({});
    expect(tenantStyle({ accent: 'red; background: url(x)' })).toEqual({});
  });

  it("sets the restaurant's accent and the text color that reads on it", () => {
    expect(tenantStyle({ accent: '#B3261E' })).toEqual({
      '--tenant-accent': '#b3261e',
      '--tenant-accent-foreground': palette.white,
    });
  });
});
