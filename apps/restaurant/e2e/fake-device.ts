import type { Page } from '@playwright/test';
import type { StaffPermission, StaffRole } from '@vertex-food/contracts';
import { syntheticId } from './mock-api.js';

/**
 * A stand-in for the Electron main process in the browser (`window.vertexDevice`, `bridge.ts`): the
 * E2E runs the renderer in Chromium without Electron. It keeps the PC's state in the page and
 * applies the same rules as `electron/local-pins.ts` (five wrong PINs disable a PIN here, the
 * window's post-window rule, approvers holding the permission, a manager re-enabling); the main
 * process itself is unit-tested. PINs are in clear here only: synthetic test values.
 */
export type FakeMember = {
  membershipId: string;
  name: string;
  roles: StaffRole[];
  permissions: StaffPermission[];
  pin: string | null;
  pinDisabled?: boolean;
  usedThisDevice?: boolean;
};

export type FakeDevice = {
  state: 'unregistered' | 'registered' | 'wiped';
  tenantName: string;
  tenant: { id: string; nameAr: string; status: 'active'; logoFileId: null };
  branch: { id: string; nameAr: string; idleLockMinutes: number };
  device: { id: string; name: string };
  members: FakeMember[];
  /** Who registers the PC: their session opens at registration. */
  registrantId: string | null;
  window: { open: boolean; daysSinceSync: number; warn: boolean; clockBehind: boolean };
  sessionMemberId: string | null;
};

export function fakeMember(
  name: string,
  roles: StaffRole[],
  permissions: StaffPermission[],
  pin: string | null,
  extra: Partial<FakeMember> = {},
): FakeMember {
  return { membershipId: syntheticId(), name, roles, permissions, pin, ...extra };
}

export const team = {
  owner: () =>
    fakeMember(
      'سامر المالك',
      ['owner'],
      ['tenant.view', 'branch.hours.edit', 'staff.manage', 'devices.manage'],
      '602847',
      { usedThisDevice: true },
    ),
  manager: () =>
    fakeMember(
      'ليلى المديرة',
      ['manager'],
      ['tenant.view', 'branch.hours.edit', 'staff.manage', 'devices.manage'],
      '517390',
      { usedThisDevice: true },
    ),
  cashier: () =>
    fakeMember('أحمد الكاشير', ['cashier'], ['tenant.view'], '482916', { usedThisDevice: true }),
  newcomer: () => fakeMember('رنا الجديدة', ['waiter'], ['tenant.view'], '739105'),
};

export function fakeDevice(tenantId: string, overrides: Partial<FakeDevice> = {}): FakeDevice {
  return {
    state: 'registered',
    tenantName: 'مطعم تجريبي',
    tenant: { id: tenantId, nameAr: 'مطعم تجريبي', status: 'active', logoFileId: null },
    branch: { id: syntheticId(), nameAr: 'فرع اعزاز', idleLockMinutes: 5 },
    device: { id: syntheticId(), name: 'الكاشير 1' },
    members: [],
    registrantId: null,
    window: { open: true, daysSinceSync: 0, warn: false, clockBehind: false },
    sessionMemberId: null,
    ...overrides,
  };
}

