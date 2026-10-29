import { describe, expect, it } from 'vitest';
import {
  assertDataExportAllowed,
  assertDataExportMove,
  canMoveDataExport,
  type DataExportStatus,
  damascusDay,
  dataExportAllowance,
  dataExportExpiresAt,
  dataExportFileName,
  dataExportStatuses,
  dataExportTokenSchema,
} from './data-export.js';
import { DomainError } from './errors.js';

// Spec S06 "Export states", written out so a change is a visible change to this test.
const allowed: Record<DataExportStatus, DataExportStatus[]> = {
  queued: ['running', 'failed'],
  running: ['ready', 'failed'],
  ready: ['expired'],
  failed: [],
  expired: [],
};

describe('export states', () => {
  it('allows exactly the transitions of the table', () => {
    for (const from of dataExportStatuses) {
      for (const to of dataExportStatuses) {
        expect(canMoveDataExport(from, to), `${from} → ${to}`).toBe(allowed[from].includes(to));
        if (!allowed[from].includes(to)) expect(() => assertDataExportMove(from, to)).toThrow();
      }
    }
  });
});

describe('the daily limit (rule 8)', () => {
  const now = new Date('2026-10-29T20:59:00.000Z'); // 23:59 in Damascus

  it('counts the requests of the Damascus calendar day', () => {
    expect(damascusDay(now)).toEqual({
      start: new Date('2026-10-28T21:00:00.000Z'),
      end: new Date('2026-10-29T21:00:00.000Z'),
    });
    const today = [new Date('2026-10-28T21:00:00.000Z'), new Date('2026-10-29T10:00:00.000Z')];
    const yesterday = [new Date('2026-10-28T20:59:59.000Z')];
    expect(dataExportAllowance([...today, ...yesterday], now)).toEqual({
      remainingToday: 1,
      nextAllowedAt: null,
    });
    expect(dataExportAllowance([], now).remainingToday).toBe(3);
  });

  it('refuses the fourth with the next Damascus midnight, and allows it two minutes later', () => {
    const three = [1, 2, 3].map((hour) => new Date(`2026-10-29T0${hour}:00:00.000Z`));
    expect(dataExportAllowance(three, now)).toEqual({
      remainingToday: 0,
      nextAllowedAt: new Date('2026-10-29T21:00:00.000Z'),
    });
    try {
      assertDataExportAllowed(three, now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('EXPORT_LIMIT_REACHED');
      expect((error as DomainError).details).toEqual({ nextAllowedAt: '2026-10-29T21:00:00.000Z' });
    }
    // 00:01 the next day (edge case 6).
    expect(() =>
      assertDataExportAllowed(three, new Date('2026-10-29T21:01:00.000Z')),
    ).not.toThrow();
  });
});

describe('export files', () => {
  it('names the file by slug and the Damascus time of the snapshot', () => {
    expect(dataExportFileName('test-kitchen', new Date('2026-10-29T11:05:59.000Z'))).toBe(
      'vertex-food-test-kitchen-20261029-1405.zip',
    );
    expect(dataExportFileName('test-kitchen', new Date('2026-10-29T21:30:00.000Z'))).toBe(
      'vertex-food-test-kitchen-20261030-0030.zip',
    );
  });

  it('keeps a ready file 7 days', () => {
    expect(dataExportExpiresAt(new Date('2026-10-29T11:00:00.000Z'))).toEqual(
      new Date('2026-11-05T11:00:00.000Z'),
    );
  });

  it('takes a link token of 32 bytes in base64url', () => {
    expect(dataExportTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(dataExportTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(dataExportTokenSchema.safeParse(`${'A'.repeat(42)}/`).success).toBe(false);
  });
});
