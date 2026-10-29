import { describe, expect, it } from 'vitest';
import type { AgreementRecord, AgreementTerm, OverrideRecord } from './commercial.js';
import {
  assertWithinLimit,
  branchEntitlementsCopy,
  type EntitlementInputs,
  isBranchFeatureEntitled,
  isEntitled,
  isEntitlementLeaseExpired,
  resolveEntitlements,
  sameEntitlements,
} from './entitlements.js';
import { DomainError } from './errors.js';
import { featureCatalog } from './feature-catalog.js';
import { businessInstant } from './time.js';

const at = (date: string, time = '00:00') => businessInstant(date, time);

let sequence = 0;
const nextId = () => `01900000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

function featureTerm(key: string, from: Date, to: Date | null = null): AgreementTerm {
  return {
    id: nextId(),
    values: { kind: 'feature', featureKey: key },
    effectiveFrom: from,
    effectiveTo: to,
    dueOn: null,
  };
}

function limitTerm(key: string, value: number, from: Date): AgreementTerm {
  return {
    id: nextId(),
    values: { kind: 'limit', limitKey: key, value },
    effectiveFrom: from,
    effectiveTo: null,
    dueOn: null,
  };
}

function override(fields: Partial<OverrideRecord> & Pick<OverrideRecord, 'kind'>): OverrideRecord {
  return {
    id: nextId(),
    featureKey: null,
    limitKey: null,
    value: null,
    startsAt: at('2026-11-01'),
    expiresAt: at('2026-12-01'),
    revokedAt: null,
    ...fields,
  };
}

const inputs = (
  terms: AgreementTerm[],
  overrides: OverrideRecord[] = [],
  endings: AgreementRecord['endings'] = [],
): EntitlementInputs => ({ catalog: featureCatalog, agreement: { terms, endings }, overrides });

const feature = (resolved: ReturnType<typeof resolveEntitlements>, key: string) =>
  resolved.features.find((entry) => entry.key === key);

const limit = (resolved: ReturnType<typeof resolveEntitlements>, key: string) =>
  resolved.limits.find((entry) => entry.key === key);

const now = at('2026-11-10', '12:00');

describe('resolveEntitlements', () => {
  it('turns every feature off and leaves limits unlimited without an agreement (edge case 11)', () => {
    const resolved = resolveEntitlements(inputs([]), now);
    expect(resolved.features.every((entry) => !entry.on && entry.source === 'default')).toBe(true);
    expect(resolved.features).toHaveLength(featureCatalog.features.length);
    expect(resolved.limits.every((entry) => entry.value === null)).toBe(true);
    expect(resolved.validUntil).toBeNull();
    expect(resolved.at).toBe(now.toISOString());
  });

  it('turns a feature on by a term in force, until the term ends', () => {
    const end = at('2026-12-01', '04:00');
    const resolved = resolveEntitlements(inputs([featureTerm('pos', at('2026-10-01'), end)]), now);
    expect(feature(resolved, 'pos')).toEqual({
      key: 'pos',
      on: true,
      source: 'agreement',
      reason: null,
      until: end.toISOString(),
    });
    expect(resolved.validUntil).toBe(end.toISOString());
    expect(
      feature(resolveEntitlements(inputs([featureTerm('pos', at('2026-12-01'))]), now), 'pos'),
    ).toMatchObject({ on: false, source: 'default' });
  });

  it('lets a deny beat the agreement and a grant, and a grant beat nothing', () => {
    const pos = featureTerm('pos', at('2026-10-01'));
    const deny = override({ kind: 'deny', featureKey: 'pos' });
    const grant = override({ kind: 'grant', featureKey: 'analytics' });
    const resolved = resolveEntitlements(inputs([pos], [deny, grant]), now);
    expect(feature(resolved, 'pos')).toMatchObject({ on: false, source: 'override' });
    // analytics needs pos or order_intake, both off.
    expect(feature(resolved, 'analytics')).toMatchObject({
      on: false,
      source: 'override',
      reason: 'dependency_missing',
    });
    const granted = resolveEntitlements(inputs([pos], [grant]), now);
    expect(feature(granted, 'analytics')).toMatchObject({
      on: true,
      source: 'override',
      until: at('2026-12-01').toISOString(),
    });
  });

  it('ignores an expired or revoked override', () => {
    const pos = featureTerm('pos', at('2026-10-01'));
    const expired = override({
      kind: 'grant',
      featureKey: 'analytics',
      expiresAt: at('2026-11-05'),
    });
    const revoked = override({ kind: 'deny', featureKey: 'pos', revokedAt: at('2026-11-02') });
    const resolved = resolveEntitlements(inputs([pos], [expired, revoked]), now);
    expect(feature(resolved, 'analytics')?.on).toBe(false);
    expect(feature(resolved, 'pos')).toMatchObject({ on: true, source: 'agreement' });
  });

  it('turns off a feature whose dependency is off, through chains (edge case 10)', () => {
    const terms = [
      featureTerm('kitchen_display', at('2026-10-01')),
      featureTerm('marketplace_listing', at('2026-10-01')),
      featureTerm('vertex_delivery', at('2026-10-01')),
    ];
    const resolved = resolveEntitlements(inputs(terms), now);
    for (const key of ['kitchen_display', 'marketplace_listing', 'vertex_delivery']) {
      expect(feature(resolved, key), key).toMatchObject({
        on: false,
        source: 'agreement',
        reason: 'dependency_missing',
      });
    }
    const withIntake = resolveEntitlements(
      inputs([...terms, featureTerm('order_intake', at('2026-10-01'))]),
      now,
    );
    expect(feature(withIntake, 'marketplace_listing')?.on).toBe(true);
    expect(feature(withIntake, 'vertex_delivery')?.on).toBe(true);
    expect(feature(withIntake, 'kitchen_display')?.on).toBe(false);
  });

  it('gives a dependent feature the time its dependency stops', () => {
    const end = at('2026-11-20', '04:00');
    const resolved = resolveEntitlements(
      inputs([
        featureTerm('pos', at('2026-10-01'), end),
        featureTerm('waiter_app', at('2026-10-01')),
      ]),
      now,
    );
    expect(feature(resolved, 'waiter_app')?.until).toBe(end.toISOString());
  });

  it('takes a limit from an override, else the agreement, else unlimited', () => {
    const staff = limitTerm('staff', 5, at('2026-10-01'));
    const devices = limitTerm('devices', 2, at('2026-10-01'));
    const raised = override({ kind: 'limit', limitKey: 'devices', value: 4 });
    const resolved = resolveEntitlements(inputs([staff, devices], [raised]), now);
    expect(limit(resolved, 'staff')).toEqual({ key: 'staff', value: 5, source: 'agreement' });
    expect(limit(resolved, 'devices')).toEqual({ key: 'devices', value: 4, source: 'override' });
    expect(limit(resolved, 'branches')).toEqual({
      key: 'branches',
      value: null,
      source: 'default',
    });
    expect(resolved.validUntil).toBe(at('2026-12-01').toISOString());
  });

  it('gives the same result at the same instant, so a recompute bumps no version', () => {
    const data = inputs([featureTerm('pos', at('2026-10-01'))]);
    const first = resolveEntitlements(data, now);
    expect(sameEntitlements(first, resolveEntitlements(data, at('2026-11-11')))).toBe(true);
    const changed = resolveEntitlements(
      inputs(
        [featureTerm('pos', at('2026-10-01'))],
        [override({ kind: 'deny', featureKey: 'pos' })],
      ),
      now,
    );
    expect(sameEntitlements(first, changed)).toBe(false);
    expect(isEntitled(first, 'pos')).toBe(true);
    expect(isEntitled(changed, 'pos')).toBe(false);
  });
});

describe('the branch copy', () => {
  const end = at('2026-11-30', '04:00');
  const resolved = resolveEntitlements(
    inputs([
      featureTerm('pos', at('2026-10-01')),
      featureTerm('waiter_app', at('2026-10-01'), end),
      limitTerm('devices', 3, at('2026-10-01')),
    ]),
    now,
  );

  it('holds the entitled keys and set limits only, no money', () => {
    expect(branchEntitlementsCopy(resolved)).toEqual({
      features: [
        { key: 'pos', until: null },
        { key: 'waiter_app', until: end.toISOString() },
      ],
      limits: { devices: 3 },
    });
  });

  it('lets the hub refuse an unlisted feature or one whose removal time has come (rule 24)', () => {
    const { features } = branchEntitlementsCopy(resolved);
    expect(isBranchFeatureEntitled(features, 'pos', now)).toBe(true);
    expect(isBranchFeatureEntitled(features, 'waiter_app', new Date(end.getTime() - 1))).toBe(true);
    expect(isBranchFeatureEntitled(features, 'waiter_app', end)).toBe(false);
    expect(isBranchFeatureEntitled(features, 'kitchen_display', now)).toBe(false);
  });

  it('has a 7-day lease after the last sync (rule 26)', () => {
    const synced = at('2026-11-01', '10:00');
    expect(isEntitlementLeaseExpired(synced, at('2026-11-08', '10:00'))).toBe(false);
    expect(isEntitlementLeaseExpired(synced, at('2026-11-08', '10:01'))).toBe(true);
    expect(isEntitlementLeaseExpired(null, now)).toBe(true);
  });
});

describe('assertWithinLimit', () => {
  const resolved = resolveEntitlements(inputs([limitTerm('staff', 3, at('2026-10-01'))]), now);

  it('refuses an addition at the limit and allows one below it or when unlimited', () => {
    expect(() => assertWithinLimit(resolved, 'staff', 2)).not.toThrow();
    expect(() => assertWithinLimit(resolved, 'devices', 500)).not.toThrow();
    for (const usage of [3, 5]) {
      try {
        assertWithinLimit(resolved, 'staff', usage);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('ENTITLEMENT_LIMIT_REACHED');
        expect((error as DomainError).details).toEqual({ limit: 'staff', value: 3, usage });
      }
    }
  });
});
