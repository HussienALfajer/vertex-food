/** The interface language (ADR 0018): Arabic first, right to left. */
export const defaultLanguage = 'ar';

export const textDirection = 'rtl';

/**
 * The locale for `Intl` formatting: Syrian Arabic (`ar-SY`), for the month names read in Syria
 * (أيلول، تشرين الأول; `brand/identity.md`), with Latin digits (`-u-nu-latn`), never Arabic-Indic
 * digits (ADR 0018). A runtime without `ar-SY` data falls back to `ar`, keeping Latin digits.
 */
export const formatLocale = 'ar-SY-u-nu-latn';

/** Times are stored in UTC and shown in Syria's time zone (ADR 0020). */
export const displayTimeZone = 'Asia/Damascus';
