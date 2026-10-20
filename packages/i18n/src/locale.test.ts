import { describe, expect, it } from 'vitest';
import { displayTimeZone, formatLocale } from './index.js';

const arabicIndicDigit = /[٠-٩۰-۹]/;

describe('formatLocale', () => {
  it('names months as read in Syria, with Latin digits', () => {
    const format = new Intl.DateTimeFormat(formatLocale, {
      dateStyle: 'long',
      timeZone: displayTimeZone,
    });
    const september = format.format(new Date('2026-09-20T12:00:00Z'));
    const october = format.format(new Date('2026-10-20T12:00:00Z'));
    expect(september).toBe('20 أيلول 2026');
    expect(october).toBe('20 تشرين الأول 2026');
    expect(september + october).not.toMatch(arabicIndicDigit);
  });

  it('keeps the Gregorian calendar and Latin digits for numbers', () => {
    const options = new Intl.DateTimeFormat(formatLocale).resolvedOptions();
    expect(options.calendar).toBe('gregory');
    expect(options.numberingSystem).toBe('latn');
    expect(new Intl.NumberFormat(formatLocale).format(12345)).toBe('12,345');
  });
});