/** Installs the fake before the app loads; `window.__fakeDevice` lets a test change it. */
export async function installFakeDevice(page: Page, seed: FakeDevice): Promise<void> {
  await page.addInitScript((initial: FakeDevice) => {
    type Member = FakeMember & { failures: number; localDisabled: boolean };
    // The page's globals (this tsconfig has no DOM types).
    const scope = globalThis as unknown as { fetch: typeof fetch; navigator: { onLine: boolean } };
    const state = {
      ...initial,
      members: initial.members.map((member) => ({ ...member, failures: 0, localDisabled: false })),
    };
    const listeners = new Set<() => void>();
    const changed = () => {
      for (const listener of listeners) listener();
    };
    const find = (id: string) => state.members.find((member) => member.membershipId === id);
    const disabled = (member: Member) => Boolean(member.pinDisabled) || member.localDisabled;
    const check = (member: Member, pin: string) => {
      if (!member.pin) return { ok: false, code: 'MEMBERSHIP_INACTIVE' };
      if (disabled(member)) return { ok: false, code: 'PIN_DISABLED' };
      if (member.pin === pin) {
        member.failures = 0;
        return { ok: true };
      }
      member.failures += 1;
      if (member.failures >= 5) member.localDisabled = true;
      return { ok: false, code: member.localDisabled ? 'PIN_DISABLED' : 'INVALID_PIN' };
    };
    // The PIN a member chose reaches the API; the fake learns it from the request, as the real
    // PC learns its verifier from the next member list.
    const fetchOriginal = scope.fetch.bind(globalThis);
    scope.fetch = async (input, init) => {
      // Copied before it is sent: sending reads the body.
      const request = (input instanceof Request ? input : new Request(input, init)).clone();
      const response = await fetchOriginal(input, init);
      if (response.ok && request.method === 'PUT' && request.url.endsWith('/api/me/pin')) {
        const { newPin } = (await request.json()) as { newPin: string };
        const member = state.sessionMemberId ? find(state.sessionMemberId) : undefined;
        if (member) member.pin = newPin;
      }
      return response;
    };

    const bridge = {
      status: async () => {
        if (state.state === 'unregistered') return { state: 'unregistered' };
        if (state.state === 'wiped') return { state: 'wiped', tenantName: state.tenantName };
        return {
          state: 'registered',
          tenant: state.tenant,
          branch: state.branch,
          device: state.device,
          members: state.members.map((member) => ({
            membershipId: member.membershipId,
            name: member.name,
            roles: member.roles,
            permissions: member.permissions,
            hasPin: member.pin !== null,
            pinDisabled: disabled(member),
            usedThisDevice: Boolean(member.usedThisDevice),
          })),
          window: state.window,
          online: scope.navigator.onLine,
          session: state.sessionMemberId
            ? { membershipId: state.sessionMemberId, online: scope.navigator.onLine }
            : null,
        };
      },
      register: async (input: { ticket: string; name: string }) => {
        if (!scope.navigator.onLine) return { ok: false, code: 'NETWORK_ERROR' };
        state.state = 'registered';
        state.device = { ...state.device, name: input.name };
        state.sessionMemberId = state.registrantId;
        changed();
        return { ok: true };
      },
      signIn: async (input: { membershipId: string; pin: string }) => {
        const member = find(input.membershipId);
        if (!member) return { ok: false, code: 'MEMBERSHIP_INACTIVE' };
        if (!disabled(member) && !state.window.open && !member.usedThisDevice) {
          return { ok: false, code: 'OFFLINE_WINDOW_EXPIRED' };
        }
        const result = check(member, input.pin);
        if (result.ok) {
          member.usedThisDevice = true;
          state.sessionMemberId = member.membershipId;
        }
        changed();
        return result;
      },
      lock: async () => {
        state.sessionMemberId = null;
        changed();
      },
      accessToken: async () =>
        state.sessionMemberId && scope.navigator.onLine ? 'fake-access' : null,
      refresh: async () => changed(),
      approve: async (input: {
        permission: StaffPermission;
        actingMembershipId: string;
        approverMembershipId: string;
        pin: string;
      }) => {
        const approver = find(input.approverMembershipId);
        if (
          !approver ||
          approver.membershipId === input.actingMembershipId ||
          !approver.permissions.includes(input.permission)
        ) {
          return { ok: false, code: 'APPROVER_NOT_ALLOWED' };
        }
        const result = check(approver, input.pin);
        changed();
        return result;
      },
      reenablePin: async (input: {
        membershipId: string;
        managerMembershipId: string;
        pin: string;
      }) => {
        const target = find(input.membershipId);
        const manager = find(input.managerMembershipId);
        if (!(target && manager?.permissions.includes('staff.manage'))) {
          return { ok: false, code: 'FORBIDDEN' };
        }
        const result = check(manager, input.pin);
        if (result.ok) {
          target.localDisabled = false;
          target.failures = 0;
        }
        changed();
        return result;
      },
      dismissWipe: async () => {
        state.state = 'unregistered';
        changed();
      },
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    Object.assign(globalThis, {
      vertexDevice: bridge,
      __fakeDevice: {
        update: (change: Partial<FakeDevice>) => {
          Object.assign(state, change);
          changed();
        },
      },
    });
  }, seed);
}

/** Changes the fake PC in the open page, as the main process would (a revocation, a sync). */
export async function updateFakeDevice(page: Page, change: Partial<FakeDevice>): Promise<void> {
  await page.evaluate((next) => {
    (
      globalThis as unknown as { __fakeDevice: { update: (c: unknown) => void } }
    ).__fakeDevice.update(next);
  }, change);
}
