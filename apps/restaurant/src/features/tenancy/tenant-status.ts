import type { Tenant, TenantStatusReason } from '@vertex-food/contracts';
import { can, type StaffAccess } from '../../lib/staff-access';

// What the tenant's status means for the restaurant app (S01 rules 5, 8, 9), kept pure.

/** A suspended or closed restaurant keeps reading its data but changes nothing (rules 8, 9). */
export function isTenantWritable(tenant: Tenant): boolean {
  return tenant.status !== 'suspended' && tenant.status !== 'closed';
}

/**
 * What stands in for the app's screens while the restaurant is onboarding (rule 5): the owner gets
 * the wizard until it is complete, then the waiting screen at `/setup` and the app with a banner;
 * every other staff member gets "setup in progress". `undefined`: the screen itself.
 */
export function onboardingView(
  tenant: Tenant,
  access: StaffAccess,
  pathname: string,
): 'redirect-to-setup' | 'redirect-home' | 'setup-in-progress' | undefined {
  const onSetup = pathname === '/setup';
  if (tenant.status !== 'onboarding') return onSetup ? 'redirect-home' : undefined;
  if (!can(access, 'tenant.profile.edit')) return 'setup-in-progress';
  if (!tenant.onboardingCompletedAt && !onSetup) return 'redirect-to-setup';
  return undefined;
}

/** The longest a browser timer waits (2³¹ − 1 ms, about 24.8 days); a later one re-arms. */
const MAX_TIMER_MS = 2_147_483_647;
/** A server clock a little behind the device's is asked again after this long. */
const RECHECK_MIN_MS = 1000;

/**
 * How long until the tenant is read again for its scheduled change at `at` (UX-03): until the
 * deadline, clamped to what a timer can wait; at least a second, so an answer that still shows
 * the change pending is asked again soon, never in a loop. `readAt`: when the tenant was read.
 */
export function scheduledRecheckDelay(at: string, now: number, readAt: number): number {
  const due = Date.parse(at) - now;
  const sinceRead = now - readAt;
  const floor = Math.max(0, RECHECK_MIN_MS - sinceRead);
  return Math.min(MAX_TIMER_MS, Math.max(floor, due));
}

export type StatusBanner =
  | { kind: 'scheduled'; status: 'suspended' | 'closed'; at: string; reason: TenantStatusReason }
  | { kind: 'suspended'; reason: TenantStatusReason }
  | { kind: 'closed'; days: number }
  | { kind: 'awaiting-activation' };

const DAY_MS = 86_400_000;

/**
 * The banner every screen shows for the tenant's status (S01 screens): a scheduled suspension or
 * closure with its time; suspended with its reason; closed with the owner's remaining read days;
 * onboarding complete, waiting for Vertex to activate it.
 */
export function statusBanner(tenant: Tenant, now: Date): StatusBanner | undefined {
  if (tenant.status === 'suspended') {
    return { kind: 'suspended', reason: tenant.statusReason ?? 'other' };
  }
  if (tenant.status === 'closed') {
    const until = tenant.ownerReadUntil ? Date.parse(tenant.ownerReadUntil) : now.getTime();
    return { kind: 'closed', days: Math.max(0, Math.ceil((until - now.getTime()) / DAY_MS)) };
  }
  if (tenant.scheduledChange) {
    return {
      kind: 'scheduled',
      status: tenant.scheduledChange.status,
      at: tenant.scheduledChange.at,
      reason: tenant.scheduledChange.reason,
    };
  }
  if (tenant.status === 'onboarding' && tenant.onboardingCompletedAt) {
    return { kind: 'awaiting-activation' };
  }
  return undefined;
}
