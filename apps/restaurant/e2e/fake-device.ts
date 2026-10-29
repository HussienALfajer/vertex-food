import type { Page } from '@playwright/test';
import type { StaffPermission, StaffRole } from '@vertex-food/contracts';
import type {
  BranchEntitlementsView,
  BranchNetworkView,
  CommandResultView,
  HubView,
  SyncStatusView,
} from '../electron/bridge.js';
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
  /** Owners and managers sign in by password to replace a forgotten PIN (rule 22). */
  password?: string;
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
  /** The open session came by password: the member chooses a new PIN first (rule 22). */
  choosePin?: boolean;
  /** The local database failed `integrity_check` (spec S04): the corrupt-database notice. */
  localDatabase?: 'corrupt';
  /** The sync client and hub (`window.vertexSync`, spec S04); null for none. */
  sync: FakeSync | null;
};

/**
 * The main process's sync side as `SyncBridge` shows it: the status, the branch network, this
 * PC's results and the manual promotion's warning. The fake applies the bridge's rules: pairing,
 * revoking and network checks need a PIN session with `hub.manage`, pairing only on the hub, and
 * promotion checks the member's PIN like `local-pins.ts`.
 */
export type FakeSync = {
  view: SyncStatusView;
  network: BranchNetworkView;
  results: CommandResultView[];
  preview: { missing: number; rejoining: boolean };
  /** The branch's last synced entitlements (spec S05): the full restaurant app by default. */
  entitlements: BranchEntitlementsView | null;
};

const syncedAt = '2026-10-29T07:42:00.000Z';

/** The other hub-capable PC of the fake branch. */
export const standbyPcId = syntheticId();

/** A hub status (`HubStatus`): the live hub with its standby in sync unless changed. */
export function hubStatus(
  change: Partial<NonNullable<HubView['status']>> = {},
): NonNullable<HubView['status']> {
  return {
    role: 'hub',
    epoch: 3,
    appliedSeq: 120,
    hubDeviceId: null,
    rejoining: false,
    notice: null,
    standby: 'in_sync',
    missing: 0,
    ...change,
  };
}

/** This PC as the branch's synced hub, with a standby beside it. */
export function fakeSync(
  selfId: string,
  change: {
    sync?: Partial<SyncStatusView['sync']>;
    hub?: Partial<HubView> | null;
    updateReady?: SyncStatusView['updateReady'];
    network?: Partial<BranchNetworkView>;
    results?: CommandResultView[];
    preview?: FakeSync['preview'];
    entitlements?: BranchEntitlementsView | null;
  } = {},
): FakeSync {
  return {
    view: {
      sync: {
        connectivity: 'online',
        lastHeartbeatAt: syncedAt,
        updateRequired: false,
        protocolRefused: false,
        pendingUploads: 0,
        lastSyncedAt: syncedAt,
        connected: true,
        ...change.sync,
      },
      hub:
        change.hub === null
          ? null
          : {
              status: hubStatus(),
              configuredRole: 'hub',
              addressChanged: false,
              pairingOpen: false,
              outbox: { sending: 0, unmirrored: 0 },
              ...change.hub,
            },
      updateReady: change.updateReady ?? null,
    },
    network: {
      pcs: [
        {
          deviceId: selfId,
          name: 'الكاشير 1',
          active: true,
          hubRole: 'hub',
          publicKey: null,
          addresses: ['192.168.1.20'],
          self: true,
        },
        {
          deviceId: standbyPcId,
          name: 'الكاشير 2',
          active: true,
          hubRole: 'standby',
          publicKey: null,
          addresses: ['192.168.1.21'],
          self: false,
        },
      ],
      pairings: [],
      networkChecks: [],
      ...change.network,
    },
    results: change.results ?? [],
    preview: change.preview ?? { missing: 0, rejoining: false },
    entitlements:
      change.entitlements === undefined
        ? {
            copy: {
              version: 1,
              features: [{ key: 'pos', until: null }],
              limits: {},
              updatedAt: syncedAt,
            },
            lastSyncedAt: syncedAt,
            leaseExpired: false,
          }
        : change.entitlements,
  };
}

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
      [
        'tenant.view',
        'branch.hours.edit',
        'staff.manage',
        'devices.manage',
        'hub.manage',
        'sync.attention.resolve',
        'sync.quarantine.review',
      ],
      '602847',
      { usedThisDevice: true },
    ),
  manager: () =>
    fakeMember(
      'ليلى المديرة',
      ['manager'],
      [
        'tenant.view',
        'branch.hours.edit',
        'staff.manage',
        'devices.manage',
        'hub.manage',
        'sync.attention.resolve',
      ],
      '517390',
      { usedThisDevice: true },
    ),
  cashier: () =>
    fakeMember('أحمد الكاشير', ['cashier'], ['tenant.view'], '482916', { usedThisDevice: true }),
  newcomer: () => fakeMember('رنا الجديدة', ['waiter'], ['tenant.view'], '739105'),
};

