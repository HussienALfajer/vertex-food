import { describe, expect, it } from 'vitest';
import type { AgreementRecord, AgreementTerm, TermValues } from './commercial.js';
import { commissionFor, deliveryFeeShareFor, recurringChargeFor } from './commercial-money.js';
import { businessInstant } from './time.js';

const at = (date: string, time = '00:00') => businessInstant(date, time);

let sequence = 0;

function term(values: TermValues, from: string, to: string | null = null): AgreementTerm {
  sequence += 1;
  return {
    id: `01900000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    values,
    effectiveFrom: at(from),
    effectiveTo: to ? at(to) : null,
    dueOn: null,
  };
}

const record = (...terms: AgreementTerm[]): AgreementRecord => ({ terms, endings: [] });

describe('commissionFor', () => {
  const marketplace = term(
    { kind: 'commission', channel: 'marketplace', percentBp: 1000 },
    '2026-10-01',
    '2026-12-01',
  );
  const web = term(
    { kind: 'commission', channel: 'web', percentBp: 0, fixed: { amount: 50, currency: 'USD' } },
    '2026-10-01',
  );
  const agreement = record(marketplace, web);
  const order = {
    channel: 'marketplace' as const,
    currency: 'TRY' as const,
    itemsSubtotal: 100_000,
    restaurantFundedDiscount: 0,
    placedAt: at('2026-11-10', '20:00'),
  };

  it('takes the percentage of the item lines in the order’s currency', () => {
    expect(commissionFor(order, agreement)).toEqual({
      percentage: { amount: 10_000, currency: 'TRY' },
      fixed: null,
      termId: marketplace.id,
      waived: false,
    });
  });

  it('counts only the restaurant’s share of discounts against the base', () => {
    // A co-funded discount of 20 000: the caller passes the restaurant's 12 000 only.
    expect(
      commissionFor({ ...order, restaurantFundedDiscount: 12_000 }, agreement).percentage.amount,
    ).toBe(8_800);
  });

  it('keeps the fixed part in the term’s currency, never converted', () => {
    expect(commissionFor({ ...order, channel: 'web' }, agreement)).toEqual({
      percentage: { amount: 0, currency: 'TRY' },
      fixed: { amount: 50, currency: 'USD' },
      termId: web.id,
      waived: false,
    });
    const both = record(
      term(
        {
          kind: 'commission',
          channel: 'web',
          percentBp: 500,
          fixed: { amount: 25, currency: 'USD' },
        },
        '2026-10-01',
      ),
    );
    const result = commissionFor({ ...order, channel: 'web' }, both);
    expect(result.percentage).toEqual({ amount: 5_000, currency: 'TRY' });
    expect(result.fixed).toEqual({ amount: 25, currency: 'USD' });
  });

  it('rounds half up once per order', () => {
    const tenth = record(
      term({ kind: 'commission', channel: 'web', percentBp: 150 }, '2026-10-01'),
    );
    const web = { ...order, channel: 'web' as const };
    expect(commissionFor({ ...web, itemsSubtotal: 333 }, tenth).percentage.amount).toBe(5); // 4.995
    expect(commissionFor({ ...web, itemsSubtotal: 100 }, tenth).percentage.amount).toBe(2); // 1.5
    expect(commissionFor({ ...web, itemsSubtotal: 99 }, tenth).percentage.amount).toBe(1); // 1.485
  });

  it('uses the term in force when the customer placed the order (edge case 8)', () => {
    expect(commissionFor({ ...order, placedAt: at('2026-12-01') }, agreement)).toMatchObject({
      percentage: { amount: 0 },
      termId: null,
    });
    expect(
      commissionFor({ ...order, placedAt: at('2026-11-30', '23:59') }, agreement).percentage.amount,
    ).toBe(10_000);
  });

  it('is zero while a waiver of the channel is in force', () => {
    const waived = record(
      marketplace,
      web,
      term(
        { kind: 'waiver', waives: { kind: 'commission', channel: 'web' } },
        '2026-11-01',
        '2026-11-15',
      ),
    );
    expect(commissionFor({ ...order, channel: 'web' }, waived)).toEqual({
      percentage: { amount: 0, currency: 'TRY' },
      fixed: { amount: 0, currency: 'USD' },
      termId: web.id,
      waived: true,
    });
    expect(commissionFor(order, waived).percentage.amount).toBe(10_000);
  });
});

describe('deliveryFeeShareFor', () => {
  const share = term({ kind: 'delivery_fee_share', percentBp: 2500 }, '2026-10-01');

  it('takes Vertex’s share of the fee in the order’s currency, rounded half up', () => {
    const input = { deliveryFee: 1_002, currency: 'SYP' as const, placedAt: at('2026-11-10') };
    expect(deliveryFeeShareFor(input, record(share))).toEqual({
      share: { amount: 251, currency: 'SYP' },
      termId: share.id,
      waived: false,
    });
    expect(deliveryFeeShareFor(input, record()).share.amount).toBe(0);
    const waived = record(
      share,
      term({ kind: 'waiver', waives: { kind: 'delivery_fee_share' } }, '2026-11-01'),
    );
    expect(deliveryFeeShareFor(input, waived)).toMatchObject({
      share: { amount: 0 },
      waived: true,
    });
  });
});

describe('recurringChargeFor', () => {
  const monthly = (
    per: 'tenant' | 'active_branch',
    from = '2026-01-01',
    to: string | null = null,
  ) =>
    term({ kind: 'subscription', amount: 3_000, currency: 'USD', period: 'month', per }, from, to);

  it('charges a whole month in full', () => {
    const sub = monthly('tenant');
    expect(recurringChargeFor(sub, record(sub), '2026-11', [])).toEqual({
      amount: 3_000,
      currency: 'USD',
    });
  });

  it('prorates a start and an end within the month by day', () => {
    const start = monthly('tenant', '2026-11-16');
    expect(recurringChargeFor(start, record(start), '2026-11', []).amount).toBe(1_500);
    const ended = monthly('tenant', '2026-01-01', '2026-11-11');
    expect(recurringChargeFor(ended, record(ended), '2026-11', []).amount).toBe(1_000);
    expect(recurringChargeFor(ended, record(ended), '2026-12', []).amount).toBe(0);
  });

  it('counts February in leap and normal years', () => {
    const sub = term(
      { kind: 'subscription', amount: 2_900, currency: 'USD', period: 'month', per: 'tenant' },
      '2027-02-15',
    );
    expect(recurringChargeFor(sub, record(sub), '2027-02', []).amount).toBe(1_450); // 14 / 28
    const leap = term(
      { kind: 'subscription', amount: 2_900, currency: 'USD', period: 'month', per: 'tenant' },
      '2028-02-15',
    );
    expect(recurringChargeFor(leap, record(leap), '2028-02', []).amount).toBe(1_500); // 15 / 29
  });

  it('charges a yearly term by the days of the year', () => {
    const yearly = term(
      { kind: 'listing_fee', amount: 36_500, currency: 'USD', period: 'year', per: 'tenant' },
      '2026-01-01',
    );
    expect(recurringChargeFor(yearly, record(yearly), '2026-01', []).amount).toBe(3_100);
    const leap = term(
      { kind: 'listing_fee', amount: 36_600, currency: 'USD', period: 'year', per: 'tenant' },
      '2028-01-01',
    );
    expect(recurringChargeFor(leap, record(leap), '2028-02', []).amount).toBe(2_900);
  });

  it('frees only the waived days (edge case 5)', () => {
    const sub = monthly('tenant');
    const waiver = term(
      { kind: 'waiver', waives: { kind: 'subscription' } },
      '2026-11-01',
      '2026-11-11',
    );
    expect(recurringChargeFor(sub, record(sub, waiver), '2026-11', []).amount).toBe(2_000);
    const listingWaiver = term({ kind: 'waiver', waives: { kind: 'listing_fee' } }, '2026-11-01');
    expect(recurringChargeFor(sub, record(sub, listingWaiver), '2026-11', []).amount).toBe(3_000);
  });

  it('counts branches active each day, added and archived mid-month (edge case 6)', () => {
    const sub = monthly('active_branch');
    const branches = [
      { createdAt: at('2025-06-01'), archivedAt: null },
      // Created on the 21st at noon: counted from that day, 10 days.
      { createdAt: at('2026-11-21', '12:00'), archivedAt: null },
      // Archived on the 6th at 10:00: counted up to that day, 6 days.
      { createdAt: at('2025-06-01'), archivedAt: at('2026-11-06', '10:00') },
    ];
    // (30 + 10 + 6) × 3000 / 30 = 4600.
    expect(recurringChargeFor(sub, record(sub), '2026-11', branches).amount).toBe(4_600);
  });

  it('rounds half up once per term per month', () => {
    const sub = term(
      { kind: 'subscription', amount: 1_000, currency: 'TRY', period: 'month', per: 'tenant' },
      '2026-11-30',
    );
    // 1000 × 1 / 30 = 33.33 → 33; 2000 × 1 / 30 = 66.67 → 67.
    expect(recurringChargeFor(sub, record(sub), '2026-11', []).amount).toBe(33);
    const double = term(
      { kind: 'subscription', amount: 2_000, currency: 'TRY', period: 'month', per: 'tenant' },
      '2026-11-30',
    );
    expect(recurringChargeFor(double, record(double), '2026-11', []).amount).toBe(67);
  });

  it('refuses a term that is not a recurring charge', () => {
    const share = term({ kind: 'delivery_fee_share', percentBp: 1 }, '2026-01-01');
    expect(() => recurringChargeFor(share, record(share), '2026-11', [])).toThrow();
  });
});
