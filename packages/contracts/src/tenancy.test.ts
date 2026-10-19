import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  assertSlugAllowed,
  assertTenantWritable,
  branchChargeInputSchema,
  businessDateOf,
  businessDayEndSchema,
  changeTenantStatusSchema,
  contactPhonesSchema,
  createTenantSchema,
  effectiveStatus,
  effectiveStatusState,
  formatRateBp,
  isBranchOpenAt,
  isOvernight,
  nextBusinessDayEnd,
  type OnboardingBranch,
  onboardingCompleteness,
  ownerReadAccessEndsAt,
  periodNextDay,
  planTenantStatusChange,
  replaceBranchChargesSchema,
  type TenantStatus,
  type TenantStatusState,
  tenantStatusRequestSchema,
  tenantStatusTransitions,
  validateHourException,
  validateWeeklyHours,
  type WeeklyPeriod,
} from './tenancy.js';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

const idle: TenantStatusState = {
  status: 'active',
  statusReason: null,
  scheduledStatus: null,
  scheduledStatusReason: null,
  scheduledStatusAt: null,
};

// 2026-10-19 is a Monday; 12:00Z is 15:00 in Damascus.
const afternoon = new Date('2026-10-19T12:00:00.000Z');

describe('tenant status table', () => {
  const statuses: TenantStatus[] = ['onboarding', 'active', 'suspended', 'closed'];
  const allowed: Record<string, string> = {
    'onboarding>active': 'immediate',
    'onboarding>closed': 'immediate',
    'active>suspended': 'end_of_business_day',
    'active>closed': 'end_of_business_day',
    'suspended>active': 'immediate',
    'suspended>closed': 'immediate',
  };

  it('allows exactly the transitions of the spec, with their timing', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const table: Partial<Record<TenantStatus, string>> = tenantStatusTransitions[from];
        expect(table[to], `${from} > ${to}`).toBe(allowed[`${from}>${to}`]);
      }
    }
  });

  it.each([
    ['onboarding', 'suspended'],
    ['active', 'active'],
    ['suspended', 'suspended'],
    ['closed', 'active'],
    ['closed', 'suspended'],
    ['closed', 'closed'],
  ] as const)('refuses %s to %s', (from, to) => {
    const tenant = { ...idle, status: from, onboardingCompletedAt: afternoon };
    expect(
      codeOf(() => planTenantStatusChange(tenant, { to, reason: 'other' }, afternoon, ['04:00'])),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('activates only after onboarding is complete', () => {
    const tenant = { ...idle, status: 'onboarding' as const, onboardingCompletedAt: null };
    expect(codeOf(() => planTenantStatusChange(tenant, { to: 'active' }, afternoon, []))).toBe(
      'ONBOARDING_INCOMPLETE',
    );
    expect(
      planTenantStatusChange(
        { ...tenant, onboardingCompletedAt: afternoon },
        { to: 'active' },
        afternoon,
        [],
      ),
    ).toEqual({ kind: 'immediate', status: 'active', reason: null });
  });

  it('closes an onboarding tenant and a suspended one at once', () => {
    for (const status of ['onboarding', 'suspended'] as const) {
      const tenant = { ...idle, status, onboardingCompletedAt: null };
      expect(
        planTenantStatusChange(tenant, { to: 'closed', reason: 'abuse' }, afternoon, ['04:00']),
      ).toEqual({ kind: 'immediate', status: 'closed', reason: 'abuse' });
    }
  });

  it('schedules a suspension of an active tenant at the end of its business day', () => {
    const tenant = { ...idle, onboardingCompletedAt: afternoon };
    expect(
      planTenantStatusChange(tenant, { to: 'suspended', reason: 'non_payment' }, afternoon, [
        '04:00',
      ]),
    ).toEqual({
      kind: 'scheduled',
      status: 'suspended',
      reason: 'non_payment',
      at: new Date('2026-10-20T01:00:00.000Z'),
    });
  });

  it('replaces a scheduled change with another, and refuses a repeat', () => {
    const tenant = {
      ...idle,
      scheduledStatus: 'suspended' as const,
      scheduledStatusReason: 'non_payment' as const,
      scheduledStatusAt: new Date('2026-10-20T01:00:00.000Z'),
      onboardingCompletedAt: afternoon,
    };
    expect(
      planTenantStatusChange(tenant, { to: 'closed', reason: 'other' }, afternoon, ['04:00']).kind,
    ).toBe('scheduled');
    expect(
      codeOf(() =>
        planTenantStatusChange(tenant, { to: 'suspended', reason: 'other' }, afternoon, ['04:00']),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('needs a reason to suspend or close', () => {
    expect(changeTenantStatusSchema.safeParse({ to: 'suspended' }).success).toBe(false);
    expect(changeTenantStatusSchema.safeParse({ to: 'closed', reason: 'other' }).success).toBe(
      true,
    );
    expect(changeTenantStatusSchema.safeParse({ to: 'active' }).success).toBe(true);
    expect(tenantStatusRequestSchema.safeParse({ cancelScheduled: true }).success).toBe(true);
  });
});

describe('nextBusinessDayEnd', () => {
  it('takes effect the same night when requested before the day end (edge case 1)', () => {
    // 03:00 in Damascus on 2026-10-20.
    expect(nextBusinessDayEnd(new Date('2026-10-20T00:00:00.000Z'), ['04:00']).toISOString()).toBe(
      '2026-10-20T01:00:00.000Z',
    );
  });

  it('uses the latest day end among the branches (edge case 2)', () => {
    expect(nextBusinessDayEnd(afternoon, ['02:00', '05:30', '04:00']).toISOString()).toBe(
      '2026-10-20T02:30:00.000Z',
    );
  });

  it('moves to the next day exactly at the day end', () => {
    expect(nextBusinessDayEnd(new Date('2026-10-20T01:00:00.000Z'), ['04:00']).toISOString()).toBe(
      '2026-10-21T01:00:00.000Z',
    );
  });
});

describe('effectiveStatus', () => {
  const scheduled: TenantStatusState = {
    ...idle,
    scheduledStatus: 'suspended',
    scheduledStatusReason: 'non_payment',
    scheduledStatusAt: new Date('2026-10-20T01:00:00.000Z'),
  };

  it('keeps the status until the scheduled time', () => {
    expect(effectiveStatus(scheduled, new Date('2026-10-20T00:59:59.000Z'))).toBe('active');
  });

  it('answers the scheduled status once its time has passed, whether or not the job ran', () => {
    const at = new Date('2026-10-20T01:00:00.000Z');
    expect(effectiveStatus(scheduled, at)).toBe('suspended');
    expect(effectiveStatusState(scheduled, at)).toEqual({
      status: 'suspended',
      statusReason: 'non_payment',
      scheduledStatus: null,
      scheduledStatusReason: null,
      scheduledStatusAt: null,
    });
  });
});

describe('assertTenantWritable', () => {
  it('refuses writes while suspended or closed', () => {
    expect(codeOf(() => assertTenantWritable('onboarding'))).toBeUndefined();
    expect(codeOf(() => assertTenantWritable('active'))).toBeUndefined();
    expect(codeOf(() => assertTenantWritable('suspended'))).toBe('TENANT_SUSPENDED');
    expect(codeOf(() => assertTenantWritable('closed'))).toBe('TENANT_CLOSED');
  });

  it('gives the owner 90 days of reading after closure', () => {
    expect(ownerReadAccessEndsAt(new Date('2026-10-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-12-30T00:00:00.000Z',
    );
  });
});

describe('slugs', () => {
  it.each(['abc', 'test-grill', 'grill-azaz', 'a1b2', 'a'.repeat(30)])('accepts %s', (slug) => {
    expect(codeOf(() => assertSlugAllowed(slug))).toBeUndefined();
  });

  it.each([
    'ab',
    'a'.repeat(31),
    '1abc',
    '-abc',
    'abc-',
    'ab--cd',
    'Abc',
    'ab_cd',
    'مطعم',
    'www',
    'api',
    'console',
    'menu',
    'vertex',
    'food',
  ])('refuses %s with SLUG_RESERVED', (slug) => {
    expect(codeOf(() => assertSlugAllowed(slug))).toBe('SLUG_RESERVED');
  });

  it('lowercases and trims what Vertex staff type', () => {
    const tenant = createTenantSchema.parse({
      nameAr: 'مطعم تجريبي',
      slug: '  Test-Grill ',
      defaultCurrency: 'USD',
      branches: [{ nameAr: 'الرئيسي', code: 'main' }],
    });
    expect(tenant.slug).toBe('test-grill');
  });

  it('refuses two branches with one code at creation', () => {
    expect(
      createTenantSchema.safeParse({
        nameAr: 'مطعم تجريبي',
        slug: 'test-grill',
        defaultCurrency: 'USD',
        branches: [
          { nameAr: 'الأول', code: 'main' },
          { nameAr: 'الثاني', code: 'main' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('weekly hours', () => {
  const day = (weekday: number, opensAt: string, closesAt: string): WeeklyPeriod => ({
    weekday,
    opensAt,
    closesAt,
  });

  it('accepts two periods a day and an overnight period ending before the day end', () => {
    expect(
      codeOf(() =>
        validateWeeklyHours(
          [day(1, '10:00', '15:00'), day(1, '18:00', '02:00'), day(7, '13:00', '01:00')],
          '04:00',
        ),
      ),
    ).toBeUndefined();
  });

  it('accepts 18:00–02:00 and refuses 22:00–05:00 with the day ending at 04:00 (edge case 8)', () => {
    expect(codeOf(() => validateWeeklyHours([day(2, '18:00', '02:00')], '04:00'))).toBeUndefined();
    expect(codeOf(() => validateWeeklyHours([day(2, '22:00', '05:00')], '04:00'))).toBe(
      'INVALID_HOURS',
    );
  });

  it('accepts a period ending exactly at the day end, refuses one opening before it', () => {
    expect(codeOf(() => validateWeeklyHours([day(3, '20:00', '04:00')], '04:00'))).toBeUndefined();
    expect(codeOf(() => validateWeeklyHours([day(3, '03:00', '05:00')], '04:00'))).toBe(
      'INVALID_HOURS',
    );
  });

  it('refuses overlaps, empty periods and a third period', () => {
    expect(
      codeOf(() =>
        validateWeeklyHours([day(1, '10:00', '15:00'), day(1, '14:00', '18:00')], '04:00'),
      ),
    ).toBe('INVALID_HOURS');
    expect(
      codeOf(() =>
        validateWeeklyHours([day(1, '18:00', '02:00'), day(1, '01:00', '03:00')], '04:00'),
      ),
    ).toBe('INVALID_HOURS');
    expect(codeOf(() => validateWeeklyHours([day(1, '10:00', '10:00')], '04:00'))).toBe(
      'INVALID_HOURS',
    );
    expect(
      codeOf(() =>
        validateWeeklyHours(
          [day(1, '08:00', '09:00'), day(1, '10:00', '11:00'), day(1, '12:00', '13:00')],
          '04:00',
        ),
      ),
    ).toBe('INVALID_HOURS');
  });

  it('never lets a day spill into the next one: the day end separates them', () => {
    // Saturday until 03:30 and Sunday from 10:00: the day end at 04:00 sits between them.
    expect(
      codeOf(() =>
        validateWeeklyHours([day(1, '18:00', '03:30'), day(2, '10:00', '23:00')], '04:00'),
      ),
    ).toBeUndefined();
  });

  it('names the offending period in the error', () => {
    try {
      validateWeeklyHours([day(4, '22:00', '05:00')], '04:00');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details).toEqual({
        period: { weekday: 4, opensAt: '22:00', closesAt: '05:00' },
      });
    }
  });

  it('marks overnight periods', () => {
    expect(isOvernight({ opensAt: '18:00', closesAt: '02:00' })).toBe(true);
    expect(isOvernight({ opensAt: '10:00', closesAt: '23:00' })).toBe(false);
  });

  it('keeps an early-morning period on the previous business date (rule 12, owner 2026-10-19)', () => {
    // 01:00–03:00 under Saturday with the day ending at 04:00: Sunday early morning, Saturday's day.
    const early = { opensAt: '01:00', closesAt: '03:00' };
    expect(codeOf(() => validateWeeklyHours([day(1, '01:00', '03:00')], '04:00'))).toBeUndefined();
    expect(periodNextDay(early, '04:00')).toEqual({ opens: true, closes: true });
    expect(periodNextDay({ opensAt: '18:00', closesAt: '02:00' }, '04:00')).toEqual({
      opens: false,
      closes: true,
    });
    expect(periodNextDay({ opensAt: '10:00', closesAt: '23:00' }, '04:00')).toEqual({
      opens: false,
      closes: false,
    });
    // With the day ending at midnight, 01:00 is the calendar day's own morning.
    expect(periodNextDay(early, '00:00')).toEqual({ opens: false, closes: false });
    // It may share the day with an evening period that ends before it opens.
    expect(
      codeOf(() =>
        validateWeeklyHours([day(1, '18:00', '00:30'), day(1, '01:00', '03:00')], '04:00'),
      ),
    ).toBeUndefined();
  });

  it('accepts day ends on the hour or half hour between 00:00 and 08:00', () => {
    for (const end of ['00:00', '04:00', '04:30', '07:30', '08:00']) {
      expect(businessDayEndSchema.safeParse(end).success, end).toBe(true);
    }
    for (const end of ['08:30', '04:15', '12:00', '4:00']) {
      expect(businessDayEndSchema.safeParse(end).success, end).toBe(false);
    }
  });
});

describe('hour exceptions', () => {
  it('is closed exactly when it has no periods', () => {
    expect(
      codeOf(() => validateHourException({ closed: true, periods: [] }, '04:00')),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        validateHourException(
          { closed: false, periods: [{ opensAt: '10:00', closesAt: '14:00' }] },
          '04:00',
        ),
      ),
    ).toBeUndefined();
    expect(codeOf(() => validateHourException({ closed: false, periods: [] }, '04:00'))).toBe(
      'INVALID_HOURS',
    );
    expect(
      codeOf(() =>
        validateHourException(
          { closed: true, periods: [{ opensAt: '10:00', closesAt: '14:00' }] },
          '04:00',
        ),
      ),
    ).toBe('INVALID_HOURS');
  });

  it('follows the weekly rules for its periods', () => {
    expect(
      codeOf(() =>
        validateHourException(
          { closed: false, periods: [{ opensAt: '22:00', closesAt: '05:00' }] },
          '04:00',
        ),
      ),
    ).toBe('INVALID_HOURS');
  });
});

describe('businessDateOf', () => {
  it('belongs to the previous date before the day end', () => {
    // 02:30 in Damascus on the 20th.
    expect(businessDateOf('2026-10-19T23:30:00.000Z', '04:00')).toBe('2026-10-19');
    // 04:00 in Damascus on the 20th: the new business day.
    expect(businessDateOf('2026-10-20T01:00:00.000Z', '04:00')).toBe('2026-10-20');
    // 23:59 on the 19th.
    expect(businessDateOf('2026-10-19T20:59:00.000Z', '04:00')).toBe('2026-10-19');
  });

  it('follows the calendar date when the day ends at midnight', () => {
    expect(businessDateOf('2026-10-19T21:00:00.000Z', '00:00')).toBe('2026-10-20');
  });
});

describe('isBranchOpenAt', () => {
  const branch = { businessDayEndsAt: '04:00' };
  // Monday (weekday 3) 10:00–23:00; Friday (7) 13:00–01:00.
  const hours: WeeklyPeriod[] = [
    { weekday: 3, opensAt: '10:00', closesAt: '23:00' },
    { weekday: 7, opensAt: '13:00', closesAt: '01:00' },
  ];

  it('is open inside a period and closed outside', () => {
    expect(isBranchOpenAt(branch, hours, [], '2026-10-19T07:00:00.000Z')).toBe(true); // 10:00
    expect(isBranchOpenAt(branch, hours, [], '2026-10-19T06:59:00.000Z')).toBe(false); // 09:59
    expect(isBranchOpenAt(branch, hours, [], '2026-10-19T20:00:00.000Z')).toBe(false); // 23:00
  });

  it('keeps Friday night open past midnight, on Friday’s business date', () => {
    // Saturday 2026-10-24 at 00:30 in Damascus.
    expect(isBranchOpenAt(branch, hours, [], '2026-10-23T21:30:00.000Z')).toBe(true);
    // Saturday at 01:00: closed.
    expect(isBranchOpenAt(branch, hours, [], '2026-10-23T22:00:00.000Z')).toBe(false);
  });

  it('opens an early-morning period on the previous day’s business date', () => {
    // Saturday (1) 01:00–03:00: Sunday 2026-10-25 at 02:00 in Damascus is Saturday's day.
    const early: WeeklyPeriod[] = [{ weekday: 1, opensAt: '01:00', closesAt: '03:00' }];
    expect(isBranchOpenAt(branch, early, [], '2026-10-24T23:00:00.000Z')).toBe(true);
    expect(businessDateOf('2026-10-24T23:00:00.000Z', '04:00')).toBe('2026-10-24');
    // Saturday 2026-10-24 at 02:00 belongs to Friday: closed.
    expect(isBranchOpenAt(branch, early, [], '2026-10-23T23:00:00.000Z')).toBe(false);
    // A Saturday exception decides that early morning too.
    const closed = [{ date: '2026-10-24', closed: true, periods: [] }];
    expect(isBranchOpenAt(branch, early, closed, '2026-10-24T23:00:00.000Z')).toBe(false);
  });

  it('uses the business date’s exception instead of the weekday', () => {
    const closed = [{ date: '2026-10-19', closed: true, periods: [] }];
    expect(isBranchOpenAt(branch, hours, closed, '2026-10-19T09:00:00.000Z')).toBe(false);
    // Edge case 9: an exception opens a day the weekly schedule keeps closed (Tuesday).
    const opened = [
      { date: '2026-10-20', closed: false, periods: [{ opensAt: '12:00', closesAt: '16:00' }] },
    ];
    expect(isBranchOpenAt(branch, hours, opened, '2026-10-20T10:00:00.000Z')).toBe(true);
    expect(isBranchOpenAt(branch, hours, [], '2026-10-20T10:00:00.000Z')).toBe(false);
  });
});

describe('charge lines', () => {
  const line = {
    kind: 'service',
    nameAr: 'خدمة',
    rateBp: 1000,
    mode: 'added',
    orderTypes: ['dine_in'],
  };

  it('accepts 1 to 5000 basis points and a non-empty set of order types', () => {
    expect(branchChargeInputSchema.safeParse(line).success).toBe(true);
    expect(branchChargeInputSchema.safeParse({ ...line, rateBp: 0 }).success).toBe(false);
    expect(branchChargeInputSchema.safeParse({ ...line, rateBp: 5001 }).success).toBe(false);
    expect(branchChargeInputSchema.safeParse({ ...line, rateBp: 10.5 }).success).toBe(false);
    expect(branchChargeInputSchema.safeParse({ ...line, orderTypes: [] }).success).toBe(false);
    expect(
      branchChargeInputSchema.safeParse({ ...line, orderTypes: ['dine_in', 'dine_in'] }).success,
    ).toBe(false);
    expect(branchChargeInputSchema.safeParse({ ...line, mode: 'other' }).success).toBe(false);
  });

  it('allows at most three lines', () => {
    const updatedAt = '2026-10-19T12:00:00.000Z';
    expect(replaceBranchChargesSchema.safeParse({ lines: [], updatedAt }).success).toBe(true);
    expect(
      replaceBranchChargesSchema.safeParse({ lines: [line, line, line], updatedAt }).success,
    ).toBe(true);
    expect(
      replaceBranchChargesSchema.safeParse({ lines: [line, line, line, line], updatedAt }).success,
    ).toBe(false);
  });

  it('formats basis points as a percentage without floats', () => {
    expect(formatRateBp(1000)).toBe('10');
    expect(formatRateBp(250)).toBe('2.5');
    expect(formatRateBp(1)).toBe('0.01');
    expect(formatRateBp(5000)).toBe('50');
  });
});

describe('contact phones', () => {
  it('stores E.164, refuses duplicates and WhatsApp on a landline', () => {
    expect(contactPhonesSchema.parse([{ phone: '0900 000 001', whatsapp: true }])).toEqual([
      { phone: '+963900000001', whatsapp: true },
    ]);
    expect(
      contactPhonesSchema.safeParse([
        { phone: '0900 000 001', whatsapp: true },
        { phone: '+963900000001', whatsapp: false },
      ]).success,
    ).toBe(false);
    expect(contactPhonesSchema.safeParse([{ phone: '021 000 0001', whatsapp: true }]).success).toBe(
      false,
    );
    expect(
      contactPhonesSchema.safeParse(
        ['0900000001', '0900000002', '0900000003', '0900000004'].map((phone) => ({
          phone,
          whatsapp: false,
        })),
      ).success,
    ).toBe(false);
  });
});

describe('onboardingCompleteness', () => {
  const complete: OnboardingBranch = {
    id: '0199f000-0000-7000-8000-000000000001',
    cityId: '0199f000-0000-7000-8000-000000000002',
    addressDescription: 'قرب الساحة',
    location: { latitudeE7: 365_876_000, longitudeE7: 370_448_000 },
    contactPhones: [{ phone: '+963900000001', whatsapp: true }],
    weeklyPeriodCount: 7,
    defaultCurrency: 'USD',
  };

  it('is complete when the name and every branch are complete', () => {
    expect(onboardingCompleteness({ nameAr: 'مطعم تجريبي' }, [complete])).toEqual({
      complete: true,
      missing: [],
    });
  });

  it('lists each missing item with its branch', () => {
    const empty: OnboardingBranch = {
      id: complete.id,
      cityId: null,
      addressDescription: null,
      location: null,
      contactPhones: [],
      weeklyPeriodCount: 0,
      defaultCurrency: null,
    };
    expect(onboardingCompleteness({ nameAr: ' ' }, [empty]).missing).toEqual([
      { item: 'tenant.name', branchId: null },
      ...[
        'branch.city',
        'branch.address',
        'branch.location',
        'branch.phone',
        'branch.hours',
        'branch.currency',
      ].map((item) => ({ item, branchId: complete.id })),
    ]);
  });
});
