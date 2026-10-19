import type { Tenant } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { ownerAccess, type StaffAccess } from '../../lib/staff-access';
import { isTenantWritable, onboardingView, statusBanner } from './tenant-status';

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
  onboarding: { complete: false, missing: [] },
  logoFileId: null,
  coverFileId: null,
  branchCount: 1,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
};

const cashier: StaffAccess = { permissions: new Set(['tenant.view']), branchIds: ['b1'] };
const now = new Date('2026-10-20T12:00:00.000Z');

describe('onboarding view (rule 5)', () => {
  it('sends the owner to the wizard until onboarding is complete', () => {
    expect(onboardingView(tenant, ownerAccess, '/')).toBe('redirect-to-setup');
    expect(onboardingView(tenant, ownerAccess, '/settings/restaurant')).toBe('redirect-to-setup');
    expect(onboardingView(tenant, ownerAccess, '/setup')).toBeUndefined();
  });

  it('lets the owner into the app once onboarding is complete', () => {
    const complete = { ...tenant, onboardingCompletedAt: '2026-10-19T10:00:00.000Z' };
    expect(onboardingView(complete, ownerAccess, '/')).toBeUndefined();
    expect(onboardingView(complete, ownerAccess, '/setup')).toBeUndefined();
  });

  it('shows "setup in progress" to every other staff member', () => {
    expect(onboardingView(tenant, cashier, '/')).toBe('setup-in-progress');
    expect(onboardingView(tenant, cashier, '/setup')).toBe('setup-in-progress');
  });

  it('leaves the wizard once the restaurant is active', () => {
    const active = { ...tenant, status: 'active' as const };
    expect(onboardingView(active, ownerAccess, '/setup')).toBe('redirect-home');
    expect(onboardingView(active, cashier, '/')).toBeUndefined();
  });
});

describe('status banner', () => {
  it('shows nothing for an active restaurant without a scheduled change', () => {
    expect(statusBanner({ ...tenant, status: 'active' }, now)).toBeUndefined();
    expect(statusBanner(tenant, now)).toBeUndefined();
  });

  it('shows a scheduled suspension with its time and reason', () => {
    const scheduled = {
      ...tenant,
      status: 'active' as const,
      scheduledChange: {
        status: 'suspended' as const,
        reason: 'non_payment' as const,
        at: '2026-10-21T01:00:00.000Z',
      },
    };
    expect(statusBanner(scheduled, now)).toEqual({
      kind: 'scheduled',
      status: 'suspended',
      at: '2026-10-21T01:00:00.000Z',
      reason: 'non_payment',
    });
  });

  it('shows a suspension with its reason, and makes the restaurant read-only', () => {
    const suspended = { ...tenant, status: 'suspended' as const, statusReason: 'abuse' as const };
    expect(statusBanner(suspended, now)).toEqual({ kind: 'suspended', reason: 'abuse' });
    expect(isTenantWritable(suspended)).toBe(false);
  });

  it("counts the owner's remaining read days after a closure", () => {
    const closed = {
      ...tenant,
      status: 'closed' as const,
      statusReason: 'other' as const,
      ownerReadUntil: '2026-11-01T11:00:00.000Z',
    };
    expect(statusBanner(closed, now)).toEqual({ kind: 'closed', days: 12 });
    expect(statusBanner({ ...closed, ownerReadUntil: '2026-10-01T00:00:00.000Z' }, now)).toEqual({
      kind: 'closed',
      days: 0,
    });
    expect(isTenantWritable(closed)).toBe(false);
  });

  it('tells the owner a completed setup waits for activation', () => {
    const complete = { ...tenant, onboardingCompletedAt: '2026-10-19T10:00:00.000Z' };
    expect(statusBanner(complete, now)).toEqual({ kind: 'awaiting-activation' });
    expect(isTenantWritable(complete)).toBe(true);
  });
});
