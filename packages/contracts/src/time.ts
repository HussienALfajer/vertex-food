import { z } from 'zod';

/**
 * Wall-clock times and dates of the business (ADR 0020): instants are stored in UTC, while working
 * hours, business days and dates are read in `Asia/Damascus`, the only time zone in V1. Every
 * conversion goes through the time-zone database (`Intl`), so a future change of offset or daylight
 * saving needs no code change.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Damascus';

const MINUTES_PER_DAY = 1440;

/** A time of day on the wall clock, `HH:MM` from `00:00` to `23:59`. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .meta({ id: 'TimeOfDay' });

export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

/** A calendar date, `YYYY-MM-DD`. */
export const localDateSchema = z.iso.date().meta({ id: 'LocalDate' });

export type LocalDate = z.infer<typeof localDateSchema>;

/**
 * A day of the Syrian week, 1 = Saturday … 7 = Friday.
 */
export const weekdaySchema = z.int().min(1).max(7).meta({ id: 'Weekday' });

export type Weekday = z.infer<typeof weekdaySchema>;

export function minutesOfDay(time: TimeOfDay): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function timeOfDayFromMinutes(minutes: number): TimeOfDay {
  const value = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(value / 60);
  return `${String(hours).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** The date `days` after `date` (negative: before). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The Syrian weekday of a date (1 = Saturday … 7 = Friday). */
export function weekdayOf(date: LocalDate): Weekday {
  // getUTCDay: 0 = Sunday … 6 = Saturday.
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7) + 1;
}

let formatter: Intl.DateTimeFormat | undefined;

function wallClock(instant: Date): { date: LocalDate; minutes: number; seconds: number } {
  formatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

/** The Damascus calendar date and minute of the day of an instant. */
export function businessWallClock(instant: Date | string): { date: LocalDate; minutes: number } {
  const { date, minutes } = wallClock(new Date(instant));
  return { date, minutes };
}

/** The offset of Damascus from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number): number {
  const { date, minutes, seconds } = wallClock(new Date(instant));
  const asUtc = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 + seconds * 1000;
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * An instant as ISO 8601 on the Damascus wall clock with its offset, to the second:
 * `2026-10-29T14:05:00+03:00` (the export's CSV files, spec S06).
 */
export function businessIsoInstant(instant: Date | string): string {
  const at = new Date(instant).getTime();
  const { date, minutes, seconds } = wallClock(new Date(at));
  const offset = Math.round(offsetAt(at) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds)}`;
  return `${date}T${clock}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** The instant at which the Damascus wall clock shows `time` on `date`. */
export function businessInstant(date: LocalDate, time: TimeOfDay): Date {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutesOfDay(time) * 60_000;
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  return new Date(second);
}
