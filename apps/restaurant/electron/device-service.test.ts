import { readFileSync } from 'node:fs';
import type { DeviceMember, MemberList, SessionTokens } from '@vertex-food/contracts';
import { describe, expect, it, vi } from 'vitest';
import { deviceChannels } from './bridge.js';
import { type DeviceApi, DeviceApiError } from './device-client.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import {
  fakeSealer,
  member,
  memberList,
  memoryData,
  tempStore,
  uuid7,
  verifyPin,
} from './device-test-kit.js';
import { generateDatabaseKey } from './local-db.js';

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
    // The PC's clock against the server's (a power cut can set it back).
    pcClockOffsetMs: 0,
    tokenIssuedAt: 0,
    ownerPassword: 'synthetic-owner-pass',
  };
  let sessions = 0;
  // JWT-shaped: the PC reads the membership from the payload.
  const tokens = (membershipId: string): SessionTokens => {
    sessions += 1;
    const payload = Buffer.from(JSON.stringify({ mid: membershipId })).toString('base64url');
    return {
      sessionId: uuid7(),
      accessToken: `access-${sessions}.${payload}.signature`,
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
    // The server's own clock decides when a device token expires.
    if (server.now.getTime() - server.tokenIssuedAt > 300_000) {
      throw new DeviceApiError('UNAUTHENTICATED');
    }
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
        session: tokens(owner.membershipId),
      };
    }),
    challenge: vi.fn(async () => {
      reach();
      return { nonce: uuid7(), expiresAt: server.now.toISOString() };
    }),
    token: vi.fn(async () => {
      reach();
      if (server.wipedConfirmed) throw new DeviceApiError('DEVICE_REVOKED');
      server.tokenIssuedAt = server.now.getTime();
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
    signIn: vi.fn(async (token, body) => {
      reach();
      if (body.password !== server.ownerPassword) throw new DeviceApiError('INVALID_CREDENTIALS');
      // The device token makes the PC known: no OTP for a member of this PC (rule 12).
      return token
        ? { step: 'done' as const, ticket: `ticket-${owner.membershipId}` }
        : { step: 'otp' as const, challengeId: uuid7() };
    }),
    openSession: vi.fn(async (_token, body) => {
      device();
      if ('ticket' in body) {
        if (body.ticket !== `ticket-${body.membershipId}`) throw new DeviceApiError('FORBIDDEN');
        return tokens(body.membershipId);
      }
      if (pins.get(body.membershipId) !== body.pin) throw new DeviceApiError('INVALID_PIN');
      return tokens(body.membershipId);
    }),
    refreshSession: vi.fn(async (_token, refreshToken) => {
      device();
      if (refreshToken !== `refresh-${sessions}`) throw new DeviceApiError('SESSION_ENDED');
      server.refreshed += 1;
      return tokens('');
    }),
    endSession: vi.fn(async (accessToken) => {
      reach();
      server.ended.push(accessToken);
    }),
  };
  return { api, server, owner, cashier };
}

async function setup() {
  const fake = await fakeApi();
  const { store, path } = tempStore();
  const changed = vi.fn();
  // One database across restarts, as on the disk.
  const data = memoryData();
  const quarantine = vi.fn(async () => undefined);
  const make = () =>
    DeviceService.open({
      store,
      client: fake.api,
      verifyPin,
      generateKey: generateDeviceKey,
      sign: signWithDeviceKey,
      now: () => new Date(fake.server.now.getTime() + fake.server.pcClockOffsetMs),
      elapsed: () => fake.server.now.getTime(),
      os: 'win32 10.0',
      appVersion: '0.0.0',
      onChange: changed,
      openData: async () => data,
      generateDatabaseKey,
      quarantine,
    });
  const service = await make();
  const input = {
    ticket: 'ticket',
    tenantId: fake.server.list.tenant.id,
    branchId: fake.server.list.branch.id,
    name: 'الكاشير 1',
  };
  return { ...fake, store, path, service, make, changed, input, data, quarantine };
}

