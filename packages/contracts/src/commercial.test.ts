import { describe, expect, it } from 'vitest';
import {
  type AgreementRecord,
  type AgreementTerm,
  amendmentChangesSchema,
  amendmentDraftChangesSchema,
  amendmentTransitions,
  assembleFeatureCatalog,
  assertNotAuthor,
  assertPresetEntries,
  assertTemplateChargeTerms,
  defineFeature,
  defineLimit,
  draftFromTemplate,
  type FeatureCatalog,
  isAgreementInForce,
  nextAmendmentStatus,
  type OverrideRecord,
  planAmendment,
  planOverride,
  planRevocation,
  removalTakesEffectAt,
  startOfBusinessDate,
  termDraftSchema,
  termOverlaps,
  termState,
  termsInForce,
} from './commercial.js';
import { DomainError } from './errors.js';
import { featureCatalog } from './feature-catalog.js';
import { businessInstant } from './time.js';

function refusal(
  run: () => unknown,
): { code: string; details?: Record<string, unknown> | undefined } | null {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  return null;
}

const at = (date: string, time = '00:00') => businessInstant(date, time);

// A tenant whose branches end their business days at 02:00 and 04:00: removals wait for 04:00.
const ends = ['02:00', '04:00'] as const;

function term(
  id: string,
  values: AgreementTerm['values'],
  from: Date | null,
  to: Date | null = null,
): AgreementTerm {
  return { id, values, effectiveFrom: from, effectiveTo: to, dueOn: null };
}

const feature = (key: string) => ({ kind: 'feature' as const, featureKey: key });
const limit = (key: string, value: number) => ({ kind: 'limit' as const, limitKey: key, value });

const ids = {
  pos: '01900000-0000-7000-8000-000000000001',
  kitchen: '01900000-0000-7000-8000-000000000002',
  staff: '01900000-0000-7000-8000-000000000003',
  sub: '01900000-0000-7000-8000-000000000004',
  fee: '01900000-0000-7000-8000-000000000005',
  future: '01900000-0000-7000-8000-000000000006',
};

const signed = at('2026-10-01');

/** pos and kitchen_display since October, 5 members, a subscription of 50 USD a month. */
const agreement: AgreementRecord = {
  terms: [
    term(ids.pos, feature('pos'), signed),
    term(ids.kitchen, feature('kitchen_display'), signed),
    term(ids.staff, limit('staff', 5), signed),
    term(
      ids.sub,
      { kind: 'subscription', amount: 5000, currency: 'USD', period: 'month', per: 'tenant' },
      signed,
    ),
    {
      id: ids.fee,
      values: { kind: 'setup_fee', amount: 10000, currency: 'USD', label: 'Setup' },
      effectiveFrom: null,
      effectiveTo: null,
      dueOn: '2026-10-01',
    },
  ],
  endings: [],
};

const now = at('2026-11-10', '15:00');
const context = { catalog: featureCatalog, agreement, now, businessDayEnds: ends };

describe('the feature catalog', () => {
  it('holds unique keys, known and acyclic dependencies, and no private feature in a preset', () => {
    const keys = [...featureCatalog.features, ...featureCatalog.limits].map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(featureCatalog.features.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['pos', 'kitchen_display', 'marketplace_listing', 'custom_domain']),
    );
    expect(featureCatalog.limits.map((entry) => entry.key).sort()).toEqual([
      'branches',
      'catalog_items',
      'custom_field_definitions',
      'devices',
      'staff',
    ]);
    expect(
      featureCatalog.features.find((entry) => entry.key === 'web_ordering')?.dependsOn,
    ).toEqual([['pos', 'order_intake']]);
  });

  it('refuses a malformed catalog at load', () => {
    const pos = defineFeature({ key: 'pos' });
    expect(() => assembleFeatureCatalog([pos, defineFeature({ key: 'pos' })])).toThrow(/twice/);
    expect(() => assembleFeatureCatalog([defineFeature({ key: 'Pos' })])).toThrow(/Bad/);
    expect(() =>
      assembleFeatureCatalog([defineFeature({ key: 'aa', dependsOn: [['missing']] })]),
    ).toThrow(/unknown/);
    expect(() => assembleFeatureCatalog([defineFeature({ key: 'aa', dependsOn: [[]] })])).toThrow(
      /empty/,
    );
    expect(() =>
      assembleFeatureCatalog([
        defineFeature({ key: 'aa', dependsOn: [['bb']] }),
        defineFeature({ key: 'bb', dependsOn: [['cc']] }),
        defineFeature({ key: 'cc', dependsOn: [['aa']] }),
      ]),
    ).toThrow(/cycle/);
    expect(() => assembleFeatureCatalog([pos, defineLimit({ key: 'pos', counts: 'x' })])).toThrow(
      /twice/,
    );
  });
});

