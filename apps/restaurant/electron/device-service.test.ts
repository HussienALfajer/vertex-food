import { readFileSync } from 'node:fs';
import type { DeviceMember, MemberList, SessionTokens } from '@vertex-food/contracts';
import { describe, expect, it, vi } from 'vitest';
import { deviceChannels } from './bridge.js';
import { type DeviceApi, DeviceApiError } from './device-client.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import { member, memberList, tempStore, uuid7, verifyPin } from './device-test-kit.js';

const start = new Date('2026-10-20T08:00:00.000Z');

/** The API as a registered PC sees it, in memory: PINs in clear on the fake server only. */
async function fakeApi() {
  const owner = await member('مالك', '602847', {
    roles: ['owner'],
    permissions: ['tenant.view', 'staff.manage', 'devices.manage'],
  });
  const cashier = await member('كاشير', '482916');
  const pins = new Map([
    [owner.membershipId, '602847'],
    [cashier.membershipId, '482916'],
  ]);
  const server = {
    reachable: true,
    revoked: false,
    wipedConfirmed: false,
    now: start,
    list: memberList([owner, cashier], start.toISOString()),
    acked: [] as string[],
    ended: [] as string[],
    refreshed: 0,
  };
  let sessions = 0;
  const tokens = (): SessionTokens => {
    sessions += 1;
    return {
      sessionId: uuid7(),
      accessToken: `access-${sessions}`,
      accessTokenExpiresAt: new Date(server.now.getTime() + 15 * 60_000).toISOString(),
      refreshToken: `refresh-${sessions}`,
      expiresAt: new Date(server.now.getTime() + 12 * 3600_000).toISOString(),
    };
  };
  const reach = () => {
    if (!server.reachable) throw new DeviceApiError('NETWORK_ERROR');
  };
  const device = () => {
    reach();
    if (server.revoked) throw new DeviceApiError('DEVICE_REVOKED');
  };
  const api: DeviceApi = {
    register: vi.fn(async (_ticket, body) => {
      reach();
      return {
        device: {
          id: server.list.device.id,
          branchId: body.branchId,
          name: body.name,
          status: 'active' as const,
          os: body.os,
          appVersion: body.appVersion,
          lastSeenAt: server.now.toISOString(),
          membersSyncedAt: null,
          registeredAt: server.now.toISOString(),
          revokedAt: null,
          revokeReason: null,
          wipedAt: null,
          updatedAt: server.now.toISOString(),
        },
        members: server.list,
        session: tokens(),
      };
    }),
    challenge: vi.fn(async () => {
      reach();
      return { nonce: uuid7(), expiresAt: server.now.toISOString() };
    }),
    token: vi.fn(async () => {
      reach();
      if (server.wipedConfirmed) throw new DeviceApiError('DEVICE_REVOKED');
      return {
        deviceToken: 'device-token',
        expiresAt: new Date(server.now.getTime() + 300_000).toISOString(),
      };
    }),
    members: vi.fn(async (_token, knownVersion) => {
      device();
      return knownVersion === server.list.version
        ? { status: 'not_modified' as const, issuedAt: server.now.toISOString() }
        : {
            status: 'current' as const,
            list: { ...server.list, issuedAt: server.now.toISOString() },
          };
    }),
    acknowledge: vi.fn(async (_token, version) => {
      device();
      server.acked.push(version);
    }),
    wiped: vi.fn(async () => {
      reach();
      server.wipedConfirmed = true;
    }),
    openSession: vi.fn(async (_token, body) => {
      device();
      if (pins.get(body.membershipId) !== body.pin) throw new DeviceApiError('INVALID_PIN');
      return tokens();
    }),
    refreshSession: vi.fn(async (_token, refreshToken) => {
      device();
      if (refreshToken !== `refresh-${sessions}`) throw new DeviceApiError('SESSION_ENDED');
      server.refreshed += 1;
      return tokens();
    }),
    endSession: vi.fn(async (accessToken) => {
      reach();
      server.ended.push(accessToken);
    }),
    me: vi.fn(async () => {
      reach();
      return { membershipId: owner.membershipId } as Awaited<ReturnType<DeviceApi['me']>>;
    }),
  };
  return { api, server, owner, cashier };
}

async function setup() {
  const fake = await fakeApi();
  const { store, path } = tempStore();
  const changed = vi.fn();
  const make = () =>
    new DeviceService({
      store,
      client: fake.api,
      verifyPin,
      generateKey: generateDeviceKey,
      sign: signWithDeviceKey,
      now: () => fake.server.now,
      os: 'win32 10.0',
      appVersion: '0.0.0',
      onChange: changed,
    });
  const service = make();
  const input = {
    ticket: 'ticket',
    tenantId: fake.server.list.tenant.id,
    branchId: fake.server.list.branch.id,
    name: 'الكاشير 1',
  };
  return { ...fake, store, path, service, make, changed, input };
}

async function registered() {
  const context = await setup();
  expect(await context.service.register(context.input)).toEqual({ ok: true });
  return context;
}

const later = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