export function fakeDevice(tenantId: string, overrides: Partial<FakeDevice> = {}): FakeDevice {
  const device = overrides.device ?? { id: syntheticId(), name: 'الكاشير 1' };
  return {
    state: 'registered',
    tenantName: 'مطعم تجريبي',
    tenant: { id: tenantId, nameAr: 'مطعم تجريبي', status: 'active', logoFileId: null },
    branch: { id: syntheticId(), nameAr: 'فرع اعزاز', idleLockMinutes: 5 },
    device,
    sync: fakeSync(device.id),
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
        state.choosePin = false;
        changed();
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
            pinDisabledOnline: Boolean(member.pinDisabled),
            pinDisabledHere: member.localDisabled,
            usedThisDevice: Boolean(member.usedThisDevice),
          })),
          window: state.window,
          online: scope.navigator.onLine,
          ...(state.localDatabase ? { localDatabase: state.localDatabase } : {}),
          session: state.sessionMemberId
            ? {
                membershipId: state.sessionMemberId,
                online: scope.navigator.onLine,
                choosePin: Boolean(state.choosePin),
              }
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
      signInByPassword: async (input: { membershipId: string; password: string }) => {
        if (!scope.navigator.onLine) return { ok: false, code: 'NETWORK_ERROR' };
        const member = find(input.membershipId);
        if (!member?.password || member.password !== input.password) {
          return { ok: false, code: 'INVALID_CREDENTIALS' };
        }
        state.sessionMemberId = member.membershipId;
        state.choosePin = true;
        changed();
        return { ok: true };
      },
      lock: async () => {
        state.sessionMemberId = null;
        state.choosePin = false;
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
        if (target.pinDisabled) return { ok: false, code: 'PIN_DISABLED' };
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

    const sync = state.sync;
    if (!sync) return;
    const syncListeners = new Set<() => void>();
    const syncChanged = () => {
      for (const listener of syncListeners) listener();
    };
    const forbidden = { ok: false, code: 'FORBIDDEN' } as const;
    // The member of the PIN session, when they hold `hub.manage` (rules 33, 36).
    const manager = () => {
      const member = state.sessionMemberId ? find(state.sessionMemberId) : undefined;
      return member?.permissions.includes('hub.manage') ? member : undefined;
    };
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const later = (from: number, ms: number) => new Date(from + ms).toISOString();
    const randomId = () =>
      (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
    const syncBridge = {
      status: async () => copy(sync.view),
      network: async () => (sync.view.hub ? copy(sync.network) : null),
      openPairing: async () => {
        if (!manager()) return forbidden;
        const hub = sync.view.hub;
        if (hub?.status?.role !== 'hub') return { ok: false, code: 'NOT_HUB' };
        hub.pairingOpen = true;
        syncChanged();
        const code = '482613';
        const fingerprint = 'a3f1'.repeat(16);
        return {
          ok: true,
          value: {
            code,
            closesAt: later(Date.now(), 120_000),
            caFingerprint: fingerprint,
            pairingUrl: `https://192.168.1.20:7443/pair#peers=192.168.1.20,192.168.1.21&fp=${fingerprint}&code=${code}`,
            caUrl: 'http://192.168.1.20:7080/ca.crt',
          },
        };
      },
      closePairing: async () => {
        if (sync.view.hub) sync.view.hub.pairingOpen = false;
        syncChanged();
      },
      revokePairing: async (pairingId: string) => {
        if (!manager()) return forbidden;
        sync.network.pairings = sync.network.pairings.filter((item) => item.id !== pairingId);
        syncChanged();
        return { ok: true };
      },
      promotionPreview: async () => ({ ok: true, value: sync.preview }),
      promote: async (input: { membershipId: string; pin: string }) => {
        const member = find(input.membershipId);
        if (!member?.permissions.includes('hub.manage')) return forbidden;
        const result = check(member, input.pin);
        const status = sync.view.hub?.status;
        if (result.ok && status) {
          status.role = 'hub';
          status.rejoining = false;
          status.epoch += 1;
          status.standby = 'not_in_sync';
          for (const pc of sync.network.pcs) pc.hubRole = pc.self ? 'hub' : 'standby';
        }
        syncChanged();
        return result;
      },
      sendNetworkCheck: async (input: { run: string; sequence: number }) => {
        const member = manager();
        if (!member) return forbidden;
        const id = randomId();
        const sent = Date.now();
        const connected = sync.view.sync.connected;
        sync.network.networkChecks.unshift({
          commandId: id,
          run: input.run,
          sequence: input.sequence,
          originDeviceId: state.device.id,
          sentAt: later(sent, 0),
          receivedAt: later(sent, 12),
          mirroredAt: sync.view.hub?.status?.standby === 'none' ? null : later(sent, 21),
          committedAt: later(sent, 25),
        });
        sync.network.networkChecks = sync.network.networkChecks.slice(0, 20);
        sync.results.unshift({
          id,
          name: 'sync.network_check',
          membershipId: member.membershipId,
          outcome: connected ? 'accepted' : null,
          reason: null,
          madeAt: later(sent, 0),
          answeredAt: connected ? later(sent, 410) : null,
        });
        if (!connected) {
          sync.view.sync.pendingUploads = (sync.view.sync.pendingUploads ?? 0) + 1;
        }
        syncChanged();
        return { ok: true, value: { commandId: id } };
      },
      results: async () => copy(sync.results),
      entitlements: async () => copy(sync.entitlements),
      onChange: (listener: () => void) => {
        syncListeners.add(listener);
        return () => syncListeners.delete(listener);
      },
    };
    Object.assign(globalThis, {
      vertexSync: syncBridge,
      __fakeSync: {
        update: (change: Partial<FakeSync>) => {
          Object.assign(sync, change);
          syncChanged();
        },
      },
    });
  }, seed);
}

/** Changes the fake sync in the open page, as the main process would (a cut, a new role). */
export async function updateFakeSync(page: Page, change: Partial<FakeSync>): Promise<void> {
  await page.evaluate((next) => {
    (globalThis as unknown as { __fakeSync: { update: (c: unknown) => void } }).__fakeSync.update(
      next,
    );
  }, change);
}

/** Changes the fake PC in the open page, as the main process would (a revocation, a sync). */
export async function updateFakeDevice(page: Page, change: Partial<FakeDevice>): Promise<void> {
  await page.evaluate((next) => {
    (
      globalThis as unknown as { __fakeDevice: { update: (c: unknown) => void } }
    ).__fakeDevice.update(next);
  }, change);
}