describe('packages', () => {
  const catalog: FeatureCatalog = assembleFeatureCatalog([
    defineFeature({ key: 'pos' }),
    defineFeature({ key: 'secret', private: true }),
    defineFeature({ key: 'old', retired: true }),
    defineLimit({ key: 'staff', counts: 'members' }),
    defineLimit({ key: 'gone', counts: 'x', retired: true }),
  ]);

  it('accept sellable keys with their dependencies', () => {
    expect(
      refusal(() => assertPresetEntries(featureCatalog, ['pos', 'waiter_app'], {})),
    ).toBeNull();
    expect(
      refusal(() => assertPresetEntries(featureCatalog, ['order_intake', 'web_ordering'], {})),
    ).toBeNull();
    expect(refusal(() => assertPresetEntries(catalog, ['pos'], { staff: 3 }))).toBeNull();
  });

  it('refuse unknown, private and retired keys, and missing dependencies', () => {
    expect(refusal(() => assertPresetEntries(catalog, ['nope'], {}))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => assertPresetEntries(catalog, ['secret'], {}))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => assertPresetEntries(catalog, ['old'], {}))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => assertPresetEntries(catalog, [], { gone: 1 }))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => assertPresetEntries(featureCatalog, ['waiter_app'], {}))).toEqual({
      code: 'FEATURE_DEPENDENCY_MISSING',
      details: { feature: 'waiter_app', missing: ['pos'] },
    });
  });

  it('let a template hold one charge term per slot', () => {
    const commission = { kind: 'commission' as const, channel: 'web' as const, percentBp: 500 };
    expect(refusal(() => assertTemplateChargeTerms([commission]))).toBeNull();
    expect(refusal(() => assertTemplateChargeTerms([commission, commission]))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      refusal(() =>
        assertTemplateChargeTerms([
          commission,
          { ...commission, channel: 'marketplace' },
          { kind: 'setup_fee', amount: 1, currency: 'USD', label: 'a' },
          { kind: 'setup_fee', amount: 2, currency: 'USD', label: 'b' },
        ]),
      ),
    ).toBeNull();
  });
});

describe('amendment schemas', () => {
  it('need a percentage or a fixed part for a commission', () => {
    const base = { kind: 'commission', channel: 'web', effectiveFrom: 'now', listValue: null };
    expect(termDraftSchema.safeParse({ ...base, percentBp: 0 }).success).toBe(false);
    expect(termDraftSchema.safeParse({ ...base, percentBp: 250 }).success).toBe(true);
    expect(
      termDraftSchema.safeParse({ ...base, percentBp: 0, fixed: { amount: 50, currency: 'TRY' } })
        .success,
    ).toBe(true);
    expect(termDraftSchema.safeParse({ ...base, percentBp: 10_001 }).success).toBe(false);
  });

  it('take dates as Damascus days or now, and one-off fees with a due date', () => {
    expect(
      termDraftSchema.safeParse({ kind: 'feature', featureKey: 'pos', effectiveFrom: '2026-12-01' })
        .success,
    ).toBe(true);
    expect(
      termDraftSchema.safeParse({ kind: 'feature', featureKey: 'pos', effectiveFrom: 'later' })
        .success,
    ).toBe(false);
    const fee = { kind: 'hardware', amount: 1, currency: 'SYP', label: 'Printer', listValue: null };
    expect(termDraftSchema.safeParse({ ...fee, dueOn: '2026-09-01' }).success).toBe(true);
    expect(termDraftSchema.safeParse({ ...fee, amount: 0, dueOn: '2026-09-01' }).success).toBe(
      false,
    );
  });

  it('allow an empty draft but not an empty amendment', () => {
    expect(amendmentDraftChangesSchema.safeParse({ add: [], end: [] }).success).toBe(true);
    expect(amendmentChangesSchema.safeParse({ add: [], end: [] }).success).toBe(false);
  });
});

