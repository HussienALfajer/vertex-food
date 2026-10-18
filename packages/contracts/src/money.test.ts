import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  add,
  compare,
  convert,
  currencies,
  currencyCodeSchema,
  exchangeRateSchema,
  formatAmount,
  type Money,
  money,
  moneySchema,
  multiply,
  negate,
  parseAmount,
  subtract,
  sum,
} from './money.js';

const usd = (amount: number) => money(amount, 'USD');
const tl = (amount: number) => money(amount, 'TRY');
const syp = (amount: number) => money(amount, 'SYP');
const MAX = Number.MAX_SAFE_INTEGER;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('currencies', () => {
  it('are USD, TRY and SYP, each with two decimals (ADR 0014; SYP pending Q11)', () => {
    expect(currencies).toEqual({
      USD: { exponent: 2 },
      TRY: { exponent: 2 },
      SYP: { exponent: 2 },
    });
    expect(currencyCodeSchema.options).toEqual(['USD', 'TRY', 'SYP']);
    expect(currencyCodeSchema.safeParse('EUR').success).toBe(false);
    expect(currencyCodeSchema.safeParse('usd').success).toBe(false);
  });
});

describe('money', () => {
  it('holds whole minor units with a currency', () => {
    expect(usd(1250)).toEqual({ amount: 1250, currency: 'USD' });
    expect(usd(-1)).toEqual({ amount: -1, currency: 'USD' });
  });

  it('refuses fractions, non-numbers and unsafe integers', () => {
    expect(refusal(() => usd(12.5))).toBe('INVALID_AMOUNT');
    expect(refusal(() => usd(Number.NaN))).toBe('INVALID_AMOUNT');
    expect(refusal(() => usd(Number.POSITIVE_INFINITY))).toBe('INVALID_AMOUNT');
    expect(refusal(() => usd(MAX + 1))).toBe('INVALID_AMOUNT');
    expect(usd(MAX).amount).toBe(MAX);
  });

  it('normalizes negative zero', () => {
    expect(Object.is(usd(-0).amount, 0)).toBe(true);
  });

  it('validates its wire shape', () => {
    expect(moneySchema.parse({ amount: 500, currency: 'TRY' })).toEqual(tl(500));
    expect(moneySchema.safeParse({ amount: 5.5, currency: 'TRY' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: MAX + 1, currency: 'TRY' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: '500', currency: 'TRY' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 500 }).success).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and negates in one currency', () => {
    expect(add(usd(1050), usd(250))).toEqual(usd(1300));
    expect(subtract(usd(1000), usd(1250))).toEqual(usd(-250));
    expect(negate(usd(700))).toEqual(usd(-700));
    expect(negate(usd(0))).toEqual(usd(0));
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    expect(add(usd(10), usd(20))).toEqual(usd(30));
    expect(
      sum(
        'USD',
        Array.from({ length: 10 }, () => usd(10)),
      ),
    ).toEqual(usd(100));
  });

  it('refuses to combine currencies', () => {
    expect(refusal(() => add(usd(1), tl(1)))).toBe('CURRENCY_MISMATCH');
    expect(refusal(() => subtract(syp(1), usd(1)))).toBe('CURRENCY_MISMATCH');
    expect(refusal(() => compare(usd(1), syp(1)))).toBe('CURRENCY_MISMATCH');
    expect(refusal(() => sum('USD', [usd(1), tl(1)]))).toBe('CURRENCY_MISMATCH');
  });

  it('refuses results outside the safe range instead of rounding', () => {
    expect(refusal(() => add(usd(MAX), usd(1)))).toBe('INVALID_AMOUNT');
    expect(refusal(() => subtract(usd(-MAX), usd(1)))).toBe('INVALID_AMOUNT');
    expect(refusal(() => multiply(usd(MAX), 2))).toBe('INVALID_AMOUNT');
  });

  it('multiplies by whole quantities only', () => {
    expect(multiply(usd(1250), 3)).toEqual(usd(3750));
    expect(multiply(usd(1250), -1)).toEqual(usd(-1250));
    expect(multiply(usd(1250), 0)).toEqual(usd(0));
    expect(refusal(() => multiply(usd(1250), 1.5))).toBe('INVALID_AMOUNT');
  });

  it('sums an empty list to zero in the given currency', () => {
    expect(sum('SYP', [])).toEqual(syp(0));
    expect(sum('TRY', [tl(100), tl(-30), tl(5)])).toEqual(tl(75));
  });

  it('compares amounts', () => {
    expect(compare(usd(1), usd(2))).toBe(-1);
    expect(compare(usd(2), usd(2))).toBe(0);
    expect(compare(usd(3), usd(-2))).toBe(1);
  });
});

