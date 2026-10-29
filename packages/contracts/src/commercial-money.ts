import {
  type AgreementRecord,
  type AgreementTerm,
  type CommissionChannel,
  isTermInForce,
  type RecurringTermValues,
  startOfBusinessDate,
  termsInForce,
} from './commercial.js';
import { DomainError } from './errors.js';
import { type CurrencyCode, type Money, money } from './money.js';
import { addDays, type LocalDate } from './time.js';

/**
 * The money of an agreement (spec S05 rules 29–33, ADR 0014, 0036): pure functions that price a
 * commission, Vertex's share of a delivery fee and a recurring charge with the terms in force at
 * the time. S25 and S21 call them, so every statement is recomputed from stored rows. Integer
 * minor units only; amounts in different currencies are never summed.
 */

/** `round_half_up(amount × bp / 10000)` on non-negative integers. */
function percentOf(amount: number, basisPoints: number): bigint {
  const product = BigInt(amount) * BigInt(basisPoints);
  return (product * 2n + 10_000n) / 20_000n;
}

function nonNegative(amount: number, field: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new DomainError('INVALID_AMOUNT', `${field} must be a whole amount of at least zero`);
  }
}

export type CommissionInput = {
  channel: CommissionChannel;
  /** The order's currency. */
  currency: CurrencyCode;
  /** The item lines, in the order's currency. */
  itemsSubtotal: number;
  /** The restaurant's share of discounts on the items (a co-funded discount: its part only). */
  restaurantFundedDiscount: number;
  /** When the customer placed the order. */
  placedAt: Date;
};

export type Commission = {
  /** The percentage part, in the order's currency. */
  percentage: Money;
  /** The fixed part, in the term's currency, never converted; null without one. */
  fixed: Money | null;
  /** The commission term in force at `placedAt`, if any. */
  termId: string | null;
  waived: boolean;
};

/**
 * The commission of a completed online order (rule 30): the channel's `commission` term in force
 * when the customer placed it, on the item lines after restaurant-funded discounts, excluding the
 * delivery fee, the service charge and tax. A waiver of the channel in force then makes it zero.
 * Only `marketplace` and `web` orders carry commission; in-store orders never do.
 */
export function commissionFor(input: CommissionInput, agreement: AgreementRecord): Commission {
  nonNegative(input.itemsSubtotal, 'itemsSubtotal');
  nonNegative(input.restaurantFundedDiscount, 'restaurantFundedDiscount');
  const slots = termsInForce(agreement, input.placedAt);
  const term = slots.get(`commission:${input.channel}`);
  const zero = money(0, input.currency);
  if (term?.values.kind !== 'commission') {
    return { percentage: zero, fixed: null, termId: null, waived: false };
  }
  const fixedTerm = term.values.fixed;
  if (slots.has(`waiver:commission:${input.channel}`)) {
    return {
      percentage: zero,
      fixed: fixedTerm ? money(0, fixedTerm.currency) : null,
      termId: term.id,
      waived: true,
    };
  }
  const base = Math.max(0, input.itemsSubtotal - input.restaurantFundedDiscount);
  return {
    percentage: money(Number(percentOf(base, term.values.percentBp)), input.currency),
    fixed: fixedTerm ? money(fixedTerm.amount, fixedTerm.currency) : null,
    termId: term.id,
    waived: false,
  };
}

export type DeliveryFeeShare = { share: Money; termId: string | null; waived: boolean };

/**
 * Vertex's share of the delivery fee of a Vertex-fleet job (rule 31), in the order's currency,
 * with the `delivery_fee_share` term in force when the customer placed the order.
 */
export function deliveryFeeShareFor(
  input: { deliveryFee: number; currency: CurrencyCode; placedAt: Date },
  agreement: AgreementRecord,
): DeliveryFeeShare {
  nonNegative(input.deliveryFee, 'deliveryFee');
  const slots = termsInForce(agreement, input.placedAt);
  const term = slots.get('delivery_fee_share');
  const zero = money(0, input.currency);
  if (term?.values.kind !== 'delivery_fee_share')
    return { share: zero, termId: null, waived: false };
  if (slots.has('waiver:delivery_fee_share')) return { share: zero, termId: term.id, waived: true };
  return {
    share: money(Number(percentOf(input.deliveryFee, term.values.percentBp)), input.currency),
    termId: term.id,
    waived: false,
  };
}

/** A Damascus calendar month, `YYYY-MM`. */
export type BusinessMonth = string;

function monthDates(month: BusinessMonth): LocalDate[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Bad month ${month}`);
  const dates: LocalDate[] = [];
  for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) dates.push(date);
  return dates;
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** A branch as the per-branch count reads it, from `branches.created_at` and `archived_at`. */
export type BranchPeriod = { createdAt: Date; archivedAt: Date | null };

/**
 * One month of a `subscription` or `listing_fee` term (rule 32). A day is charged when the term is
 * in force at its start and no waiver of the slot is. A `month` term charges `amount × days /
 * daysInMonth`, a `year` term `amount × days / daysInYear`; per active branch, each charged day
 * counts the branches that existed at its end and were not archived at its start. Rounded half up
 * once, in the term's currency.
 */
export function recurringChargeFor(
  term: AgreementTerm,
  agreement: AgreementRecord,
  month: BusinessMonth,
  branches: readonly BranchPeriod[],
): Money {
  if (term.values.kind !== 'subscription' && term.values.kind !== 'listing_fee') {
    throw new Error(`${term.values.kind} is not a recurring charge`);
  }
  const values: RecurringTermValues = term.values;
  const dates = monthDates(month);
  const waivers = agreement.terms.filter(
    (candidate) =>
      candidate.values.kind === 'waiver' && candidate.values.waives.kind === values.kind,
  );
  let units = 0n;
  for (const date of dates) {
    const start = startOfBusinessDate(date);
    if (!isTermInForce(term, agreement.endings, start)) continue;
    if (waivers.some((waiver) => isTermInForce(waiver, agreement.endings, start))) continue;
    if (values.per === 'tenant') {
      units += 1n;
      continue;
    }
    const end = startOfBusinessDate(addDays(date, 1));
    const active = branches.filter(
      (branch) =>
        branch.createdAt.getTime() < end.getTime() &&
        (branch.archivedAt === null || branch.archivedAt.getTime() > start.getTime()),
    ).length;
    units += BigInt(active);
  }
  const divisor = BigInt(
    values.period === 'month' ? dates.length : daysInYear(Number(month.slice(0, 4))),
  );
  const amount = (BigInt(values.amount) * units * 2n + divisor) / (divisor * 2n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('INVALID_AMOUNT', 'The charge is out of range');
  }
  return money(Number(amount), values.currency);
}