describe('terms in force', () => {
  const to = at('2026-12-01');
  const record: AgreementRecord = {
    terms: [term(ids.pos, feature('pos'), signed, to), term(ids.future, feature('pos'), to)],
    endings: [],
  };

  it('start inclusive and end exclusive, one per slot', () => {
    expect(termsInForce(record, signed).get('feature:pos')?.id).toBe(ids.pos);
    expect(termsInForce(record, new Date(to.getTime() - 1)).get('feature:pos')?.id).toBe(ids.pos);
    expect(termsInForce(record, to).get('feature:pos')?.id).toBe(ids.future);
    expect(termsInForce(record, new Date(signed.getTime() - 1)).size).toBe(0);
    expect(termOverlaps(record)).toEqual([]);
  });

  it('end at the earlier of effective_to and the ending', () => {
    const ended = { ...record, endings: [{ termId: ids.pos, endsAt: at('2026-11-15') }] };
    expect(termsInForce(ended, at('2026-11-20')).size).toBe(0);
    expect(termState(ended.terms[0] as AgreementTerm, ended.endings, at('2026-11-20'))).toBe(
      'ended',
    );
    expect(termState(ended.terms[1] as AgreementTerm, ended.endings, at('2026-11-20'))).toBe(
      'future',
    );
  });

  it('never count a one-off term, and need a feature for the agreement to be in force', () => {
    expect([...termsInForce(agreement, now).keys()].sort()).toEqual([
      'feature:kitchen_display',
      'feature:pos',
      'limit:staff',
      'subscription',
    ]);
    expect(isAgreementInForce(agreement, now)).toBe(true);
    expect(
      isAgreementInForce({ terms: [agreement.terms[3] as AgreementTerm], endings: [] }, now),
    ).toBe(false);
  });

  it('find overlaps in a slot but not zero-length terms', () => {
    const overlapping: AgreementRecord = {
      terms: [term('a', feature('pos'), signed), term('b', feature('pos'), at('2026-11-01'))],
      endings: [],
    };
    expect(termOverlaps(overlapping).map(([a, b]) => [a.id, b.id])).toEqual([['a', 'b']]);
    const zero = { ...overlapping, endings: [{ termId: 'b', endsAt: at('2026-11-01') }] };
    expect(termOverlaps(zero)).toEqual([]);
  });
});

describe('removals', () => {
  it('wait for the latest business day end at or after the request', () => {
    // Edge case 1: approved at 23:58, a removal "now" takes effect at 04:00 the next morning.
    expect(removalTakesEffectAt(at('2026-11-10', '23:58'), ends)).toEqual(
      at('2026-11-11', '04:00'),
    );
    expect(removalTakesEffectAt(at('2026-11-11', '03:00'), ends)).toEqual(
      at('2026-11-11', '04:00'),
    );
    expect(removalTakesEffectAt(at('2026-11-11', '04:00'), ends)).toEqual(
      at('2026-11-11', '04:00'),
    );
    expect(removalTakesEffectAt(at('2026-12-01'), ends)).toEqual(at('2026-12-01', '04:00'));
  });
});

