import { describe, expect, it } from 'vitest';
import {
  type AgreementFeature,
  featureView,
  formatPercentBp,
  limitView,
  offlineView,
  scheduledRemovals,
  shownFeatures,
} from './agreement-view';

const until = '2026-11-30T01:00:00.000Z';

function feature(change: Partial<AgreementFeature> = {}): AgreementFeature {
  return {
    key: 'pos',
    on: true,
    source: 'agreement',
    reason: null,
    until: null,
    private: false,
    ...change,
  };
}

describe('featureView (rule 28)', () => {
  it('says where an entitled feature comes from', () => {
    expect(featureView(feature())).toEqual({
      key: 'pos',
      on: true,
      source: { kind: 'agreement' },
      stopsAt: null,
    });
    expect(
      featureView(feature({ key: 'custom_fields', private: true, source: 'override' })),
    ).toMatchObject({ source: { kind: 'private' }, stopsAt: null });
  });

  it('shows a grant by override with its end as a trial', () => {
    expect(featureView(feature({ key: 'analytics', source: 'override', until }))).toMatchObject({
      on: true,
      source: { kind: 'trial', until },
      stopsAt: null,
    });
  });

  it('shows a scheduled removal of an agreement or private feature (rules 7, 14)', () => {
    expect(featureView(feature({ key: 'waiter_app', until })).stopsAt).toBe(until);
    expect(
      featureView(feature({ key: 'custom_fields', private: true, source: 'override', until }))
        .stopsAt,
    ).toBe(until);
  });

  it('marks a feature that is off, and one off for a missing dependency', () => {
    expect(featureView(feature({ key: 'loyalty', on: false, source: 'default' })).source).toEqual({
      kind: 'off',
    });
    expect(
      featureView(
        feature({ key: 'kitchen_display', on: false, reason: 'dependency_missing', until }),
      ),
    ).toMatchObject({ on: false, source: { kind: 'dependencyMissing' }, stopsAt: null });
    // A deny override is off like any other.
    expect(featureView(feature({ on: false, source: 'override' })).source.kind).toBe('off');
  });
});

describe('shownFeatures', () => {
  it('lists the features that are on first and hides private features that are off', () => {
    const shown = shownFeatures([
      feature({ key: 'pos', on: false, source: 'default' }),
      feature({ key: 'custom_fields', on: false, private: true, source: 'default' }),
      feature({ key: 'analytics', source: 'override', until }),
      feature({ key: 'custom_domain', private: true, source: 'override' }),
    ]);
    expect(shown.map((item) => [item.key, item.on])).toEqual([
      ['analytics', true],
      ['custom_domain', true],
      ['pos', false],
    ]);
  });
});

describe('limitView', () => {
  it('fills the bar by usage and marks usage above a lowered limit (edge case 9)', () => {
    expect(limitView({ key: 'devices', usage: 2, value: 3, source: 'agreement' })).toEqual({
      key: 'devices',
      usage: 2,
      value: 3,
      share: 2 / 3,
      over: false,
    });
    expect(limitView({ key: 'devices', usage: 3, value: 3, source: 'agreement' })).toMatchObject({
      share: 1,
      over: false,
    });
    expect(limitView({ key: 'staff', usage: 5, value: 3, source: 'override' })).toMatchObject({
      share: 1,
      over: true,
    });
    expect(limitView({ key: 'branches', usage: 0, value: 0, source: 'agreement' }).share).toBe(1);
  });

  it('draws no bar for an unlimited limit', () => {
    expect(limitView({ key: 'branches', usage: 4, value: null, source: 'default' })).toMatchObject({
      value: null,
      share: 0,
      over: false,
    });
  });
});

describe('formatPercentBp', () => {
  it('writes basis points as a percentage with Latin digits', () => {
    expect(formatPercentBp(1250)).toBe('12.5');
    expect(formatPercentBp(1000)).toBe('10');
    expect(formatPercentBp(5)).toBe('0.05');
  });
});

describe('scheduledRemovals and offlineView (screens 1, 2)', () => {
  const now = new Date('2026-11-29T12:00:00.000Z');
  const copy = {
    version: 4,
    features: [
      { key: 'pos', until: null },
      { key: 'waiter_app', until },
      { key: 'kitchen_display', until: '2026-11-29T01:00:00.000Z' },
      { key: 'analytics', until: '2026-11-29T23:00:00.000Z' },
    ],
    limits: { devices: 3 },
    updatedAt: now.toISOString(),
  };

  it('lists the removals still ahead, soonest first', () => {
    expect(scheduledRemovals(copy, now)).toEqual([
      { key: 'analytics', until: '2026-11-29T23:00:00.000Z' },
      { key: 'waiter_app', until },
    ]);
  });

  it('has nothing to say before the first sync', () => {
    expect(scheduledRemovals(null, now)).toEqual([]);
  });

  it('leaves out of the offline page a feature whose removal time has come, as the hub does', () => {
    // `kitchen_display` stopped at 01:00; the hub refuses its commands `not_entitled` (rule 24).
    expect(offlineView(copy, now).features.map((item) => item.key)).not.toContain(
      'kitchen_display',
    );
  });

  it('gives the offline page every limit, unlimited when the copy sets none', () => {
    const view = offlineView(copy, now);
    expect(view.features).toEqual([
      { key: 'pos', stopsAt: null },
      { key: 'waiter_app', stopsAt: until },
      { key: 'analytics', stopsAt: '2026-11-29T23:00:00.000Z' },
    ]);
    expect(view.limits).toContainEqual({ key: 'devices', value: 3 });
    expect(view.limits).toContainEqual({ key: 'staff', value: null });
  });
});
