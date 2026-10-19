import { errorCodes } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { ar, formatLocale } from './index.js';

function texts(value: unknown, path: string): [string, unknown][] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [[path, value]];
}

describe('Arabic catalog', () => {
  const all = texts(ar, 'ar');

  it('holds only non-empty strings', () => {
    for (const [path, text] of all) {
      expect(typeof text, path).toBe('string');
      expect((text as string).trim(), path).not.toBe('');
    }
  });

  it('writes digits in Latin, never Arabic-Indic', () => {
    for (const [path, text] of all) {
      expect(text, path).not.toMatch(/[٠-٩۰-۹]/);
    }
  });

  it('has a text for every error code', () => {
    expect(Object.keys(ar.errors).sort()).toEqual([...errorCodes].sort());
  });
});

describe('format locale', () => {
  it('formats numbers and dates with Latin digits', () => {
    expect(new Intl.NumberFormat(formatLocale).format(1234567)).toMatch(/^[0-9٬,.]+$/);
    const date = new Intl.DateTimeFormat(formatLocale, { dateStyle: 'short', timeZone: 'UTC' });
    expect(date.format(new Date(Date.UTC(2026, 9, 9)))).not.toMatch(/[٠-٩]/);
    expect(date.format(new Date(Date.UTC(2026, 9, 9)))).toMatch(/2026/);
  });
});