describe('planAmendment', () => {
  const plan = (changes: Parameters<typeof planAmendment>[0], over = {}) =>
    planAmendment(changes, { ...context, ...over });

  it('adds a feature now and a recurring charge from a date', () => {
    const result = plan({
      add: [
        { kind: 'feature', featureKey: 'waiter_app', effectiveFrom: 'now' },
        {
          kind: 'listing_fee',
          amount: 2000,
          currency: 'USD',
          period: 'month',
          per: 'active_branch',
          effectiveFrom: '2026-12-01',
          listValue: null,
        },
      ],
      end: [],
    });
    expect(result.add.map((entry) => entry.effectiveFrom)).toEqual([now, at('2026-12-01')]);
    expect(result.end).toEqual([]);
  });

  it('ends a feature at the next business day end (rule 7)', () => {
    const result = plan({ add: [], end: [{ termId: ids.kitchen, endsAt: 'now' }] });
    expect(result.end).toEqual([{ termId: ids.kitchen, endsAt: at('2026-11-11', '04:00') }]);
  });

  it('pushes a lowered limit and its ending together, and a raised one not at all', () => {
    const lowered = plan({
      add: [{ kind: 'limit', limitKey: 'staff', value: 3, effectiveFrom: 'now' }],
      end: [{ termId: ids.staff, endsAt: 'now' }],
    });
    const pushed = at('2026-11-11', '04:00');
    expect(lowered.add[0]?.effectiveFrom).toEqual(pushed);
    expect(lowered.end).toEqual([{ termId: ids.staff, endsAt: pushed }]);
    const raised = plan({
      add: [{ kind: 'limit', limitKey: 'staff', value: 8, effectiveFrom: 'now' }],
      end: [{ termId: ids.staff, endsAt: 'now' }],
    });
    expect(raised.add[0]?.effectiveFrom).toEqual(now);
    expect(raised.end).toEqual([{ termId: ids.staff, endsAt: now }]);
    // A first limit where there was none lowers "unlimited".
    const first = plan({
      add: [{ kind: 'limit', limitKey: 'devices', value: 2, effectiveFrom: 'now' }],
      end: [],
    });
    expect(first.add[0]?.effectiveFrom).toEqual(pushed);
  });

  it('does not push a feature that another term continues', () => {
    const result = plan({
      add: [{ kind: 'feature', featureKey: 'kitchen_display', effectiveFrom: 'now' }],
      end: [{ termId: ids.kitchen, endsAt: 'now' }],
    });
    expect(result.end).toEqual([{ termId: ids.kitchen, endsAt: now }]);
  });

  it('pushes a feature term set to end in advance', () => {
    const result = plan({
      add: [
        {
          kind: 'feature',
          featureKey: 'analytics',
          effectiveFrom: 'now',
          effectiveTo: '2026-12-10',
        },
      ],
      end: [],
    });
    expect(result.add[0]?.effectiveTo).toEqual(at('2026-12-10', '04:00'));
  });

  it('changes a price by ending the old term and adding the new one from the same day', () => {
    const result = plan({
      add: [
        {
          kind: 'subscription',
          amount: 4000,
          currency: 'USD',
          period: 'month',
          per: 'tenant',
          effectiveFrom: '2026-12-01',
          listValue: null,
        },
      ],
      end: [{ termId: ids.sub, endsAt: '2026-12-01' }],
    });
    expect(result.end).toEqual([{ termId: ids.sub, endsAt: at('2026-12-01') }]);
    expect(
      refusal(() =>
        plan({
          add: [
            {
              kind: 'subscription',
              amount: 4000,
              currency: 'USD',
              period: 'month',
              per: 'tenant',
              effectiveFrom: '2026-12-01',
              listValue: null,
            },
          ],
          end: [],
        }),
      ),
    ).toEqual({
      code: 'TERM_OVERLAP',
      details: { slot: 'subscription', terms: [ids.sub, 'add[0]'] },
    });
  });

  it('refuses dates in the past and recurring charges from now', () => {
    expect(
      refusal(() =>
        plan({
          add: [{ kind: 'feature', featureKey: 'loyalty', effectiveFrom: '2026-11-10' }],
          end: [],
        }),
      )?.code,
    ).toBe('EFFECTIVE_DATE_PAST');
    expect(
      refusal(() => plan({ add: [], end: [{ termId: ids.pos, endsAt: '2026-11-01' }] }))?.code,
    ).toBe('EFFECTIVE_DATE_PAST');
    expect(refusal(() => plan({ add: [], end: [{ termId: ids.sub, endsAt: 'now' }] }))?.code).toBe(
      'VALIDATION_FAILED',
    );
    // An approval after the drafted date fails: the past is never rewritten.
    const drafted = {
      add: [{ kind: 'feature' as const, featureKey: 'loyalty', effectiveFrom: '2026-11-12' }],
      end: [],
    };
    expect(refusal(() => plan(drafted))).toBeNull();
    expect(refusal(() => plan(drafted, { now: at('2026-11-12', '09:00') }))?.code).toBe(
      'EFFECTIVE_DATE_PAST',
    );
  });

  it('refuses private, unknown and dependent features without their base', () => {
    expect(
      refusal(() =>
        plan({ add: [{ kind: 'feature', featureKey: 'nope', effectiveFrom: 'now' }], end: [] }),
      )?.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      refusal(() => plan({ add: [], end: [{ termId: ids.pos, endsAt: 'now' }] })),
    ).toMatchObject({
      code: 'FEATURE_DEPENDENCY_MISSING',
      details: { feature: 'kitchen_display', missing: ['pos'] },
    });
    expect(
      refusal(() =>
        plan(
          { add: [{ kind: 'feature', featureKey: 'waiter_app', effectiveFrom: 'now' }], end: [] },
          { agreement: { terms: [], endings: [] } },
        ),
      )?.code,
    ).toBe('FEATURE_DEPENDENCY_MISSING');
  });

  it('needs a reason for a value different from the list', () => {
    const listValue = {
      kind: 'commission' as const,
      channel: 'marketplace' as const,
      percentBp: 1000,
    };
    const draft = { ...listValue, percentBp: 800, effectiveFrom: 'now' as const, listValue };
    expect(refusal(() => plan({ add: [draft], end: [] }))?.code).toBe('VALIDATION_FAILED');
    const result = plan({ add: [{ ...draft, differenceReason: 'Pilot discount' }], end: [] });
    expect(result.add[0]).toMatchObject({ listValue, differenceReason: 'Pilot discount' });
    expect(refusal(() => plan({ add: [{ ...draft, percentBp: 1000 }], end: [] }))).toBeNull();
  });

  it('ends only this agreement’s open, dated terms, once', () => {
    const unknown = '01900000-0000-7000-8000-0000000000ff';
    expect(refusal(() => plan({ add: [], end: [{ termId: unknown, endsAt: 'now' }] }))?.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => plan({ add: [], end: [{ termId: ids.fee, endsAt: 'now' }] }))?.code).toBe(
      'VALIDATION_FAILED',
    );
    const twice = {
      add: [],
      end: [
        { termId: ids.kitchen, endsAt: 'now' as const },
        { termId: ids.kitchen, endsAt: 'now' as const },
      ],
    };
    expect(refusal(() => plan(twice))?.code).toBe('VALIDATION_FAILED');
    const ended = { ...agreement, endings: [{ termId: ids.kitchen, endsAt: at('2026-12-01') }] };
    expect(
      refusal(() =>
        plan({ add: [], end: [{ termId: ids.kitchen, endsAt: 'now' }] }, { agreement: ended }),
      )?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('ends a term not yet in force at its own start, so it never starts', () => {
    const future: AgreementRecord = {
      terms: [...agreement.terms, term(ids.future, feature('loyalty'), at('2026-12-01'))],
      endings: [],
    };
    const result = plan(
      { add: [], end: [{ termId: ids.future, endsAt: 'now' }] },
      { agreement: future },
    );
    // A removal pushed to the business day end, then held at the term's own start.
    expect(result.end[0]?.endsAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    const corrected = plan(
      { add: [], end: [{ termId: ids.future, endsAt: '2026-11-20' }] },
      { agreement: future },
    );
    expect(corrected.end).toEqual([{ termId: ids.future, endsAt: at('2026-12-01') }]);
  });
});

describe('amendment states', () => {
  it('allow exactly the transitions of the table', () => {
    expect(nextAmendmentStatus('draft', 'edit')).toBe('draft');
    expect(nextAmendmentStatus('draft', 'submit')).toBe('submitted');
    expect(nextAmendmentStatus('submitted', 'unsubmit')).toBe('draft');
    expect(nextAmendmentStatus('submitted', 'approve')).toBe('approved');
    expect(nextAmendmentStatus('submitted', 'reject')).toBe('rejected');
    expect(nextAmendmentStatus('draft', 'withdraw')).toBe('withdrawn');
    expect(nextAmendmentStatus('submitted', 'withdraw')).toBe('withdrawn');
    const actions = ['edit', 'submit', 'unsubmit', 'withdraw', 'approve', 'reject'] as const;
    for (const status of Object.keys(
      amendmentTransitions,
    ) as (keyof typeof amendmentTransitions)[]) {
      for (const action of actions) {
        const allowed = action in amendmentTransitions[status];
        expect(refusal(() => nextAmendmentStatus(status, action))?.code ?? null).toBe(
          allowed ? null : 'INVALID_STATUS_TRANSITION',
        );
      }
    }
  });

  it('never let the author approve, as a user or by the CLI operator’s name', () => {
    const user = '01900000-0000-7000-8000-0000000000aa';
    const other = '01900000-0000-7000-8000-0000000000bb';
    expect(
      refusal(() =>
        assertNotAuthor({ userId: user, operator: null }, { userId: user, operator: null }),
      )?.code,
    ).toBe('SELF_APPROVAL');
    expect(
      refusal(() =>
        assertNotAuthor(
          { userId: null, operator: 'sales1' },
          { userId: null, operator: ' Sales1 ' },
        ),
      )?.code,
    ).toBe('SELF_APPROVAL');
    expect(
      refusal(() =>
        assertNotAuthor({ userId: user, operator: null }, { userId: other, operator: null }),
      ),
    ).toBeNull();
    expect(
      refusal(() =>
        assertNotAuthor(
          { userId: null, operator: 'sales1' },
          { userId: null, operator: 'finance1' },
        ),
      ),
    ).toBeNull();
  });
});

describe('draftFromTemplate', () => {
  it('copies the package as terms and the charges with their list values', () => {
    const commission = { kind: 'commission' as const, channel: 'web' as const, percentBp: 500 };
    const subscription = {
      kind: 'subscription' as const,
      amount: 5000,
      currency: 'USD' as const,
      period: 'month' as const,
      per: 'tenant' as const,
    };
    const setup = {
      kind: 'setup_fee' as const,
      amount: 9000,
      currency: 'USD' as const,
      label: 'S',
    };
    const draft = draftFromTemplate(
      { features: ['pos'], limits: { staff: 5 } },
      [commission, subscription, setup],
      '2026-11-10',
    );
    expect(draft).toEqual({
      add: [
        { kind: 'feature', featureKey: 'pos', effectiveFrom: 'now' },
        { kind: 'limit', limitKey: 'staff', value: 5, effectiveFrom: 'now' },
        { ...commission, effectiveFrom: 'now', listValue: commission },
        { ...subscription, effectiveFrom: '2026-11-11', listValue: subscription },
        { ...setup, dueOn: '2026-11-10', listValue: setup },
      ],
      end: [],
    });
    expect(amendmentChangesSchema.safeParse(draft).success).toBe(true);
  });
});

describe('overrides', () => {
  const catalog = assembleFeatureCatalog([
    ...featureCatalog.features,
    ...featureCatalog.limits,
    defineFeature({ key: 'made_for_one', private: true }),
  ]);
  const overrides: OverrideRecord[] = [];
  const octx = { catalog, agreement, overrides, now, businessDayEnds: ends };
  const pushed = at('2026-11-11', '04:00');

  it('need an expiry within 366 days, except a private feature’s grant', () => {
    expect(
      refusal(() => planOverride({ kind: 'grant', featureKey: 'analytics', reason: 'Trial' }, octx))
        ?.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      planOverride({ kind: 'grant', featureKey: 'made_for_one', reason: 'Custom work' }, octx),
    ).toEqual({ startsAt: now, expiresAt: null });
    expect(
      refusal(() =>
        planOverride(
          { kind: 'grant', featureKey: 'analytics', reason: 'Trial', expiresAt: '2027-11-30' },
          octx,
        ),
      )?.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      refusal(() =>
        planOverride(
          {
            kind: 'deny',
            featureKey: 'pos',
            reason: 'Abuse',
            startsAt: '2026-11-01',
            expiresAt: '2026-12-01',
          },
          octx,
        ),
      )?.code,
    ).toBe('EFFECTIVE_DATE_PAST');
  });

  it('push a grant’s expiry and a deny’s start to the business day end (rule 14)', () => {
    expect(
      planOverride(
        { kind: 'grant', featureKey: 'analytics', reason: 'Trial', expiresAt: '2026-12-10' },
        octx,
      ),
    ).toEqual({ startsAt: now, expiresAt: at('2026-12-10', '04:00') });
    expect(
      planOverride(
        { kind: 'deny', featureKey: 'kitchen_display', reason: 'Abuse', expiresAt: '2026-12-10' },
        octx,
      ),
    ).toEqual({ startsAt: pushed, expiresAt: at('2026-12-10') });
  });

  it('push a lowering limit’s start and a raising limit’s expiry', () => {
    expect(
      planOverride(
        { kind: 'limit', limitKey: 'staff', value: 2, reason: 'Lower', expiresAt: '2026-12-10' },
        octx,
      ),
    ).toEqual({ startsAt: pushed, expiresAt: at('2026-12-10') });
    expect(
      planOverride(
        { kind: 'limit', limitKey: 'staff', value: 9, reason: 'Raise', expiresAt: '2026-12-10' },
        octx,
      ),
    ).toEqual({ startsAt: now, expiresAt: at('2026-12-10', '04:00') });
  });

  it('refuse an overlap in the slot until the old one is revoked', () => {
    const existing: OverrideRecord = {
      id: '01900000-0000-7000-8000-0000000000cc',
      kind: 'grant',
      featureKey: 'analytics',
      limitKey: null,
      value: null,
      startsAt: at('2026-11-01'),
      expiresAt: at('2026-12-01'),
      revokedAt: null,
    };
    const input = {
      kind: 'deny' as const,
      featureKey: 'analytics',
      reason: 'Stop',
      expiresAt: '2026-12-20',
    };
    expect(refusal(() => planOverride(input, { ...octx, overrides: [existing] }))).toEqual({
      code: 'OVERRIDE_OVERLAP',
      details: { overrideId: existing.id },
    });
    const revoked = { ...existing, revokedAt: now };
    expect(refusal(() => planOverride(input, { ...octx, overrides: [revoked] }))).toBeNull();
  });

  it('revoke a grant at the day’s end, a deny at once, and only once', () => {
    const grant: OverrideRecord = {
      id: '01900000-0000-7000-8000-0000000000dd',
      kind: 'grant',
      featureKey: 'analytics',
      limitKey: null,
      value: null,
      startsAt: at('2026-11-01'),
      expiresAt: at('2026-12-01'),
      revokedAt: null,
    };
    const rctx = { agreement, now, businessDayEnds: ends };
    expect(planRevocation(grant, rctx)).toEqual(pushed);
    expect(planRevocation({ ...grant, kind: 'deny' }, rctx)).toEqual(now);
    expect(planRevocation({ ...grant, startsAt: at('2026-11-20') }, rctx)).toEqual(now);
    expect(
      planRevocation(
        { ...grant, kind: 'limit', featureKey: null, limitKey: 'staff', value: 9 },
        rctx,
      ),
    ).toEqual(pushed);
    expect(
      planRevocation(
        { ...grant, kind: 'limit', featureKey: null, limitKey: 'staff', value: 2 },
        rctx,
      ),
    ).toEqual(now);
    expect(refusal(() => planRevocation({ ...grant, revokedAt: now }, rctx))?.code).toBe(
      'ALREADY_REVOKED',
    );
  });
});

describe('startOfBusinessDate', () => {
  it('is midnight in Damascus', () => {
    expect(startOfBusinessDate('2026-11-10').toISOString()).toBe('2026-11-09T21:00:00.000Z');
  });
});
