import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  createDatabase,
  devices,
  otpChallenges,
  platformAuditEntries,
  staffSessions,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import { newPhone, OPERATOR, ORIGIN, PASSWORD, pinFor, proofOfWork, TestApi } from './staff.js';

// Spec S02 over HTTP: signing in, OTPs, tickets, registered PCs and their member lists, PIN
// sessions, refresh, re-authentication, revocation and the wipe, personal devices, password
// resets, the closure, and the authentication step ahead of the body parser (rule 46).

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  // A movable clock for the minute between two OTPs (`TestApi.signInWithOtp`); time still runs.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
});

describe('the first sign-in, registration and PIN (rules 13, 16, 22)', () => {
  it('takes an owner from OTP to a registered PC and a PIN session', async () => {
    const { device, owner, ownerMembershipId, tenantId } = await api.ownerOnDevice();
    const me = await device.as(owner).get('/api/me').expect(200);
    expect(me.body).toMatchObject({
      roles: ['owner'],
      sessionKind: 'device',
      deviceId: device.deviceId,
      pinSet: true,
      account: { hasPassword: true, nameAr: 'اسم تجريبي' },
    });
    const pinSession = await device.signIn(ownerMembershipId, pinFor(0));
    await device.as(pinSession).get('/api/tenant').expect(200);
    const audited = await withTenant(db, tenantId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(audited.map((row) => row.action)).toEqual(
      expect.arrayContaining(['device.registered', 'staff_session.started', 'staff_pin.set']),
    );
  });

  it('lets a manager add a cashier who chooses a PIN on the PC, then works by PIN', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const cashier = await device.addMember(
      owner,
      {
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
      },
      pinFor(1),
    );
    const session = await device.signIn(cashier.id, pinFor(1));
    const me = await device.as(session).get('/api/me').expect(200);
    expect(me.body.permissions).toEqual(['tenant.view']);
    await device.as(session).get('/api/staff').expect(403);
  });
});

