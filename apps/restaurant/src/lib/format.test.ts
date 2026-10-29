import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDay, formatTime } from './format';

describe('format', () => {
  it('shows a calendar date with the month name read in Syria', () => {
    expect(formatDate('2026-10-20')).toBe('الثلاثاء، 20 تشرين الأول 2026');
    expect(formatDate('2026-09-01')).toBe('الثلاثاء، 1 أيلول 2026');
  });

  it('shows an instant in Damascus time with Latin digits', () => {
    expect(formatDateTime('2026-10-20T01:00:00.000Z')).toBe(
      'الثلاثاء، 20 تشرين الأول 2026 في 4:00 ص',
    );
  });

  it('shows the Damascus day of an instant, without its time', () => {
    // The start of 1 November in Damascus is 21:00 UTC the day before.
    expect(formatDay('2026-10-31T21:00:00.000Z')).toBe('الأحد، 1 تشرين الثاني 2026');
  });

  it('shows the time alone on the 24-hour clock in Damascus', () => {
    expect(formatTime('2026-10-20T07:42:00.000Z')).toBe('10:42');
    expect(formatTime('2026-10-20T13:05:00.000Z')).toBe('16:05');
  });
});