async function registered() {
  const context = await setup();
  expect(await context.service.register(context.input)).toEqual({ ok: true });
  return context;
}

const later = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

describe('DeviceService registration (rule 16)', () => {
  it('keeps the members in the local database and only the list header sealed (spec S04)', async () => {
    const { store, data, server } = await registered();
    const record = store.read();
    expect(record?.state === 'registered' && record.memberList.members).toBeUndefined();
    expect(record?.state === 'registered' && record.registration.databaseKey).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect((await data.loadMembers())?.members).toEqual(server.list.members);
  });

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
    expect((await make()).status()).toMatchObject({ state: 'registered', session: null });
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
        status.members.find((m) => m.membershipId === cashier.membershipId)?.pinDisabledHere,
    ).toBe(true);
  });

  it('locking ends the online session on the server', async () => {
    const { service, server } = await registered();
    await service.lock('idle');
    expect(service.status()).toMatchObject({ session: null });
    expect(server.ended).toEqual([expect.stringMatching(/^access-1./)]);
  });

  it('refreshes the access token before it expires and locks when the session ended', async () => {
    const { service, server } = await registered();
    server.now = later(14.5);
    expect(await service.accessToken()).toMatch(/^access-2./);
    expect(server.refreshed).toBe(1);
    // Still fresh: no refresh. Then due again: the rotated refresh token is the one sent.
    expect(await service.accessToken()).toMatch(/^access-2./);
    server.now = later(29.5);
    expect(await service.accessToken()).toMatch(/^access-3./);
    expect(server.refreshed).toBe(2);
  });

  it('"Switch cashier" locks at once while a member-list refresh waits on the connection', async () => {
    const { service, server, api } = await registered();
    let release: () => void = () => undefined;
    vi.mocked(api.members).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'not_modified', issuedAt: server.now.toISOString() });
        }),
    );
    const refreshing = service.refresh();
    await vi.waitFor(() => expect(api.members).toHaveBeenCalled());
    const locking = service.lock('locked');
    expect(service.status()).toMatchObject({ session: null });
    release();
    await Promise.all([refreshing, locking]);
    expect(service.status()).toMatchObject({ session: null });
    expect(server.ended).toEqual([expect.stringMatching(/^access-1./)]);
  });

  it('a token refresh that ends after the lock ends the rotated session and opens nothing', async () => {
    const { service, server, api } = await registered();
    server.now = later(14.5);
    let release: () => void = () => undefined;
    const refresh = vi.mocked(api.refreshSession).getMockImplementation();
    vi.mocked(api.refreshSession).mockImplementationOnce(
      (token, refreshToken) =>
        new Promise((resolve, reject) => {
          release = () => refresh?.(token, refreshToken).then(resolve, reject);
        }),
    );
    const token = service.accessToken();
    await vi.waitFor(() => expect(api.refreshSession).toHaveBeenCalled());
    const locking = service.lock('locked');
    release();
    expect(await token).toBeNull();
    await locking;
    expect(service.status()).toMatchObject({ session: null });
    expect(server.ended).toContainEqual(expect.stringMatching(/^access-2./));
  });

  it('a refresh refused by the server ends the session', async () => {
    const { service, server, api } = await registered();
    vi.mocked(api.refreshSession).mockRejectedValueOnce(new DeviceApiError('SESSION_ENDED'));
    server.now = later(14.5);
    expect(await service.accessToken()).toBeNull();
    expect(service.status()).toMatchObject({ session: null });
  });
});

