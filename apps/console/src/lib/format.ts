import { displayTimeZone, formatLocale } from '@vertex-food/i18n';

/** Times are shown in Syria's time zone, whatever the computer's setting (ADR 0020). */
const dateTime = new Intl.DateTimeFormat(formatLocale, {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: displayTimeZone,
});

/** A date and time from the API, in Arabic with Latin digits. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}
