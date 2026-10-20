import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format';

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
});
