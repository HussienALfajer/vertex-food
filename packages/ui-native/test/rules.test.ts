import { describe, expect, it } from 'vitest';
import { parseSavedTheme, resolveScheme, themeStorageKey } from '../src/theme-preference.js';

describe('theme', () => {
  it('reads back a saved choice, or none', () => {
    expect(parseSavedTheme(null)).toBeNull();
    expect(parseSavedTheme('sepia')).toBeNull();
    expect(parseSavedTheme('dark')).toBe('dark');
  });

  it('draws the saved choice, or the system setting (light when it says nothing)', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme(null, 'dark')).toBe('dark');
    expect(resolveScheme(null, null)).toBe('light');
  });

  it('is stored under the key the web apps use', () => {
    expect(themeStorageKey).toBe('vertex-theme');
  });
});