describe('exchange rates', () => {
  it('are exact positive decimals between two currencies', () => {
    expect(exchangeRateSchema.safeParse({ from: 'USD', to: 'TRY', rate: '41.25' }).success).toBe(
      true,
    );
    for (const rate of ['0', '0.000', '-1', '1e3', '1,5', '01.5', '.5', '1.', '', ' 2']) {
      expect(exchangeRateSchema.safeParse({ from: 'USD', to: 'TRY', rate }).success, rate).toBe(
        false,
      );
    }
    expect(exchangeRateSchema.safeParse({ from: 'USD', to: 'USD', rate: '1' }).success).toBe(false);
  });

  it('are at most 32 characters', () => {
    const long = `1.${'1'.repeat(30)}`;
    expect(exchangeRateSchema.safeParse({ from: 'USD', to: 'TRY', rate: long }).success).toBe(true);
    expect(exchangeRateSchema.safeParse({ from: 'USD', to: 'TRY', rate: `${long}1` }).success).toBe(
      false,
    );
  });
});

describe('convert', () => {
  it('applies the rate across minor units', () => {
    expect(convert(usd(10000), { from: 'USD', to: 'TRY', rate: '41.25' })).toEqual(tl(412500));
    expect(convert(usd(1), { from: 'USD', to: 'SYP', rate: '110' })).toEqual(syp(110));
    expect(convert(tl(412500), { from: 'TRY', to: 'USD', rate: '0.0242424' })).toEqual(usd(10000));
  });

  it('rounds half away from zero', () => {
    // 0.05 USD at 0.5 TRY = 0.025 TRY → 0.03 TRY; 0.01 USD at 0.4 TRY = 0.004 TRY → 0.00 TRY.
    expect(convert(usd(5), { from: 'USD', to: 'TRY', rate: '0.5' })).toEqual(tl(3));
    expect(convert(usd(-5), { from: 'USD', to: 'TRY', rate: '0.5' })).toEqual(tl(-3));
    expect(convert(usd(1), { from: 'USD', to: 'TRY', rate: '0.4' })).toEqual(tl(0));
    expect(convert(usd(-1), { from: 'USD', to: 'TRY', rate: '0.4' })).toEqual(tl(0));
    expect(convert(usd(1), { from: 'USD', to: 'TRY', rate: '0.6' })).toEqual(tl(1));
  });

  it('keeps precision for large amounts and long rates', () => {
    expect(convert(usd(123456789012), { from: 'USD', to: 'SYP', rate: '13950.123456789' })).toEqual(
      syp(1722237448296152),
    );
  });

  it('refuses a rate for another currency, an invalid rate and an overflow', () => {
    expect(refusal(() => convert(tl(1), { from: 'USD', to: 'SYP', rate: '2' }))).toBe(
      'CURRENCY_MISMATCH',
    );
    expect(() => convert(usd(1), { from: 'USD', to: 'SYP', rate: '-2' })).toThrow();
    expect(refusal(() => convert(usd(MAX), { from: 'USD', to: 'SYP', rate: '2' }))).toBe(
      'INVALID_AMOUNT',
    );
  });
});

describe('parseAmount', () => {
  const cases: [string, Money][] = [
    ['1250', usd(125000)],
    ['1250.5', usd(125050)],
    ['1250.50', usd(125050)],
    ['0.07', usd(7)],
    ['12.', usd(1200)],
    ['  42 ', usd(4200)],
    ['-3.75', usd(-375)],
    ['007', usd(700)],
    ['١٢٥٠٫٥', usd(125050)],
    ['۱۲۵۰.۵', usd(125050)],
  ];

  it.each(cases)('reads %j', (input, expected) => {
    expect(parseAmount(input, expected.currency)).toEqual(expected);
  });

  it.each(['', '-', '.5', '1,250', '1 250', '12.345', '1e3', '+5', '١٢,٥', 'abc'])(
    'refuses %j',
    (input) => {
      expect(refusal(() => parseAmount(input, 'USD'))).toBe('INVALID_AMOUNT');
    },
  );

  it('refuses amounts outside the safe range', () => {
    expect(refusal(() => parseAmount('90071992547409.92', 'USD'))).toBe('INVALID_AMOUNT');
    expect(parseAmount('90071992547409.91', 'USD')).toEqual(usd(MAX));
  });
});

describe('formatAmount', () => {
  it.each<[Money, string]>([
    [usd(0), '0.00'],
    [usd(7), '0.07'],
    [usd(-7), '-0.07'],
    [usd(125050), '1,250.50'],
    [tl(-100000000), '-1,000,000.00'],
    [syp(99999), '999.99'],
    [usd(MAX), '90,071,992,547,409.91'],
  ])('writes %j as %s', (amount, text) => {
    expect(formatAmount(amount)).toBe(text);
  });

  it('round-trips through parseAmount once grouping is removed', () => {
    for (const amount of [0, 1, -1, 99, 100, 123456, -98765432]) {
      const text = formatAmount(usd(amount)).replaceAll(',', '');
      expect(parseAmount(text, 'USD')).toEqual(usd(amount));
    }
  });
});
