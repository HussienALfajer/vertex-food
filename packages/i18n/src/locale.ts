/** The interface language (ADR 0018): Arabic first, right to left. */
export const defaultLanguage = 'ar';

export const textDirection = 'rtl';

/**
 * The locale for `Intl` formatting: Arabic with Latin digits (`-u-nu-latn`), never Arabic-Indic
 * digits (ADR 0018).
 */
export const formatLocale = 'ar-u-nu-latn';

/** Times are stored in UTC and shown in Syria's time zone (ADR 0020). */
export const displayTimeZone = 'Asia/Damascus';