describe('DeviceService forgotten PIN by password (rule 22)', () => {
  const proofOfWork = { challenge: 'pow', nonce: '1' };

  it('opens the owner session by password and asks for a new PIN until the list has it', async () => {
    const { service, owner, api, server } = await registered();
    await service.lock('locked');
    const input = {
      membershipId: owner.membershipId,
      phone: '+963900000010',
      password: server.ownerPassword,
      proofOfWork,
    };
    expect(await service.signInByPassword(input)).toEqual({ ok: true });
    expect(api.signIn).toHaveBeenCalledWith(
      'device-token',
      expect.objectContaining({ intent: 'register_device' }),
    );
    expect(service.status()).toMatchObject({ session: { online: true, choosePin: true } });
    // The same verifier: the PIN is not replaced yet.
    await service.refresh();
    expect(service.status()).toMatchObject({ session: { choosePin: true } });
    server.list = {
      ...server.list,
      version: 'v2',
      members: server.list.members.map((item) =>
        item.membershipId === owner.membershipId ? { ...item, pinVerifier: 'new-verifier' } : item,
      ),
    };
    await service.refresh();
    expect(service.status()).toMatchObject({ session: { choosePin: false } });
  });

  it('clears the forgotten PIN lockout on this PC once the new PIN arrives', async () => {
    const { service, owner, server } = await registered();
    await service.lock('locked');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.signIn({ membershipId: owner.membershipId, pin: '000001' });
    }
    const ownerView = () => {
      const status = service.status();
      return status.state === 'registered'
        ? status.members.find((item) => item.membershipId === owner.membershipId)
        : undefined;
    };
    expect(ownerView()).toMatchObject({ pinDisabledHere: true });
    expect(
      await service.signInByPassword({
        membershipId: owner.membershipId,
        phone: '+963900000010',
        password: server.ownerPassword,
        proofOfWork,
      }),
    ).toEqual({ ok: true });
    // Still disabled until the new PIN is set: the old one stays refused here.
    expect(ownerView()).toMatchObject({ pinDisabledHere: true });
    server.list = {
      ...server.list,
      version: 'v2',
      members: server.list.members.map((item) =>
        item.membershipId === owner.membershipId ? { ...item, pinVerifier: 'new-verifier' } : item,
      ),
    };
    await service.refresh();
    expect(ownerView()).toMatchObject({ pinDisabledHere: false });
  });

  it('a PIN reset by a manager lifts its lockout on this PC once the list has it', async () => {
    const { service, cashier, server } = await registered();
    await service.lock('locked');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.signIn({ membershipId: cashier.membershipId, pin: '000001' });
    }
    const cashierView = () => {
      const status = service.status();
      return status.state === 'registered'
        ? status.members.find((item) => item.membershipId === cashier.membershipId)
        : undefined;
    };
    expect(cashierView()).toMatchObject({ pinDisabledHere: true });
    // An unchanged list leaves the lockout.
    await service.refresh();
    expect(cashierView()).toMatchObject({ pinDisabledHere: true });
    server.list = {
      ...server.list,
      version: 'v2',
      members: server.list.members.map((item) =>
        item.membershipId === cashier.membershipId ? { ...item, pinVerifier: 'reset' } : item,
      ),
    };
    await service.refresh();
    expect(cashierView()).toMatchObject({ pinDisabledHere: false });
  });

  it('keeps asking for the new PIN across an access-token refresh', async () => {
    const { service, owner, server } = await registered();
    await service.lock('locked');
    await service.signInByPassword({
      membershipId: owner.membershipId,
      phone: '+963900000010',
      password: server.ownerPassword,
      proofOfWork,
    });
    server.now = later(14.5);
    expect(await service.accessToken()).toMatch(/^access-/);
    expect(service.status()).toMatchObject({ session: { choosePin: true } });
  });

  it('refuses a wrong password and opens nothing', async () => {
    const { service, owner, api } = await registered();
    await service.lock('locked');
    const result = await service.signInByPassword({
      membershipId: owner.membershipId,
      phone: '+963900000010',
      password: 'wrong-password-1',
      proofOfWork,
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(api.openSession).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ticket: expect.any(String) }),
    );
    expect(service.status()).toMatchObject({ session: null });
  });

  it('needs a connection: offline it says so and never checks a password on the PC', async () => {
    const { service, owner, server } = await registered();
    await service.lock('locked');
    server.reachable = false;
    const result = await service.signInByPassword({
      membershipId: owner.membershipId,
      phone: '+963900000010',
      password: server.ownerPassword,
      proofOfWork,
    });
    expect(result).toEqual({ ok: false, code: 'NETWORK_ERROR' });
    expect(service.status()).toMatchObject({ session: null, online: false });
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

describe('DeviceService with a PC clock that is off (rule 31, edge case 8)', () => {
  it('keeps signing in online with the clock hours behind: lifetimes run on the PC itself', async () => {
    const { service, server, cashier } = await registered();
    server.pcClockOffsetMs = -10 * 3600_000;
    await service.lock('locked');
    for (const minutes of [6, 12, 30]) {
      server.now = later(minutes);
      expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
        ok: true,
      });
      expect(service.status()).toMatchObject({ session: { online: true } });
      server.now = later(minutes + 15);
      expect(await service.accessToken()).toMatch(/^access-\d+\./);
      await service.lock('locked');
    }
  });

  it('fetches a device token again when the server no longer accepts it', async () => {
    const { service, server, api } = await registered();
    await service.refresh();
    // The API restarted, or its clock moved on: the token held here is refused once.
    server.tokenIssuedAt = -1_000_000;
    const before = vi.mocked(api.token).mock.calls.length;
    await service.refresh();
    expect(vi.mocked(api.token).mock.calls.length).toBe(before + 1);
    expect(service.status()).toMatchObject({ online: true });
  });

  it('keeps the time a status saw, so a clock set back never reopens the window', async () => {
    const { service, server, make } = await registered();
    await service.lock('locked');
    server.reachable = false;
    // Offline, 8 days on: only a status is read (no PIN typed, no sync); the window has closed.
    server.pcClockOffsetMs = 8 * 24 * 3600_000;
    expect(service.status()).toMatchObject({ window: { open: false } });
    // The clock is set back to day 1: still closed, with the clock warning, after a restart too.
    server.pcClockOffsetMs = 24 * 3600_000;
    expect(service.status()).toMatchObject({ window: { open: false, clockBehind: true } });
    expect((await make()).status()).toMatchObject({ window: { open: false, clockBehind: true } });
  });

  it('still answers a status when keeping the time fails, and keeps it at the next look', async () => {
    const { service, server, store, make } = await registered();
    server.pcClockOffsetMs = 8 * 24 * 3600_000;
    vi.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new Error('EBUSY');
    });
    expect(service.status()).toMatchObject({ window: { open: false } });
    server.pcClockOffsetMs = 8 * 24 * 3600_000 + 60_000;
    service.status();
    server.pcClockOffsetMs = 0;
    expect((await make()).status()).toMatchObject({ window: { open: false, clockBehind: true } });
  });

  it('an offline member-list refresh keeps the time it saw too', async () => {
    const { service, server, make } = await registered();
    server.reachable = false;
    server.pcClockOffsetMs = 8 * 24 * 3600_000;
    await service.refresh();
    server.pcClockOffsetMs = 0;
    expect((await make()).status()).toMatchObject({ window: { open: false, clockBehind: true } });
  });

  it('a clock that ran ahead and was corrected leaves the window open once synced', async () => {
    const { service, server, cashier } = await registered();
    await service.lock('locked');
    // Offline with the clock 8 days ahead: the window reads closed, the PC remembers that time.
    server.reachable = false;
    server.pcClockOffsetMs = 8 * 24 * 3600_000;
    await service.signIn({ membershipId: cashier.membershipId, pin: '482916' });
    expect(service.status()).toMatchObject({ window: { open: false } });
    // The clock is corrected and the PC connects: the server's time is the authority again.
    server.pcClockOffsetMs = 0;
    server.reachable = true;
    server.now = later(5);
    await service.refresh();
    expect(service.status()).toMatchObject({
      window: { open: true, warn: false, clockBehind: false },
    });
  });
});