describe('proof of work and password sign-in (rules 11, 12)', () => {
  it('refuses a missing or reused proof of work', async () => {
    const solved = await proofOfWork(app);
    const body = { phone: newPhone(), password: 'x', intent: 'personal', proofOfWork: solved };
    await api.http().post('/api/auth/sign-in').send(body).expect(401);
    const reused = await api.http().post('/api/auth/sign-in').send(body).expect(400);
    expect(reused.body.code).toBe('POW_INVALID');
  });

  it('answers an unknown phone and a wrong password alike, and locks after five', async () => {
    const { ownerPhone } = await api.ownerOnDevice();
    const attempt = async (phone: string, password: string) => {
      const solved = await proofOfWork(app);
      return api
        .http()
        .post('/api/auth/sign-in')
        .send({ phone, password, intent: 'personal', proofOfWork: solved });
    };
    const unknown = await attempt(newPhone(), PASSWORD);
    const wrong = await attempt(ownerPhone, 'not-the-password');
    expect([unknown.status, unknown.body.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    expect([wrong.status, wrong.body.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    for (let i = 0; i < 4; i += 1) await attempt(ownerPhone, 'not-the-password');
    const locked = await attempt(ownerPhone, PASSWORD);
    expect([locked.status, locked.body.code]).toEqual([429, 'RATE_LIMITED']);
    const audited = await db
      .select({ action: platformAuditEntries.action })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, await api.accountId(ownerPhone)));
    expect(audited.map((row) => row.action)).toContain('account.sign_in_locked');
  });

  it('asks for an OTP on a new PC and not on a registered PC of the tenant', async () => {
    const { ownerPhone, device } = await api.ownerOnDevice();
    vi.setSystemTime(Date.now() + 61_000);
    const solved = await proofOfWork(app);
    const elsewhere = await api
      .http()
      .post('/api/auth/sign-in')
      .send({
        phone: ownerPhone,
        password: PASSWORD,
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    expect(elsewhere.body.step).toBe('otp');
    const token = await device.token();
    const solvedAgain = await proofOfWork(app);
    const onDevice = await api
      .http()
      .post('/api/auth/sign-in')
      .set('x-device-token', token)
      .send({
        phone: ownerPhone,
        password: PASSWORD,
        intent: 'register_device',
        proofOfWork: solvedAgain,
      })
      .expect(200);
    expect(onDevice.body.step).toBe('done');
    // That ticket belongs to the PC it was issued on: it registers no other PC (rule 16).
    const registered = await api
      .http()
      .post('/api/devices')
      .set('x-sign-in-ticket', onDevice.body.ticket)
      .send({
        tenantId: device.tenantId,
        branchId: device.registration.device.branchId,
        name: 'جهاز آخر',
        publicKey: `${'B'.repeat(42)}A=`,
        os: 'Windows',
        appVersion: '0.1.0',
      });
    expect(registered.body.code).toBe('TICKET_INVALID');
  });
});

describe('OTPs (rules 12, 13)', () => {
  it('sends a first-sign-in code only to members who sign in online, with the same answer', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const scope = { allBranches: false, branchIds: [branchIds[0] as string] };
    const cashier = await device.addMember(owner, {
      displayName: 'كاشير',
      roles: ['cashier'],
      branchScope: scope,
    });
    const manager = await device.addMember(owner, {
      displayName: 'مدير',
      roles: ['manager'],
      branchScope: scope,
    });
    const cases: [string, boolean][] = [
      [cashier.phone, false],
      [manager.phone, true],
      [newPhone(), false],
    ];
    for (const [phone, sent] of cases) {
      const solved = await proofOfWork(app);
      const response = await api
        .http()
        .post('/api/auth/otp/request')
        .send({ phone, purpose: 'first_sign_in', intent: 'personal', proofOfWork: solved })
        .expect(200);
      expect(Object.keys(response.body)).toEqual(['challengeId']);
      const accountId = await api.accountId(phone).catch(() => undefined);
      expect(accountId ? api.otps.lastCode(accountId) !== undefined : false).toBe(sent);
    }
  });

  it('stores only a keyed hash, counts attempts and refuses an exhausted challenge', async () => {
    const { ownerPhone } = await api.newTenant();
    const solved = await proofOfWork(app);
    const requested = await api
      .http()
      .post('/api/auth/otp/request')
      .send({
        phone: ownerPhone,
        purpose: 'first_sign_in',
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    const code = api.otps.lastCode(await api.accountId(ownerPhone)) as string;
    const [row] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, requested.body.challengeId));
    expect(row?.codeHash).not.toContain(code);
    const wrong = code === '000000' ? '111111' : '000000';
    const verify = (value: string) =>
      api
        .http()
        .post('/api/auth/otp/verify')
        .send({ challengeId: requested.body.challengeId, code: value, intent: 'register_device' });
    for (let i = 0; i < 5; i += 1) expect((await verify(wrong)).body.code).toBe('OTP_INVALID');
    expect((await verify(code)).body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    // A resend within the minute is refused.
    const resent = await api
      .http()
      .post('/api/auth/otp/resend')
      .send({ challengeId: requested.body.challengeId });
    expect(resent.body.code).toBe('OTP_COOLDOWN');
  });

  it('uses a ticket once, and refuses a weak password', async () => {
    const { ownerPhone } = await api.newTenant();
    const solved = await proofOfWork(app);
    const requested = await api
      .http()
      .post('/api/auth/otp/request')
      .send({
        phone: ownerPhone,
        purpose: 'first_sign_in',
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    const code = api.otps.lastCode(await api.accountId(ownerPhone));
    const verified = await api
      .http()
      .post('/api/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code, intent: 'register_device' })
      .expect(200);
    expect(verified.body).toMatchObject({ needsPassword: true, needsName: true });
    const setPassword = (password: string) =>
      api
        .http()
        .post('/api/auth/password')
        .set('x-sign-in-ticket', verified.body.ticket)
        .send({ name: 'مالك', password });
    expect((await setPassword('1234567890')).body.code).toBe('PASSWORD_TOO_WEAK');
    await setPassword(PASSWORD).expect(200);
    expect((await setPassword(PASSWORD)).body.code).toBe('TICKET_INVALID');
  });
});

describe('registered PCs and their member lists (rules 18, 28)', () => {
  it('offers the tenants and branches where the member manages devices', async () => {
    const { ownerPhone, tenantId, branchIds } = await api.newTenant(['main', 'east']);
    const { ticket } = await api.firstSignIn(ownerPhone);
    const options = await api
      .http()
      .get('/api/auth/tenant-options')
      .set('x-sign-in-ticket', ticket)
      .expect(200);
    expect(options.body.tenants).toEqual([
      expect.objectContaining({
        tenantId,
        branches: branchIds.map((id) => expect.objectContaining({ id })),
      }),
    ]);
  });

  it('holds the branch members with their verifiers, not those of another branch', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice(['main', 'east']);
    const here = await device.addMember(
      owner,
      {
        displayName: 'هنا',
        roles: ['waiter'],
        branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
      },
      pinFor(2),
    );
    const there = await device.addMember(owner, {
      displayName: 'هناك',
      roles: ['waiter'],
      branchScope: { allBranches: false, branchIds: [branchIds[1] as string] },
    });
    const pc = await device.device();
    const list = await pc.get('/api/devices/current/members').expect(200);
    expect(list.body.status).toBe('current');
    const ids = list.body.list.members.map((m: { membershipId: string }) => m.membershipId);
    expect(ids).toContain(here.id);
    expect(ids).not.toContain(there.id);
    const member = list.body.list.members.find(
      (m: { membershipId: string }) => m.membershipId === here.id,
    );
    expect(member.pinVerifier).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(list.body.list.branch.idleLockMinutes).toBe(5);
    const again = await pc
      .get(`/api/devices/current/members?knownVersion=${list.body.list.version}`)
      .expect(200);
    expect(again.body.status).toBe('not_modified');
    await pc
      .post('/api/devices/current/members/ack')
      .send({ version: list.body.list.version })
      .expect(204);
    const [row] = await withTenant(db, device.tenantId, (tx) =>
      tx.select().from(devices).where(eq(devices.id, device.deviceId)),
    );
    expect(row?.membersSyncedAt).not.toBeNull();
  });

  it('refuses a bad signature and a replayed nonce', async () => {
    const { device } = await api.ownerOnDevice();
    const challenge = await api
      .http()
      .post('/api/devices/token/challenge')
      .send({ tenantId: device.tenantId, deviceId: device.deviceId })
      .expect(200);
    const body = {
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      nonce: challenge.body.nonce,
      signature: `${'A'.repeat(86)}==`,
      appVersion: '0.1.0',
    };
    expect((await api.http().post('/api/devices/token').send(body)).body.code).toBe(
      'SIGNATURE_INVALID',
    );
    expect((await api.http().post('/api/devices/token').send(body)).body.code).toBe(
      'SIGNATURE_INVALID',
    );
  });
});

describe('PIN sessions (rules 22, 24, 26)', () => {
  // Ten Argon2id checks at 64 MiB: slower than the default limit while other files run.
  it('disables a PIN after ten wrong online attempts, until a manager resets it', {
    timeout: 30_000,
  }, async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const waiter = await device.addMember(
      owner,
      {
        displayName: 'نادل',
        roles: ['waiter'],
        branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
      },
      pinFor(3),
    );
    const pc = await device.device();
    const tryPin = (pin: string) => pc.post('/api/sessions').send({ membershipId: waiter.id, pin });
    for (let i = 0; i < 9; i += 1) expect((await tryPin(pinFor(4))).body.code).toBe('INVALID_PIN');
    expect((await tryPin(pinFor(4))).body.code).toBe('PIN_DISABLED');
    expect((await tryPin(pinFor(3))).body.code).toBe('PIN_DISABLED');
    await device
      .as(owner)
      .put(`/api/staff/${waiter.id}/pin`)
      .send({ pin: pinFor(5) })
      .expect(204);
    await device.signIn(waiter.id, pinFor(5));
  });

  it('refuses a trivial PIN or the phone tail', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const waiter = await device.addMember(owner, {
      displayName: 'نادل',
      roles: ['waiter'],
      branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
    });
    for (const pin of ['123456', '000000', waiter.phone.slice(-6)]) {
      const response = await device.as(owner).put(`/api/staff/${waiter.id}/pin`).send({ pin });
      expect(response.body.code).toBe('PIN_TOO_WEAK');
    }
  });

  it('asks a PIN session for the password before sensitive actions', async () => {
    const { device, ownerMembershipId } = await api.ownerOnDevice();
    const session = await device.signIn(ownerMembershipId, pinFor(0));
    const add = () =>
      device
        .as(session)
        .post('/api/staff')
        .send({
          phone: newPhone(),
          displayName: 'جديد',
          roles: ['kitchen'],
          branchScope: { allBranches: true },
          grantedPermissions: [],
          revokedPermissions: [],
        });
    expect((await add()).body.code).toBe('REAUTH_REQUIRED');
    const wrong = await device
      .as(session)
      .post('/api/sessions/current/reauth')
      .send({ password: 'x' });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    await device
      .as(session)
      .post('/api/sessions/current/reauth')
      .send({ password: PASSWORD })
      .expect(204);
    await add().expect(201);
  });

  it('rotates refresh tokens and ends the session when an old one is reused', async () => {
    const { device, ownerMembershipId, tenantId } = await api.ownerOnDevice();
    const session = await device.signIn(ownerMembershipId, pinFor(0));
    const pc = await device.device();
    const refreshed = await pc
      .post('/api/sessions/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);
    const reused = await pc
      .post('/api/sessions/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(reused.body.code).toBe('SESSION_ENDED');
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(staffSessions).where(eq(staffSessions.id, session.sessionId)),
    );
    expect(row?.endReason).toBe('refresh_reused');
    const after = await pc
      .post('/api/sessions/refresh')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(after.body.code).toBe('SESSION_ENDED');
  });

  it('locks: ending the session refuses its access token', async () => {
    const { device, ownerMembershipId } = await api.ownerOnDevice();
    const session = await device.signIn(ownerMembershipId, pinFor(0));
    await device
      .as(session)
      .post('/api/sessions/current/end')
      .send({ reason: 'locked' })
      .expect(204);
    const after = await device.as(session).get('/api/me');
    expect([after.status, after.body.code]).toEqual([401, 'SESSION_ENDED']);
  });
});

describe('revocation and the wipe (rule 19)', () => {
  it('stops the PC at once, then lets it confirm its wipe once', async () => {
    const { device, owner, tenantId } = await api.ownerOnDevice();
    const token = await device.token();
    await device
      .as(owner)
      .post(`/api/devices/${device.deviceId}/revoke`)
      .send({ reason: 'lost_or_stolen', note: 'سُرق' })
      .expect(200);
    expect((await device.as(owner).get('/api/me')).body.code).toBe('SESSION_ENDED');
    const members = await api
      .http()
      .get('/api/devices/current/members')
      .set('x-device-token', token);
    expect(members.body.code).toBe('DEVICE_REVOKED');
    const pc = await device.device();
    await pc.post('/api/devices/current/wiped').send({}).expect(204);
    await expect(device.token()).rejects.toThrow('DEVICE_REVOKED');
    const audited = await withTenant(db, tenantId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(audited.map((row) => row.action)).toEqual(
      expect.arrayContaining(['device.revoked', 'device.wiped']),
    );
  });

  it('refuses archiving a branch with an active PC (rule 21)', async () => {
    const { device, branchIds } = await api.ownerOnDevice(['main', 'east']);
    const tenancy = app.get(TenancyService);
    await expect(
      tenancy.archiveBranch(OPERATOR, device.tenantId, branchIds[0] as string, undefined),
    ).rejects.toMatchObject({ code: 'BRANCH_HAS_DEVICES' });
  });
});

describe('personal devices (rules 12, 34, 35)', () => {
  it('asks for the OTP once per browser, then the password only', async () => {
    const { ownerPhone, tenantId } = await api.ownerOnDevice();
    const first = await api.signInWithOtp(ownerPhone, 'personal');
    const deviceCookie = (first.cookies as string[]).find((c) =>
      c.startsWith('__Secure-vf-device='),
    );
    expect(deviceCookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const solved = await proofOfWork(app);
    const second = await api
      .http()
      .post('/api/auth/sign-in')
      .set('cookie', (deviceCookie as string).split(';')[0] as string)
      .send({ phone: ownerPhone, password: PASSWORD, intent: 'personal', proofOfWork: solved })
      .expect(200);
    expect(second.body.step).toBe('done');
    const opened = await api
      .http()
      .post('/api/auth/personal-session')
      .set('x-sign-in-ticket', second.body.ticket)
      .send({ tenantId })
      .expect(200);
    expect(opened.body.sessionKind).toBe('personal');
    const session = sessionCookie(opened.headers['set-cookie']);
    await api.http().get('/api/me').set('cookie', session).expect(200);
    // Back office only: the PIN is a registered PC's.
    const pin = await api
      .http()
      .put('/api/me/pin')
      .set('cookie', session)
      .set('origin', ORIGIN)
      .send({ newPin: pinFor(9) });
    expect(pin.body.code).toBe('DEVICE_REQUIRED');
    // A write from another origin is refused.
    const foreign = await api
      .http()
      .put('/api/me/password')
      .set('cookie', session)
      .set('origin', 'https://evil.example')
      .send({ currentPassword: PASSWORD, newPassword: 'another-long-pass-7' });
    expect(foreign.body.code).toBe('FORBIDDEN');
  });

  it('refuses members without backoffice.remote, whatever the cause', async () => {
    const { device, owner, tenantId, branchIds } = await api.ownerOnDevice();
    const driver = await device.addMember(owner, {
      displayName: 'سائق',
      roles: ['driver'],
      branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
    });
    const { ticket } = await api.firstSignIn(driver.phone, 'personal');
    const options = await api
      .http()
      .get('/api/auth/tenant-options')
      .set('x-sign-in-ticket', ticket)
      .expect(200);
    expect(options.body.tenants).toEqual([]);
    const refused = await api
      .http()
      .post('/api/auth/personal-session')
      .set('x-sign-in-ticket', ticket)
      .send({ tenantId });
    expect(refused.body.code).toBe('FORBIDDEN');
  });

  it('ends a personal session after 60 idle minutes', async () => {
    const { ownerPhone, tenantId } = await api.ownerOnDevice();
    const { ticket } = await api.signInWithOtp(ownerPhone, 'personal');
    const opened = await api
      .http()
      .post('/api/auth/personal-session')
      .set('x-sign-in-ticket', ticket)
      .send({ tenantId })
      .expect(200);
    const session = sessionCookie(opened.headers['set-cookie']);
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(staffSessions)
        .set({ lastRefreshedAt: new Date(Date.now() - 61 * 60_000) })
        .where(eq(staffSessions.kind, 'personal')),
    );
    expect((await api.http().get('/api/me').set('cookie', session)).body.code).toBe(
      'SESSION_ENDED',
    );
  });
});

describe('password resets (rule 14)', () => {
  it('lets a reset member set a new password by OTP, ending their sessions', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const manager = await device.addMember(
      owner,
      {
        displayName: 'مدير',
        roles: ['manager'],
        branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
      },
      pinFor(6),
    );
    await api.firstSignIn(manager.phone);
    const managerSession = await device.signIn(manager.id, pinFor(6));
    await device.as(owner).post(`/api/staff/${manager.id}/password-reset`).send({}).expect(204);
    vi.setSystemTime(Date.now() + 61_000);
    const solved = await proofOfWork(app);
    const requested = await api
      .http()
      .post('/api/auth/otp/request')
      .send({
        phone: manager.phone,
        purpose: 'password_reset',
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    const code = api.otps.lastCode(await api.accountId(manager.phone));
    const verified = await api
      .http()
      .post('/api/auth/otp/verify')
      .send({ challengeId: requested.body.challengeId, code, intent: 'register_device' })
      .expect(200);
    expect(verified.body.needsPassword).toBe(true);
    await api
      .http()
      .post('/api/auth/password')
      .set('x-sign-in-ticket', verified.body.ticket)
      .send({ password: 'a-brand-new-password-9' })
      .expect(200);
    expect((await device.as(managerSession).get('/api/me')).body.code).toBe('SESSION_ENDED');
    // The PIN stays (rule 14).
    await device.signIn(manager.id, pinFor(6));
  });
});

describe('the closure (rule 37)', () => {
  it('ends every session and revokes every PC', async () => {
    const { device, owner, tenantId } = await api.ownerOnDevice();
    await app
      .get(TenancyService)
      .changeStatus(OPERATOR, tenantId, { to: 'closed', reason: 'other' });
    expect((await device.as(owner).get('/api/me')).status).toBe(401);
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(devices).where(eq(devices.id, device.deviceId)),
    );
    expect(row).toMatchObject({ status: 'revoked', revokeReason: 'tenant_closed' });
  });
});

describe('the authentication step (rule 46, BE-01)', () => {
  it('refuses a non-public route before parsing its body', async () => {
    const response = await api
      .http()
      .post('/api/staff')
      .set('content-type', 'application/json')
      .send('{"this is": not json');
    expect([response.status, response.body.code]).toEqual([401, 'UNAUTHENTICATED']);
  });

  it('still parses the body of a public route', async () => {
    const response = await api
      .http()
      .post('/api/auth/sign-in')
      .set('content-type', 'application/json')
      .send('{"this is": not json');
    expect([response.status, response.body.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('publishes the token key as a JWKS', async () => {
    const response = await api.http().get('/api/.well-known/jwks.json').expect(200);
    expect(response.body.keys).toEqual([
      expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' }),
    ]);
  });
});

function sessionCookie(header: unknown): string {
  const cookies = (Array.isArray(header) ? header : [header]) as string[];
  const cookie = cookies.find((value) => value.startsWith('__Secure-vf-session='));
  if (!cookie) throw new Error('No session cookie');
  return cookie.split(';')[0] as string;
}
