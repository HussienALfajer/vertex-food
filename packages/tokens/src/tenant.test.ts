import { describe, expect, it } from 'vitest';
import { contrast } from './contrast.js';
import { palette } from './palette.js';
import { darkColors, lightColors } from './semantic.js';
import { readableOn, tenantColors } from './tenant.js';

describe('tenant colors', () => {
  it('are the theme primary roles without a restaurant identity', () => {
    expect(tenantColors(undefined, 'light')).toEqual({
      tenantAccent: lightColors.primary,
      tenantAccentForeground: lightColors.primaryForeground,
    });
    expect(tenantColors({}, 'dark')).toEqual({
      tenantAccent: darkColors.primary,
      tenantAccentForeground: darkColors.primaryForeground,
    });
  });

  it("carry the restaurant's accent with the text color that reads on it", () => {
    expect(tenantColors({ accent: '#B3261E' }, 'light')).toEqual({
      tenantAccent: '#b3261e',
      tenantAccentForeground: palette.white,
    });
    expect(tenantColors({ accent: '#f2c94c' }, 'dark')).toEqual({
      tenantAccent: '#f2c94c',
      tenantAccentForeground: palette.green[950],
    });
  });

  it('never pass on a value that is not a #rrggbb color', () => {
    for (const accent of ['red', '#fff', 'url(x)', '#12345g', '#b3261e; color: red', '']) {
      expect(tenantColors({ accent }, 'light').tenantAccent, accent).toBe(lightColors.primary);
    }
  });

  it('pick the foreground with the higher contrast', () => {
    for (const background of ['#000000', '#ffffff', '#b9a87a', '#004139', '#3786c3', '#ff7a00']) {
      const chosen = readableOn(background);
      const other = chosen === palette.white ? palette.green[950] : palette.white;
      expect(contrast(chosen, background), background).toBeGreaterThanOrEqual(
        contrast(other, background),
      );
    }
  });
});
