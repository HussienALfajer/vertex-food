import { displayTimeZone, formatLocale } from '@vertex-food/i18n';

/** Times are shown in Syria's time zone, whatever the computer's setting (ADR 0020). */
const dateTime = new Intl.DateTimeFormat(formatLocale, {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: displayTimeZone,
});

/** A calendar date has no time zone: it is formatted as the same day in UTC. */
const date = new Intl.DateTimeFormat(formatLocale, { dateStyle: 'full', timeZone: 'UTC' });

/** A date and time from the API, in Arabic with Latin digits. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** A calendar date (`2026-10-20`), in Arabic with Latin digits. */
export function formatDate(localDate: string): string {
  return date.format(new Date(`${localDate}T00:00:00Z`));
}
