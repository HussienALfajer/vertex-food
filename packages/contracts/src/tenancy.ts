import { z } from 'zod';
import { DomainError } from './errors.js';
import { currencyCodeSchema } from './money.js';
import { mobilePhoneNumberSchema, parsePhoneNumber, phoneNumberSchema } from './phone.js';
import {
  coordinatesSchema,
  idSchema,
  instantSchema,
  listQuerySchema,
  pageSchema,
} from './primitives.js';
import {
  addDays,
  businessInstant,
  businessWallClock,
  type LocalDate,
  localDateSchema,
  minutesOfDay,
  type TimeOfDay,
  timeOfDaySchema,
  type Weekday,
  weekdayOf,
  weekdaySchema,
} from './time.js';

/**
 * Tenancy (spec S01, ADR 0004): restaurants (tenants), their slugs and branches, working hours,
 * charge lines and the status lifecycle, with the pure rules every app and the server share.
 */

const MINUTES_PER_DAY = 1440;

/** A note Vertex staff or the owner write for a change; kept in the audit entry only. */
const noteSchema = z.string().trim().min(2).max(500);

export const nameArSchema = z.string().trim().min(2).max(100);

export const nameLatinSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[A-Za-z0-9 &'.-]+$/, "Latin letters, digits, spaces and & ' . - only");

// Status (rules 4–9).

export const tenantStatusSchema = z
  .enum(['onboarding', 'active', 'suspended', 'closed'])
  .meta({ id: 'TenantStatus' });

export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const scheduledTenantStatusSchema = z
  .enum(['suspended', 'closed'])
  .meta({ id: 'ScheduledTenantStatus' });

export type ScheduledTenantStatus = z.infer<typeof scheduledTenantStatusSchema>;

/** Why Vertex suspended or closed a restaurant, as its banner shows it. */
export const tenantStatusReasonSchema = z
  .enum(['non_payment', 'abuse', 'other'])
  .meta({ id: 'TenantStatusReason' });

export type TenantStatusReason = z.infer<typeof tenantStatusReasonSchema>;

/** `immediate`, or at the end of the tenant's current business day (a day is never cut). */
export type StatusChangeTiming = 'immediate' | 'end_of_business_day';

/** Every allowed change of status (spec S01, "Tenant status"). `closed` is final in V1. */
export const tenantStatusTransitions = {
  onboarding: { active: 'immediate', closed: 'immediate' },
  active: { suspended: 'end_of_business_day', closed: 'end_of_business_day' },
  suspended: { active: 'immediate', closed: 'immediate' },
  closed: {},
} as const satisfies Record<TenantStatus, Partial<Record<TenantStatus, StatusChangeTiming>>>;

export function statusChangeTiming(
  from: TenantStatus,
  to: TenantStatus,
): StatusChangeTiming | undefined {
  const allowed: Partial<Record<TenantStatus, StatusChangeTiming>> = tenantStatusTransitions[from];
  return allowed[to];
}

/** The status fields of a tenant row, as the rules read them. */
export type TenantStatusState = {
  status: TenantStatus;
  statusReason: TenantStatusReason | null;
  scheduledStatus: ScheduledTenantStatus | null;
  scheduledStatusReason: TenantStatusReason | null;
  scheduledStatusAt: Date | null;
};

/** A due scheduled change has taken effect, whether or not the job has written it yet (rule 7). */
export function isScheduleDue(tenant: TenantStatusState, now: Date): boolean {
  return (
    tenant.scheduledStatus !== null &&
    tenant.scheduledStatusAt !== null &&
    tenant.scheduledStatusAt.getTime() <= now.getTime()
  );
}

/** The status in force at `now`: every read of the status goes through it (rule 7). */
export function effectiveStatus(tenant: TenantStatusState, now: Date): TenantStatus {
  return isScheduleDue(tenant, now) ? (tenant.scheduledStatus as TenantStatus) : tenant.status;
}

/** The status, its reason and the pending change in force at `now`. */
export function effectiveStatusState(tenant: TenantStatusState, now: Date): TenantStatusState {
  if (!isScheduleDue(tenant, now)) return tenant;
  return {
    status: tenant.scheduledStatus as TenantStatus,
    statusReason: tenant.scheduledStatusReason,
    scheduledStatus: null,
    scheduledStatusReason: null,
    scheduledStatusAt: null,
  };
}

/**
 * The tenant's next business day end after `now` (rule 6): the latest `business_day_ends_at` among
 * its non-archived branches, at its next occurrence on the Damascus wall clock. A request at 03:00
 * with the day ending at 04:00 takes effect at 04:00 the same night.
 */
export function nextBusinessDayEnd(now: Date, businessDayEnds: readonly TimeOfDay[]): Date {
  const latest = [...businessDayEnds].sort().at(-1) ?? DEFAULT_BUSINESS_DAY_END;
  const { date } = businessWallClock(now);
  for (const offset of [0, 1, 2]) {
    const candidate = businessInstant(addDays(date, offset), latest);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new Error('No business day end within two days');
}

export const changeTenantStatusSchema = z
  .object({
    to: z.enum(['active', 'suspended', 'closed']),
    /** Required for `suspended` and `closed`. */
    reason: tenantStatusReasonSchema.optional(),
    note: noteSchema.optional(),
  })
  .refine((change) => change.to === 'active' || change.reason !== undefined, {
    message: 'A suspension or closure needs a reason',
    path: ['reason'],
  })
  .meta({ id: 'ChangeTenantStatus' });

export type ChangeTenantStatus = z.infer<typeof changeTenantStatusSchema>;

export const cancelScheduledTenantStatusSchema = z
  .object({ cancelScheduled: z.literal(true), note: noteSchema.optional() })
  .meta({ id: 'CancelScheduledTenantStatus' });

export const tenantStatusRequestSchema = z
  .union([changeTenantStatusSchema, cancelScheduledTenantStatusSchema])
  .meta({ id: 'TenantStatusRequest' });

export type TenantStatusRequest = z.infer<typeof tenantStatusRequestSchema>;

/** What a status request does to the row. */
export type StatusChangePlan =
  | { kind: 'immediate'; status: TenantStatus; reason: TenantStatusReason | null }
  | { kind: 'scheduled'; status: ScheduledTenantStatus; reason: TenantStatusReason; at: Date };

/**
 * Checks a status request against the tenant's state in force (`effectiveStatusState`) and says
 * what it does (spec S01, "Tenant status"). A request already in force or already scheduled is
 * refused, so a double submit never applies twice; a new scheduled change replaces the pending one
 * (edge case 3). Activation needs completed onboarding (rule 4).
 */
export function planTenantStatusChange(
  tenant: TenantStatusState & { onboardingCompletedAt: Date | null },
  change: ChangeTenantStatus,
  now: Date,
  businessDayEnds: readonly TimeOfDay[],
): StatusChangePlan {
  const timing = statusChangeTiming(tenant.status, change.to);
  if (!timing || tenant.scheduledStatus === change.to) {
    throw new DomainError(
      'INVALID_STATUS_TRANSITION',
      `Tenant status ${tenant.status} cannot become ${change.to}`,
    );
  }
  if (change.to === 'active') {
    if (tenant.status === 'onboarding' && tenant.onboardingCompletedAt === null) {
      throw new DomainError('ONBOARDING_INCOMPLETE', 'Onboarding is not complete');
    }
    return { kind: 'immediate', status: 'active', reason: null };
  }
  const reason = change.reason;
  if (!reason) throw new DomainError('VALIDATION_FAILED', 'A reason is required');
  if (timing === 'immediate') return { kind: 'immediate', status: change.to, reason };
  return {
    kind: 'scheduled',
    status: change.to,
    reason,
    at: nextBusinessDayEnd(now, businessDayEnds),
  };
}

/**
 * Refuses a tenancy write while the tenant is suspended or closed (rules 8, 9); onboarding and
 * active tenants write. Called with the status in force.
 */
export function assertTenantWritable(status: TenantStatus): void {
  if (status === 'suspended') throw new DomainError('TENANT_SUSPENDED', 'The tenant is suspended');
  if (status === 'closed') throw new DomainError('TENANT_CLOSED', 'The tenant is closed');
}

/** After closure the owner keeps online read access and export for this many days (rule 9). */
export const OWNER_READ_DAYS_AFTER_CLOSURE = 90;

export function ownerReadAccessEndsAt(closedAt: Date): Date {
  return new Date(closedAt.getTime() + OWNER_READ_DAYS_AFTER_CLOSURE * 86_400_000);
}

// Slugs (rule 10).

/**
 * Slugs that name the platform's own hosts and pages, never a restaurant's (S15 resolves slugs on
 * the web).
 */
export const reservedSlugs = [
  'about',
  'account',
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'blog',
  'cdn',
  'console',
  'dashboard',
  'dev',
  'docs',
  'driver',
  'drivers',
  'food',
  'help',
  'login',
  'mail',
  'menu',
  'new',
  'order',
  'orders',
  'restaurant',
  'restaurants',
  'shop',
  'signin',
  'signup',
  'staging',
  'static',
  'status',
  'store',
  'support',
  'test',
  'vertex',
  'vertexfood',
  'web',
  'www',
] as const;

/** 3–30 of `[a-z0-9-]`, starting with a letter, no leading, trailing or double `-`. */
export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

export const slugSchema = z.string().regex(SLUG_PATTERN).meta({ id: 'Slug' });

/** A slug as Vertex staff type it; its shape and the reserved list are checked by `assertSlugAllowed`. */
export const setTenantSlugSchema = z
  .object({ slug: z.string().trim().toLowerCase().max(64) })
  .meta({ id: 'SetTenantSlug' });

export type SetTenantSlug = z.infer<typeof setTenantSlugSchema>;

/** Refuses an invalid or reserved slug with `SLUG_RESERVED`; taken slugs are the database's. */
export function assertSlugAllowed(slug: string): void {
  if (!SLUG_PATTERN.test(slug) || (reservedSlugs as readonly string[]).includes(slug)) {
    throw new DomainError('SLUG_RESERVED', 'The slug is reserved or not a valid slug');
  }
}

// Working hours (rules 12–14).

/** Between `00:00` and `08:00`, on the hour or the half hour; default `04:00`. */
export const businessDayEndSchema = z
  .string()
  .regex(/^(0[0-7]:(00|30)|08:00)$/)
  .meta({ id: 'BusinessDayEnd' });

export const DEFAULT_BUSINESS_DAY_END: TimeOfDay = '04:00';

export const MAX_PERIODS_PER_DAY = 2;

export const openingPeriodSchema = z
  .object({ opensAt: timeOfDaySchema, closesAt: timeOfDaySchema })
  .meta({ id: 'OpeningPeriod' });

export type OpeningPeriod = z.infer<typeof openingPeriodSchema>;

/**
 * One opening period of the weekly schedule. `weekday` is the business date it belongs to: a
 * period whose `closesAt` is before its `opensAt` runs past midnight, and a period that opens after
 * midnight but before the business day end belongs to the night of the previous calendar day.
 */
export const weeklyPeriodSchema = z
  .object({ weekday: weekdaySchema, opensAt: timeOfDaySchema, closesAt: timeOfDaySchema })
  .meta({ id: 'WeeklyPeriod' });

export type WeeklyPeriod = z.infer<typeof weeklyPeriodSchema>;

/** Minutes from the start of the business day (`businessDayEndsAt`) to the start and end. */
function span(period: OpeningPeriod, businessDayEndsAt: TimeOfDay) {
  const opens = minutesOfDay(period.opensAt);
  const length = (minutesOfDay(period.closesAt) - opens + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const start = (opens - minutesOfDay(businessDayEndsAt) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { start, end: start + length, length };
}

/** A period runs past midnight on the wall clock (shown as "until 02:00 (next day)"). */
export function isOvernight(period: OpeningPeriod): boolean {
  return minutesOfDay(period.closesAt) < minutesOfDay(period.opensAt);
}

/**
 * Which ends of a period fall on the next calendar day (rule 12). A period that opens after
 * midnight but before the business day end belongs to the previous business date: 01:00–03:00
 * under Saturday with the day ending at 04:00 is Sunday early morning, shown as "01:00 (next day)".
 */
export function periodNextDay(
  period: OpeningPeriod,
  businessDayEndsAt: TimeOfDay,
): { opens: boolean; closes: boolean } {
  const opens = minutesOfDay(period.opensAt) < minutesOfDay(businessDayEndsAt);
  return { opens, closes: opens || isOvernight(period) };
}

function invalidHours(message: string, period: OpeningPeriod & { weekday?: Weekday }): never {
  throw new DomainError('INVALID_HOURS', message, { period });
}

/**
 * The periods of one business date: at most two, none empty, none containing the business day
 * end, none overlapping another (rule 12).
 */
export function validateDayPeriods(
  periods: readonly (OpeningPeriod & { weekday?: Weekday })[],
  businessDayEndsAt: TimeOfDay,
): void {
  const spans = periods.map((period) => {
    const result = span(period, businessDayEndsAt);
    if (result.length === 0) invalidHours('A period opens and closes at the same time', period);
    if (result.end > MINUTES_PER_DAY) {
      invalidHours('A period contains the business day end', period);
    }
    return { period, ...result };
  });
  const [first] = periods;
  if (first && periods.length > MAX_PERIODS_PER_DAY) {
    invalidHours('More than two periods in one day', first);
  }
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (previous && current && current.start < previous.end) {
      invalidHours('Two periods overlap', current.period);
    }
  }
}

/** The weekly schedule, day by day (rule 12). Throws `INVALID_HOURS` with the offending period. */
export function validateWeeklyHours(
  periods: readonly WeeklyPeriod[],
  businessDayEndsAt: TimeOfDay,
): void {
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    validateDayPeriods(
      periods.filter((period) => period.weekday === weekday),
      businessDayEndsAt,
    );
  }
}

/** A dated exception: `closed`, or 1–2 periods under the weekly rules (rule 13). */
export function validateHourException(
  exception: { closed: boolean; periods: readonly OpeningPeriod[] },
  businessDayEndsAt: TimeOfDay,
): void {
  if (exception.closed !== (exception.periods.length === 0)) {
    throw new DomainError(
      'INVALID_HOURS',
      'An exception is closed exactly when it has no periods',
      {},
    );
  }
  validateDayPeriods(exception.periods, businessDayEndsAt);
}

/**
 * The business date of an instant (rule 14): the Damascus calendar date of the wall clock, minus
 * one day before the business day end. With the day ending at 04:00, 02:30 on the 20th belongs to
 * the 19th.
 */
export function businessDateOf(instant: Date | string, businessDayEndsAt: TimeOfDay): LocalDate {
  const { date, minutes } = businessWallClock(instant);
  return minutes < minutesOfDay(businessDayEndsAt) ? addDays(date, -1) : date;
}

export type HourExceptionRule = { date: LocalDate; closed: boolean; periods: OpeningPeriod[] };

/**
 * Whether the branch is open at `instant` (rule 14): the business date's exception if one exists,
 * otherwise that weekday's periods. In V1 this decides only online acceptance (S14 onward); it
 * never blocks the POS.
 */
export function isBranchOpenAt(
  branch: { businessDayEndsAt: TimeOfDay },
  hours: readonly WeeklyPeriod[],
  exceptions: readonly HourExceptionRule[],
  instant: Date | string,
): boolean {
  const date = businessDateOf(instant, branch.businessDayEndsAt);
  const exception = exceptions.find((candidate) => candidate.date === date);
  const periods = exception
    ? exception.closed
      ? []
      : exception.periods
    : hours.filter((period) => period.weekday === weekdayOf(date));
  const { minutes } = businessWallClock(instant);
  const now =
    (minutes - minutesOfDay(branch.businessDayEndsAt) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return periods.some((period) => {
    const { start, end } = span(period, branch.businessDayEndsAt);
    return start <= now && now < end;
  });
}

export const branchHoursSchema = z
  .object({
    businessDayEndsAt: businessDayEndSchema,
    periods: z.array(weeklyPeriodSchema),
    /** The branch's `updatedAt` after the change, for the next write. */
    updatedAt: instantSchema,
  })
  .meta({ id: 'BranchHours' });

export type BranchHours = z.infer<typeof branchHoursSchema>;

export const replaceBranchHoursSchema = z
  .object({
    businessDayEndsAt: businessDayEndSchema,
    periods: z.array(weeklyPeriodSchema).max(14),
    /** The branch's `updatedAt` the client last read (rule 16). */
    updatedAt: instantSchema,
  })
  .meta({ id: 'ReplaceBranchHours' });

export type ReplaceBranchHours = z.infer<typeof replaceBranchHoursSchema>;

const exceptionNoteSchema = z.string().trim().min(1).max(100);

export const hourExceptionSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    date: localDateSchema,
    closed: z.boolean(),
    periods: z.array(openingPeriodSchema).max(MAX_PERIODS_PER_DAY),
    note: z.string().nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'HourException' });

export type HourException = z.infer<typeof hourExceptionSchema>;

export const createHourExceptionSchema = z
  .object({
    date: localDateSchema,
    closed: z.boolean(),
    periods: z.array(openingPeriodSchema).max(MAX_PERIODS_PER_DAY),
    note: exceptionNoteSchema.nullable().optional(),
  })
  .meta({ id: 'CreateHourException' });

export type CreateHourException = z.infer<typeof createHourExceptionSchema>;

export const updateHourExceptionSchema = z
  .object({
    closed: z.boolean(),
    periods: z.array(openingPeriodSchema).max(MAX_PERIODS_PER_DAY),
    note: exceptionNoteSchema.nullable(),
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdateHourException' });

export type UpdateHourException = z.infer<typeof updateHourExceptionSchema>;

// Sales channels and charge lines (rule 15).

/**
 * How a branch sells (ADR 0025: a platform name): on its premises, to take away, delivered, or
 * collected after ordering ahead. The food domain's order types are these channels (glossary:
 * صالة، سفري، توصيل، استلام); the values are stored and never renamed.
 */
export const salesChannelSchema = z
  .enum(['dine_in', 'takeaway', 'delivery', 'pickup'])
  .meta({ id: 'SalesChannel' });

export type SalesChannel = z.infer<typeof salesChannelSchema>;

export const MAX_CHARGE_LINES = 3;

export const chargeKindSchema = z.enum(['tax', 'service']).meta({ id: 'ChargeKind' });

/** `inclusive`: already inside the prices; `added`: on top of them. */
export const chargeModeSchema = z.enum(['inclusive', 'added']).meta({ id: 'ChargeMode' });

const chargeNameLatinSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9 &'.%-]+$/, "Latin letters, digits, spaces and & ' . % - only");

export const branchChargeInputSchema = z
  .object({
    kind: chargeKindSchema,
    nameAr: z.string().trim().min(2).max(40),
    nameLatin: chargeNameLatinSchema.nullable().optional(),
    /** Basis points: 1 = 0.01 %, 5000 = 50 %. */
    rateBp: z.int().min(1).max(5000),
    mode: chargeModeSchema,
    salesChannels: z
      .array(salesChannelSchema)
      .min(1)
      .max(4)
      .refine((channels) => new Set(channels).size === channels.length, 'A channel appears twice'),
  })
  .meta({ id: 'BranchChargeInput' });

export type BranchChargeInput = z.infer<typeof branchChargeInputSchema>;

export const branchChargeSchema = z
  .object({
    id: idSchema,
    kind: chargeKindSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    rateBp: z.int(),
    mode: chargeModeSchema,
    salesChannels: z.array(salesChannelSchema),
    /** Display and computation order, from 1. */
    position: z.int().min(1),
  })
  .meta({ id: 'BranchCharge' });

export type BranchCharge = z.infer<typeof branchChargeSchema>;

/** The lines after `PUT /api/branches/:id/charges`, with the branch's new `updatedAt`. */
export const branchChargesSchema = z
  .object({
    lines: z.array(branchChargeSchema),
    /** The branch's `updatedAt` after the change, for the next write. */
    updatedAt: instantSchema,
  })
  .meta({ id: 'BranchCharges' });

export type BranchCharges = z.infer<typeof branchChargesSchema>;

/** The lines in order; their position is their place in the list. */
export const replaceBranchChargesSchema = z
  .object({
    lines: z.array(branchChargeInputSchema).max(MAX_CHARGE_LINES),
    /** The branch's `updatedAt` the client last read (rule 16). */
    updatedAt: instantSchema,
  })
  .meta({ id: 'ReplaceBranchCharges' });

export type ReplaceBranchCharges = z.infer<typeof replaceBranchChargesSchema>;

/** `10 %` from 1000, `2.5 %` from 250: basis points as text, without floating point. */
export function formatRateBp(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100);
  const fraction = String(rateBp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

// Branches.

export const BRANCH_CODE_PATTERN = /^[a-z0-9-]{2,20}$/;

export const branchCodeSchema = z.string().regex(BRANCH_CODE_PATTERN).meta({ id: 'BranchCode' });

export const MAX_CONTACT_PHONES = 3;

export const contactPhoneSchema = z
  .object({ phone: phoneNumberSchema, whatsapp: z.boolean() })
  .refine((entry) => !entry.whatsapp || parsePhoneNumber(entry.phone)?.kind === 'mobile', {
    message: 'WhatsApp is only on mobile numbers',
    path: ['whatsapp'],
  })
  .meta({ id: 'ContactPhone' });

export type ContactPhone = z.infer<typeof contactPhoneSchema>;

export const contactPhonesSchema = z
  .array(contactPhoneSchema)
  .max(MAX_CONTACT_PHONES)
  .refine(
    (phones) => new Set(phones.map((entry) => entry.phone)).size === phones.length,
    'A phone appears twice',
  );

const addressDescriptionSchema = z.string().trim().min(2).max(300);

const acceptedCurrenciesSchema = z
  .array(currencyCodeSchema)
  .min(1)
  .refine((codes) => new Set(codes).size === codes.length, 'A currency appears twice');

/** The branch's idle lock (spec S02 rule 32): 1 to 60 minutes, 5 by default. */
export const idleLockMinutesSchema = z.int().min(1).max(60).meta({ id: 'IdleLockMinutes' });

export const DEFAULT_IDLE_LOCK_MINUTES = 5;

export const branchSchema = z
  .object({
    id: idSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    code: branchCodeSchema,
    cityId: idSchema.nullable(),
    addressDescription: z.string().nullable(),
    location: coordinatesSchema.nullable(),
    contactPhones: z.array(contactPhoneSchema),
    defaultCurrency: currencyCodeSchema,
    acceptedCurrencies: z.array(currencyCodeSchema),
    /** Set by S09 with the first real order; the default currency is fixed after it. */
    currencyLockedAt: instantSchema.nullable(),
    businessDayEndsAt: businessDayEndSchema,
    idleLockMinutes: idleLockMinutesSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'Branch' });

export type Branch = z.infer<typeof branchSchema>;

export const branchListSchema = z.array(branchSchema).meta({ id: 'BranchList' });

export const branchDetailSchema = z
  .object({
    branch: branchSchema,
    hours: z.array(weeklyPeriodSchema),
    /** From today's business date on. */
    exceptions: z.array(hourExceptionSchema),
    charges: z.array(branchChargeSchema),
  })
  .meta({ id: 'BranchDetail' });

export type BranchDetail = z.infer<typeof branchDetailSchema>;

/**
 * A partial change of a branch. Names, city, address, pin and currencies need
 * `branch.settings.edit`; phones need `branch.hours.edit`.
 */
export const updateBranchSchema = z
  .object({
    nameAr: nameArSchema.optional(),
    nameLatin: nameLatinSchema.nullable().optional(),
    cityId: idSchema.optional(),
    addressDescription: addressDescriptionSchema.optional(),
    location: coordinatesSchema.optional(),
    contactPhones: contactPhonesSchema.optional(),
    defaultCurrency: currencyCodeSchema.optional(),
    acceptedCurrencies: acceptedCurrenciesSchema.optional(),
    /** The `updatedAt` the client last read (rule 16). */
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdateBranch' });

export type UpdateBranch = z.infer<typeof updateBranchSchema>;

/** Spec S02 rule 32: `branch.security.edit`, with the `updatedAt` the client read. */
export const updateBranchSecuritySchema = z
  .object({ idleLockMinutes: idleLockMinutesSchema, updatedAt: instantSchema })
  .meta({ id: 'UpdateBranchSecurity' });

export type UpdateBranchSecurity = z.infer<typeof updateBranchSecuritySchema>;

/** The fields of `UpdateBranch` each permission may change. */
export const branchSettingsFields = [
  'nameAr',
  'nameLatin',
  'cityId',
  'addressDescription',
  'location',
  'defaultCurrency',
  'acceptedCurrencies',
] as const satisfies readonly (keyof UpdateBranch)[];

export const branchHoursFields = [
  'contactPhones',
] as const satisfies readonly (keyof UpdateBranch)[];

/** Accepted currencies always include the default (rule 11). */
export function assertCurrenciesConsistent(
  defaultCurrency: string,
  acceptedCurrencies: readonly string[],
): void {
  if (!acceptedCurrencies.includes(defaultCurrency)) {
    throw new DomainError('VALIDATION_FAILED', 'Accepted currencies must include the default');
  }
}

export const createBranchSchema = z
  .object({
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.optional(),
    code: branchCodeSchema,
    /** The tenant's default when left out. */
    defaultCurrency: currencyCodeSchema.optional(),
  })
  .meta({ id: 'CreateBranch' });

export type CreateBranch = z.infer<typeof createBranchSchema>;

export const archiveBranchSchema = z
  .object({ note: noteSchema.optional() })
  .meta({ id: 'ArchiveBranch' });

export type ArchiveBranch = z.infer<typeof archiveBranchSchema>;

// Onboarding (rule 3).

export const onboardingItemSchema = z
  .enum([
    'tenant.name',
    'branch.city',
    'branch.address',
    'branch.location',
    'branch.phone',
    'branch.hours',
    'branch.currency',
  ])
  .meta({ id: 'OnboardingItem' });

export type OnboardingItem = z.infer<typeof onboardingItemSchema>;

export const missingOnboardingItemSchema = z
  .object({ item: onboardingItemSchema, branchId: idSchema.nullable() })
  .meta({ id: 'MissingOnboardingItem' });

export type MissingOnboardingItem = z.infer<typeof missingOnboardingItemSchema>;

export const onboardingCompletenessSchema = z
  .object({ complete: z.boolean(), missing: z.array(missingOnboardingItemSchema) })
  .meta({ id: 'OnboardingCompleteness' });

export type OnboardingCompleteness = z.infer<typeof onboardingCompletenessSchema>;

export type OnboardingBranch = {
  id: string;
  cityId: string | null;
  addressDescription: string | null;
  location: { latitudeE7: number; longitudeE7: number } | null;
  contactPhones: readonly unknown[];
  weeklyPeriodCount: number;
  defaultCurrency: string | null;
};

/**
 * What is missing before onboarding can complete (rule 3): the Arabic name, and for every
 * non-archived branch a city, an address description, a pin, a phone, a weekly period and a
 * default currency. The Latin name, logo, cover and charge lines are optional.
 */
export function onboardingCompleteness(
  tenant: { nameAr: string | null },
  branches: readonly OnboardingBranch[],
): OnboardingCompleteness {
  const missing: MissingOnboardingItem[] = [];
  if (!tenant.nameAr || tenant.nameAr.trim().length < 2) {
    missing.push({ item: 'tenant.name', branchId: null });
  }
  for (const branch of branches) {
    const add = (item: OnboardingItem) => missing.push({ item, branchId: branch.id });
    if (!branch.cityId) add('branch.city');
    if (!branch.addressDescription || branch.addressDescription.trim().length < 2) {
      add('branch.address');
    }
    if (!branch.location) add('branch.location');
    if (branch.contactPhones.length === 0) add('branch.phone');
    if (branch.weeklyPeriodCount === 0) add('branch.hours');
    if (!branch.defaultCurrency) add('branch.currency');
  }
  return { complete: missing.length === 0, missing };
}

// The restaurant's view of its tenant.

export const scheduledStatusChangeSchema = z
  .object({
    status: scheduledTenantStatusSchema,
    reason: tenantStatusReasonSchema,
    at: instantSchema,
  })
  .meta({ id: 'ScheduledStatusChange' });

export const tenantSchema = z
  .object({
    id: idSchema,
    /** The primary slug. */
    slug: slugSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    /** Pre-fills new branches only. */
    defaultCurrency: currencyCodeSchema,
    /** The status in force (`effectiveStatus`). */
    status: tenantStatusSchema,
    statusReason: tenantStatusReasonSchema.nullable(),
    statusChangedAt: instantSchema,
    scheduledChange: scheduledStatusChangeSchema.nullable(),
    onboardingCompletedAt: instantSchema.nullable(),
    activatedAt: instantSchema.nullable(),
    closedAt: instantSchema.nullable(),
    /** While closed: the end of the owner's read and export access. */
    ownerReadUntil: instantSchema.nullable(),
    onboarding: onboardingCompletenessSchema,
    logoFileId: idSchema.nullable(),
    coverFileId: idSchema.nullable(),
    /** Non-archived branches; a single-branch tenant never sees the word "branch" (rule 17). */
    branchCount: z.int().min(0),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'Tenant' });

export type Tenant = z.infer<typeof tenantSchema>;

export const updateTenantSchema = z
  .object({
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.nullable(),
    defaultCurrency: currencyCodeSchema,
    /** The `updatedAt` the client last read (rule 16). */
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdateTenant' });

export type UpdateTenant = z.infer<typeof updateTenantSchema>;

// The console.

export const createTenantSchema = z
  .object({
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.optional(),
    slug: z.string().trim().toLowerCase().max(64),
    defaultCurrency: currencyCodeSchema,
    branches: z
      .array(createBranchSchema)
      .min(1)
      .max(20)
      .refine(
        (branches) => new Set(branches.map((branch) => branch.code)).size === branches.length,
        'A branch code appears twice',
      ),
    /** The first owner (spec S02 rule 3): an account found or created by phone. */
    owner: z.object({
      phone: mobilePhoneNumberSchema,
      displayName: z.string().trim().min(2).max(100),
    }),
    note: noteSchema.optional(),
  })
  .meta({ id: 'CreateTenant' });

export type CreateTenant = z.infer<typeof createTenantSchema>;

export const consoleTenantSchema = z
  .object({
    id: idSchema,
    slug: slugSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    status: tenantStatusSchema,
    statusReason: tenantStatusReasonSchema.nullable(),
    scheduledChange: scheduledStatusChangeSchema.nullable(),
    onboardingCompletedAt: instantSchema.nullable(),
    activatedAt: instantSchema.nullable(),
    branchCount: z.int().min(0),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'ConsoleTenant' });

export type ConsoleTenant = z.infer<typeof consoleTenantSchema>;

export const tenantSlugSchema = z
  .object({ slug: slugSchema, isPrimary: z.boolean(), createdAt: instantSchema })
  .meta({ id: 'TenantSlug' });

export const consoleTenantDetailSchema = z
  .object({
    tenant: consoleTenantSchema,
    slugs: z.array(tenantSlugSchema),
    /** Every branch, archived ones included. */
    branches: z.array(branchSchema),
  })
  .meta({ id: 'ConsoleTenantDetail' });

export type ConsoleTenantDetail = z.infer<typeof consoleTenantDetailSchema>;

export const listConsoleTenantsQuerySchema = listQuerySchema(['createdAt', 'nameAr'])
  .extend({
    status: tenantStatusSchema.optional(),
    /** Part of the Arabic or Latin name, or of a slug. */
    q: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: 'ListConsoleTenantsQuery' });

export type ListConsoleTenantsQuery = z.infer<typeof listConsoleTenantsQuerySchema>;

export const consoleTenantPageSchema = pageSchema(consoleTenantSchema).meta({
  id: 'ConsoleTenantPage',
});

export type ConsoleTenantPage = z.infer<typeof consoleTenantPageSchema>;
