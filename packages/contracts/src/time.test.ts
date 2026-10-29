import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessInstant,
  businessIsoInstant,
  businessWallClock,
  minutesOfDay,
  timeOfDayFromMinutes,
  timeOfDaySchema,
  weekdayOf,
} from './time.js';

// Damascus has been on UTC+3 all year since 2022; the conversions read it from the time-zone
// database, so these tests pin today's offset.

describe('times of day', () => {
  it('accepts HH:MM from 00:00 to 23:59 only', () => {
    for (const time of ['00:00', '04:30', '23:59']) {
      expect(timeOfDaySchema.safeParse(time).success).toBe(true);
    }
    for (const time of ['24:00', '4:30', '04:60', '04:30:00', '']) {
      expect(timeOfDaySchema.safeParse(time).success).toBe(false);
    }
  });

  it('converts to and from minutes of the day', () => {
    expect(minutesOfDay('13:45')).toBe(825);
    expect(timeOfDayFromMinutes(825)).toBe('13:45');
    expect(timeOfDayFromMinutes(1440 + 60)).toBe('01:00');
    expect(timeOfDayFromMinutes(-60)).toBe('23:00');
  });
});

describe('dates', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('numbers the Syrian week from Saturday', () => {
    expect(weekdayOf('2026-10-17')).toBe(1); // Saturday
    expect(weekdayOf('2026-10-18')).toBe(2); // Sunday
    expect(weekdayOf('2026-10-23')).toBe(7); // Friday
  });
});

describe('Damascus wall clock', () => {
  it('reads an instant on the Damascus clock', () => {
    expect(businessWallClock('2026-10-19T12:00:00.000Z')).toEqual({
      date: '2026-10-19',
      minutes: 15 * 60,
    });
    expect(businessWallClock('2026-10-19T22:30:00.000Z')).toEqual({
      date: '2026-10-20',
      minutes: 90,
    });
  });

  it('finds the instant of a Damascus date and time', () => {
    expect(businessInstant('2026-10-20', '04:00').toISOString()).toBe('2026-10-20T01:00:00.000Z');
    expect(businessInstant('2026-10-20', '00:00').toISOString()).toBe('2026-10-19T21:00:00.000Z');
  });

  it('writes an instant on the Damascus clock with its offset, to the second', () => {
    expect(businessIsoInstant('2026-10-29T11:05:09.999Z')).toBe('2026-10-29T14:05:09+03:00');
    expect(businessIsoInstant(new Date('2026-12-31T22:30:00.000Z'))).toBe(
      '2027-01-01T01:30:00+03:00',
    );
  });
});
