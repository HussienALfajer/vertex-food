import { z } from 'zod';

/**
 * Phone numbers of Syria (`+963`) and Turkey (`+90`), the two networks used in northern Syria,
 * stored and sent in E.164. People type them in local forms (`09…`, `05…`), with spaces, dashes or
 * Arabic-Indic digits; `parsePhoneNumber` turns any of these into one number. Copied from Vertex
 * Shifa. Used by branch contact phones (S01) and, later, staff, customer and driver accounts.
 */
export type PhoneCountry = 'SY' | 'TR';

/** Mobile numbers can receive WhatsApp messages; landlines cannot. */
export type PhoneKind = 'mobile' | 'landline';

export type PhoneNumber = { e164: string; country: PhoneCountry; kind: PhoneKind };

const countries = [
  // Syria: mobile 9XXXXXXXX; landline the area code of a governorate (Damascus and Rif Dimashq 11,
  // Quneitra 14, Daraa 15, As-Suwayda 16, Aleppo 21, Raqqa 22, Idlib 23, Homs 31, Hama 33,
  // Latakia 41, Tartus 43, Deir ez-Zor 51, Al-Hasakah 52) and 6 or 7 digits.
  {
    country: 'SY',
    code: '963',
    mobile: /^9\d{8}$/,
    landline: /^(?:1[1456]|2[123]|3[13]|4[13]|5[12])\d{6,7}$/,
  },
  // Turkey: mobile 5XXXXXXXXX; landline an area code 2XX, 3XX or 4XX and 7 digits.
  { country: 'TR', code: '90', mobile: /^5\d{9}$/, landline: /^[234]\d{9}$/ },
] as const;

const SEPARATORS = /[\s\-().‎‏]/g;

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits to Latin. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => String((digit.charCodeAt(0) - 0x0660) % 0x0090));
}

/**
 * The number `text` names, or undefined when it is not a Syrian or Turkish number. International
 * forms (`+963…`, `00963…`, `+90…`, `0090…`) and local forms with the leading `0` are accepted: a
 * local number of 9 digits after the `0` is Syrian, of 10 digits Turkish.
 */
export function parsePhoneNumber(text: string): PhoneNumber | undefined {
  let digits = latinDigits(text.trim()).replace(SEPARATORS, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) {
    const national = digits.slice(1);
    digits = national.length === 10 ? `90${national}` : `963${national}`;
  } else return undefined;
  if (!/^\d+$/.test(digits)) return undefined;
  for (const { country, code, mobile, landline } of countries) {
    if (!digits.startsWith(code)) continue;
    let national = digits.slice(code.length);
    // `+963 09…` and `+90 05…`: the trunk 0 written after the country code.
    if (national.startsWith('0')) national = national.slice(1);
    const kind = mobile.test(national) ? 'mobile' : landline.test(national) ? 'landline' : null;
    if (kind) return { e164: `+${code}${national}`, country, kind };
  }
  return undefined;
}

/**
 * A Syrian or Turkish phone number. Accepts the local forms and answers E.164, so every number is
 * stored once whatever way it was typed.
 */
export const phoneNumberSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? (parsePhoneNumber(value)?.e164 ?? value) : value),
    z
      .string()
      .regex(/^\+\d{8,15}$/)
      .refine(
        (value) => parsePhoneNumber(value)?.e164 === value,
        'Not a Syrian or Turkish phone number',
      ),
  )
  .meta({ id: 'PhoneNumber' });

/** A mobile number: staff accounts receive OTPs on it (spec S02). */
export const mobilePhoneNumberSchema = phoneNumberSchema
  .refine((value) => parsePhoneNumber(value)?.kind === 'mobile', 'Not a mobile number')
  .meta({ id: 'MobilePhoneNumber' });