describe('DeviceService registration (rule 16)', () => {
  it('stores the record, opens the registering member session, shows no verifier', async () => {
    const { service, owner, store, make, changed } = await registered();
    const status = service.status();
    expect(status).toMatchObject({
      state: 'registered',
      session: { membershipId: owner.membershipId, online: true },
      window: { open: true, warn: false },
    });
    expect(JSON.stringify(status)).not.toContain('argon2');
    expect(store.read()?.state).toBe('registered');
    expect(changed).toHaveBeenCalled();
    // A restart reads the registration back, without the session.
    expect(make().status()).toMatchObject({ state: 'registered', session: null });
  });

  it('holds one registration per installation (rule 17)', async () => {
    const { service, input } = await registered();
    expect(await service.register(input)).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('returns the refusal and stores nothing when registration fails', async () => {
    const { service, input, server, store } = await setup();
    server.reachable = false;
    expect(await service.register(input)).toEqual({ ok: false, code: 'NETWORK_ERROR' });
    expect(store.read()).toBeNull();
  });
});

describe('DeviceService PIN sessions (rules 24, 25, 32)', () => {
  it('opens an online session when the API answers, with an access token', async () => {
    const { service, cashier, api } = await registered();
    await service.lock('locked');
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
      ok: true,
    });
    expect(api.openSession).toHaveBeenCalledTimes(1);
    expect(service.status()).toMatchObject({ session: { online: true }, online: true });
    expect(await service.accessToken()).toMatch(/^access-/);
  });

  it('checks the PIN on the PC when the API cannot be reached; no access token', async () => {
    const { service, cashier, server } = await registered();
    await service.lock('locked');
    server.reachable = false;
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '000001' })).toEqual({
      ok: false,
      code: 'INVALID_PIN',
    });
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
      ok: true,
    });
    expect(service.status()).toMatchObject({ session: { online: false }, online: false });
    expect(await service.accessToken()).toBeNull();
  });

  it('counts wrong online PINs on this PC too and then refuses before asking the API', async () => {
    const { service, cashier, api } = await registered();
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await service.signIn({ membershipId: cashier.membershipId, pin: '000001' });
      if (!result.ok) codes.push(result.code);
    }
    expect(codes.at(-1)).toBe('PIN_DISABLED');
    const calls = vi.mocked(api.openSession).mock.calls.length;
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
      ok: false,
      code: 'PIN_DISABLED',
    });
    expect(api.openSession).toHaveBeenCalledTimes(calls);
    const status = service.status();
    expect(
      status.state === 'registered' &&
        status.members.find((m) => m.membershipId === cashier.membershipId)?.pinDisabled,
    ).toBe(true);
  });

  it('locking ends the online session on the server', async () => {
    const { service, server } = await registered();
    await service.lock('idle');
    expect(service.status()).toMatchObject({ session: null });
    expect(server.ended).toEqual(['access-1']);
  });

  it('refreshes the access token before it expires and locks when the session ended', async () => {
    const { service, server } = await registered();
    server.now = later(14.5);
    expect(await service.accessToken()).toBe('access-2');
    expect(server.refreshed).toBe(1);
    // Still fresh: no refresh. Then due again: the rotated refresh token is the one sent.
    expect(await service.accessToken()).toBe('access-2');
    server.now = later(29.5);
    expect(await service.accessToken()).toBe('access-3');
    expect(server.refreshed).toBe(2);
  });

  it('a refresh refused by the server ends the session', async () => {
    const { service, server, api } = await registered();
    vi.mocked(api.refreshSession).mockRejectedValueOnce(new DeviceApiError('SESSION_ENDED'));
    server.now = later(14.5);
    expect(await service.accessToken()).toBeNull();
    expect(service.status()).toMatchObject({ session: null });
  });
});

describe('DeviceService member list (rules 28, 30, 33)', () => {
  it('fetches and confirms the list; the window counts from the server time', async () => {
    const { service, server } = await registered();
    server.now = later(60);
    await service.refresh();
    expect(server.acked).toEqual([server.list.version]);
    // Seven days after registration but not after the confirmed list: still open.
    server.now = new Date(start.getTime() + 7 * 24 * 3600_000 + 30 * 60_000);
    expect(service.status()).toMatchObject({ window: { open: true } });
    server.reachable = false;
    server.now = new Date(start.getTime() + 9 * 24 * 3600_000);
    await service.refresh();
    expect(service.status()).toMatchObject({ online: false, window: { open: false, warn: true } });
  });

  it('ends the session of a member gone from the list on the first connection', async () => {
    const { service, server, owner, cashier } = await registered();
    await service.lock('locked');
    await service.signIn({ membershipId: cashier.membershipId, pin: '482916' });
    const remaining: DeviceMember[] = server.list.members.filter(
      (m) => m.membershipId === owner.membershipId,
    );
    server.list = { ...server.list, version: 'v2', members: remaining } satisfies MemberList;
    await service.refresh();
    expect(service.status()).toMatchObject({ session: null });
  });
});

describe('DeviceService wipe (rule 19)', () => {
  it('a revoked PC deletes its list and key, confirms, then shows only the notice', async () => {
    const { service, server, store, path, api } = await registered();
    server.revoked = true;
    await service.refresh();
    expect(api.wiped).toHaveBeenCalledTimes(1);
    expect(service.status()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
    expect(store.read()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
    expect(readFileSync(path, 'utf8')).not.toContain('argon2');
    await service.dismissWipe();
    expect(service.status()).toEqual({ state: 'unregistered' });
  });

  it('keeps only the key until the confirmation reaches the server', async () => {
    const { service, server, store, api } = await registered();
    server.revoked = true;
    vi.mocked(api.wiped).mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    await service.refresh();
    expect(store.read()?.state).toBe('wiping');
    expect(service.status()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
    await service.refresh();
    expect(store.read()?.state).toBe('wiped');
  });

  it('a revoked PC refused at sign-in wipes too', async () => {
    const { service, server, cashier } = await registered();
    server.revoked = true;
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
      ok: false,
      code: 'DEVICE_REVOKED',
    });
    expect(service.status().state).toBe('wiped');
  });
});

describe('preload', () => {
  it('names exactly the channels of the bridge', () => {
    const preload = readFileSync(new URL('./preload.cts', import.meta.url), 'utf8');
    const named = [...preload.matchAll(/'(device:[a-z-]+)'/g)].map((match) => match[1]);
    expect(new Set(named)).toEqual(new Set(Object.values(deviceChannels)));
  });
});
