import type { Tenant } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { resumeStep } from './setup-steps';

const branchId = '0199f000-0000-7000-8000-000000000002';

const tenant: Tenant = {
  id: '0199f000-0000-7000-8000-000000000001',
  slug: 'test-grill',
  nameAr: 'مطعم تجريبي',
  nameLatin: null,
  defaultCurrency: 'USD',
  status: 'onboarding',
  statusReason: null,
  statusChangedAt: '2026-10-19T09:00:00.000Z',
  scheduledChange: null,
  onboardingCompletedAt: null,
  activatedAt: null,
  closedAt: null,
  ownerReadUntil: null,
  onboarding: {
    complete: false,
    missing: [
      { item: 'branch.city', branchId },
      { item: 'branch.hours', branchId },
    ],
  },
  logoFileId: null,
  coverFileId: null,
  branchCount: 1,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
};

describe('resume step (rule 3)', () => {
  it('starts a restaurant nobody has edited at the first step', () => {
    expect(resumeStep(tenant)).toBe('restaurant');
  });

  it('resumes at the first step with a missing item', () => {
    const edited = { ...tenant, updatedAt: '2026-10-19T10:00:00.000Z' };
    expect(resumeStep(edited)).toBe('location');
    expect(
      resumeStep({
        ...edited,
        onboarding: { complete: false, missing: [{ item: 'branch.currency', branchId }] },
      }),
    ).toBe('money');
  });

  it('opens the review once nothing is missing', () => {
    expect(
      resumeStep({
        ...tenant,
        updatedAt: '2026-10-19T10:00:00.000Z',
        onboarding: { complete: true, missing: [] },
      }),
    ).toBe('review');
  });
});