describe('DeviceService safeguards', () => {
  it('never registers when the record could not be sealed', async () => {
    const fake = await fakeApi();
    const { store } = tempStore({ ...fakeSealer, isEncryptionAvailable: () => false });
    const service = await DeviceService.open({
      store,
      client: fake.api,
      verifyPin,
      generateKey: generateDeviceKey,
      sign: signWithDeviceKey,
      now: () => fake.server.now,
      elapsed: () => fake.server.now.getTime(),
      os: 'win32 10.0',
      appVersion: '0.0.0',
      onChange: () => undefined,
      openData: async () => memoryData(),
      generateDatabaseKey,
      quarantine: async () => undefined,
    });
    const result = await service.register({
      ticket: 'ticket',
      tenantId: fake.server.list.tenant.id,
      branchId: fake.server.list.branch.id,
      name: 'الكاشير 1',
    });
    expect(result).toEqual({ ok: false, code: 'INTERNAL_ERROR' });
    expect(fake.api.register).not.toHaveBeenCalled();
  });

  it('approves only for the member whose session is open here (rule 27)', async () => {
    const { service, owner, cashier } = await registered();
    const input = {
      permission: 'staff.manage' as const,
      approverMembershipId: owner.membershipId,
      pin: '602847',
    };
    expect(await service.approve({ ...input, actingMembershipId: cashier.membershipId })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    await service.lock('locked');
    await service.signIn({ membershipId: cashier.membershipId, pin: '482916' });
    expect(await service.approve({ ...input, actingMembershipId: cashier.membershipId })).toEqual({
      ok: true,
    });
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

  it('uploads to the quarantine, then deletes the database, then confirms (spec S04 rule 40)', async () => {
    const { service, server, store, api, data, quarantine } = await registered();
    server.revoked = true;
    await service.refresh();
    const [uploaded] = quarantine.mock.invocationCallOrder;
    const [destroyed] = data.destroy.mock.invocationCallOrder;
    const [confirmed] = vi.mocked(api.wiped).mock.invocationCallOrder;
    expect(uploaded).toBeLessThan(destroyed ?? 0);
    expect(destroyed).toBeLessThan(confirmed ?? 0);
    expect(store.read()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
  });

  it('keeps the database until the quarantine upload succeeds, across a restart', async () => {
    const { service, server, store, api, data, quarantine, make } = await registered();
    server.revoked = true;
    quarantine.mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    await service.refresh();
    expect(store.read()).toMatchObject({ state: 'wiping', quarantined: false });
    expect(data.destroy).not.toHaveBeenCalled();
    expect(api.wiped).not.toHaveBeenCalled();
    // The member list and the session are gone at once.
    expect(service.status()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
    quarantine.mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    const restarted = await make();
    await restarted.refresh();
    expect(data.destroy).not.toHaveBeenCalled();
    await restarted.refresh();
    expect(quarantine).toHaveBeenCalledTimes(3);
    expect(data.destroy).toHaveBeenCalledTimes(1);
    expect(store.read()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
  });

  it('opens the database again when its delete was cut short, and finishes the wipe', async () => {
    const { service, server, store, data, quarantine } = await registered();
    server.revoked = true;
    data.destroy.mockRejectedValueOnce(new Error('EBUSY'));
    await service.refresh();
    expect(store.read()).toMatchObject({ state: 'wiping', quarantined: false });
    await service.refresh();
    expect(quarantine).toHaveBeenCalledTimes(2);
    expect(data.destroy).toHaveBeenCalledTimes(2);
    expect(store.read()).toEqual({ state: 'wiped', tenantName: 'مطعم تجريبي' });
  });

  it('a sync route refused with DEVICE_REVOKED starts the wipe', async () => {
    const { service, server, quarantine } = await registered();
    server.revoked = true;
    const call = vi.fn(async () => {
      throw new DeviceApiError('DEVICE_REVOKED');
    });
    await expect(service.deviceCall(call)).rejects.toThrow('DEVICE_REVOKED');
    await service.refresh();
    expect(quarantine).toHaveBeenCalled();
    expect(service.status().state).toBe('wiped');
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
