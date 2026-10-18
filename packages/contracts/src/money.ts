import { z } from 'zod';
import { DomainError } from './errors.js';

/**
 * Money (ADR 0014): integer minor units with an explicit ISO 4217 currency and exponent, never
 * floats. Amounts are stored as PostgreSQL `bigint` and carried as JavaScript safe integers, so
 * they cross JSON, SQLite and every client unchanged; any result outside the safe range is
 * refused, never rounded.
 */
export const currencies = {
  USD: { exponent: 2 },
  TRY: { exponent: 2 },
  // The ISO 4217 value. The code and exponent of the pound redenominated in 2026 are open question
  // Q11 (answered with Vertex Shifa Q13); until then SYP with two decimals.
  SYP: { exponent: 2 },
} as const satisfies Record<string, { exponent: number }>;

export type CurrencyCode = keyof typeof currencies;

const currencyCodes = Object.keys(currencies) as [CurrencyCode, ...CurrencyCode[]];

/**
 * The exponent of each code travels with the schema (`x-exponents` in its JSON Schema), so a client
 * that does not run TypeScript reads `{ amount: 125050, currency: 'SYP' }` from the contract, not
 * from a copy of this table.
 */
export const currencyCodeSchema = z.enum(currencyCodes).meta({
  id: 'CurrencyCode',
  description: 'ISO 4217 code; amounts are integers in minor units of 10^-exponent.',
  'x-exponents': Object.fromEntries(currencyCodes.map((code) => [code, currencies[code].exponent])),
});

export const moneySchema = z
  .object({
    /** Minor units (cents, kuruş, piastres), a safe integer. */
    amount: z.int(),
    currency: currencyCodeSchema,
  })
  .meta({ id: 'Money' });

export type Money = z.infer<typeof moneySchema>;

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Units of `to` for one unit of `from`, as a decimal string so it is stored exactly; every
 * conversion stores the rate it used (ADR 0014).
 */
export const exchangeRateSchema = z
  .object({
    from: currencyCodeSchema,
    to: currencyCodeSchema,
    rate: z
      .string()
      .max(32)
      .regex(DECIMAL)
      .refine((rate) => /[1-9]/.test(rate), 'The rate must be above zero'),
  })
  .refine((rate) => rate.from !== rate.to, 'A rate converts between two different currencies')
  .meta({ id: 'ExchangeRate' });

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

function checked(amount: number | bigint, currency: CurrencyCode): Money {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || BigInt(value) !== BigInt(amount)) {
    throw new DomainError('INVALID_AMOUNT', `Amount out of range for ${currency}`);
  }
  // `+ 0` turns -0 into 0, so equal amounts compare equal.
  return { amount: value + 0, currency };
}

function sameCurrency(a: Money, b: Money): CurrencyCode {
  if (a.currency !== b.currency) {
    throw new DomainError('CURRENCY_MISMATCH', `Cannot combine ${a.currency} with ${b.currency}`);
  }
  return a.currency;
}

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amount)) {
    throw new DomainError('INVALID_AMOUNT', 'Money amounts are whole minor units');
  }
  return checked(amount, currency);
}

export function add(a: Money, b: Money): Money {
  return checked(BigInt(a.amount) + BigInt(b.amount), sameCurrency(a, b));
}

export function subtract(a: Money, b: Money): Money {
  return checked(BigInt(a.amount) - BigInt(b.amount), sameCurrency(a, b));
}

export function negate(a: Money): Money {
  return checked(-a.amount, a.currency);
}

/** A line total: a price times a whole quantity. */
export function multiply(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new DomainError('INVALID_AMOUNT', 'Quantities are whole numbers');
  }
  return checked(BigInt(a.amount) * BigInt(quantity), a.currency);
}

/** The total of amounts in one currency; mixed currencies are summed per currency by the caller. */
export function sum(currency: CurrencyCode, amounts: readonly Money[]): Money {
  return amounts.reduce(add, money(0, currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/** Divides and rounds half away from zero (1.5 → 2, -1.5 → -2); `divisor` is positive. */
function divideRounded(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < divisor) return quotient;
  return dividend < 0n ? quotient - 1n : quotient + 1n;
}

/** Converts with a stated rate, rounding half away from zero to the target's minor unit. */
export function convert(a: Money, exchangeRate: ExchangeRate): Money {
  const rate = exchangeRateSchema.parse(exchangeRate);
  if (a.currency !== rate.from) {
    throw new DomainError('CURRENCY_MISMATCH', `The rate converts ${rate.from}, not ${a.currency}`);
  }
  const [whole = '', fraction = ''] = rate.rate.split('.');
  const rateUnits = BigInt(whole + fraction);
  const dividend = BigInt(a.amount) * rateUnits * 10n ** BigInt(currencies[rate.to].exponent);
  const divisor = 10n ** BigInt(fraction.length + currencies[rate.from].exponent);
  return checked(divideRounded(dividend, divisor), rate.to);
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * Reads an amount typed by a person ("1250", "1250.5", "-3.75"). Arabic-Indic digits and the
 * Arabic decimal separator are accepted; grouping separators and more decimals than the currency
 * has are refused rather than guessed.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money {
  const text = input
    .trim()
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
    .replace('٫', '.');
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  const { exponent } = currencies[currency];
  const fraction = match?.[3] ?? '';
  if (!match || fraction.length > exponent) {
    throw new DomainError('INVALID_AMOUNT', `Not a valid ${currency} amount`);
  }
  const units = BigInt(`${match[2]}${fraction.padEnd(exponent, '0')}`);
  return checked(match[1] ? -units : units, currency);
}

/** Latin digits with comma grouping and every decimal place: `-1,250.50`. */
export function formatAmount(a: Money): string {
  const { exponent } = currencies[a.currency];
  const digits = Math.abs(a.amount)
    .toString()
    .padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent).replace(/\B(?=(\d{3})+$)/g, ',');
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${a.amount < 0 ? '-' : ''}${whole}${fraction}`;
}
