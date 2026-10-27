import type { INestApplication } from '@nestjs/common';
import type { ConsoleRole } from '@vertex-food/contracts';
import {
  accounts,
  auditEntries,
  createDatabase,
  type Database,
  platformAuditEntries,
  platformUsers,
  withTenant,
} from '@vertex-food/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { listRoutes } from '../src/core/routes.js';
import { PlatformUsersService } from '../src/modules/platform/identity/index.js';
import { totpCode, totpStep } from '../src/modules/platform/identity/totp.js';
import { createTestApp } from './app.js';
import { client, newPhone, OPERATOR, PASSWORD, proofOfWork, TestApi } from './staff.js';

// Spec S02 rules 38–43 and the console part of "Acceptance": setup codes, TOTP enrollment and
// replay, recovery codes, re-authentication, idle and absolute expiry, `LAST_ADMIN`, the console
// limits, the platform audit of every request, and owner recovery.

const CONSOLE_ORIGIN = 'http://localhost:5274';
const MINUTE = 60_000;

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
});

/** The first sign-in step, its proof of work solved first: supertest requests never nest. */
async function postSignIn(target: INestApplication, body: Record<string, string>, status?: number) {
  const solved = await proofOfWork(target);
  const sent = client(target)
    .post('/api/console/auth/sign-in')
    .send({ ...body, proofOfWork: solved });
  return status === undefined ? sent : sent.expect(status);
}

/** Moves the clock to the next TOTP step, so a new code is never a used step. */
function nextStep() {
  vi.setSystemTime(Date.now() + 30_000);
}

const codeOf = (secret: string) => totpCode(secret, totpStep(new Date()));

type SignedIn = {
  userId: string;
  phone: string;
  secret: string;
  cookie: string;
  recovery: string[];
  /** The TOTP step the setup used. */
  setupStep: number;
};

/** A platform user made by the CLI's service, set up through the routes (rule 38). */
async function setUpUser(target: INestApplication, role: ConsoleRole): Promise<SignedIn> {
  const phone = newPhone();
  const created = await target.get(PlatformUsersService).create(OPERATOR, {
    phone,
    name: 'موظف فيرتكس',
    role,
    grantedPermissions: [],
    revokedPermissions: [],
  });
  const signIn = await postSignIn(target, { phone, setupCode: created.setupCode }, 200);
  expect(signIn.body.step).toBe('setup');
  const secret = signIn.body.totpSecret as string;
  const setupStep = totpStep(new Date());
  const setup = await client(target)
    .post('/api/console/auth/setup')
    .send({ ticket: signIn.body.ticket, password: PASSWORD, code: totpCode(secret, setupStep) })
    .expect(200);
  return {
    userId: created.user.id,
    phone,
    secret,
    cookie: sessionCookie(setup.headers['set-cookie']),
    recovery: setup.body.recoveryCodes,
    setupStep,
  };
}

function sessionCookie(header: unknown): string {
  const cookie = (header as string[]).find((value) => value.startsWith('__Secure-vf-console='));
  if (!cookie) throw new Error('No console cookie');
  return cookie.split(';')[0] as string;
}

/** Phone and password, then the second step with `code`. */
async function signIn(target: INestApplication, user: SignedIn, code: string) {
  const first = await postSignIn(target, { phone: user.phone, password: PASSWORD }, 200);
  expect(first.body).toEqual({ step: 'totp', ticket: expect.any(String) });
  return client(target).post('/api/console/auth/totp').send({ ticket: first.body.ticket, code });
}

function asUser(cookie: string, target = app) {
  const http = client(target);
  return {
    get: (path: string) => http.get(path).set('cookie', cookie),
    post: (path: string) => http.post(path).set('cookie', cookie).set('origin', CONSOLE_ORIGIN),
    put: (path: string) => http.put(path).set('cookie', cookie).set('origin', CONSOLE_ORIGIN),
    patch: (path: string) => http.patch(path).set('cookie', cookie).set('origin', CONSOLE_ORIGIN),
  };
}

async function reauth(user: SignedIn) {
  nextStep();
  await asUser(user.cookie)
    .post('/api/console/auth/reauth')
    .send({ code: codeOf(user.secret) })
    .expect(200);
}

async function lastRequest(userId: string, database: Database = db) {
  const [entry] = await database
    .select()
    .from(platformAuditEntries)
    .where(
      and(
        eq(platformAuditEntries.actorId, userId),
        eq(platformAuditEntries.action, 'console.request'),
      ),
    )
    .orderBy(desc(platformAuditEntries.id))
    .limit(1);
  return entry;
}

describe('setup (rule 38)', () => {
  it('sets the password and TOTP once, shows ten recovery codes, and sets a strict cookie', async () => {
    const phone = newPhone();
    const created = await app.get(PlatformUsersService).create(OPERATOR, {
      phone,
      name: 'مدير تجريبي',
      role: 'admin',
      grantedPermissions: [],
      revokedPermissions: [],
    });
    expect(created.user.status).toBe('pending_setup');
    const start = await postSignIn(app, { phone, setupCode: created.setupCode }, 200);
    expect(start.body.totpUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = start.body.totpSecret as string;
    const weak = await client(app)
      .post('/api/console/auth/setup')
      .send({
        ticket: start.body.ticket,
        password: `${phone.slice(-7)}-abcdef`,
        code: codeOf(secret),
      });
    expect(weak.body.code).toBe('PASSWORD_TOO_WEAK');
    const wrong = await client(app)
      .post('/api/console/auth/setup')
      .send({ ticket: start.body.ticket, password: PASSWORD, code: '000000' });
    expect(wrong.body.code).toBe('TOTP_INVALID');
    const done = await client(app)
      .post('/api/console/auth/setup')
      .send({ ticket: start.body.ticket, password: PASSWORD, code: codeOf(secret) })
      .expect(200);
    expect(done.body.recoveryCodes).toHaveLength(10);
    expect(done.body.recoveryCodesRemaining).toBe(10);
    const header = (done.headers['set-cookie'] as unknown as string[])[0];
    expect(header).toMatch(
      /Path=\/api\/console\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict/,
    );
    const me = await asUser(sessionCookie(done.headers['set-cookie']))
      .get('/api/console/me')
      .expect(200);
    expect(me.body).toMatchObject({ id: created.user.id, role: 'admin' });
    expect(me.body).not.toHaveProperty('recoveryCodes');

    const again = await client(app)
      .post('/api/console/auth/setup')
      .send({ ticket: start.body.ticket, password: PASSWORD, code: codeOf(secret) });
    expect(again.body.code).toBe('TICKET_INVALID');
    const reused = await postSignIn(app, { phone, setupCode: created.setupCode });
    expect(reused.body.code).toBe('INVALID_CREDENTIALS');
    const [row] = await db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.id, created.user.id));
    expect(row).toMatchObject({ status: 'active', setupCodeHash: null });
    expect(row?.totpSecret).not.toContain(secret);
  });

  it('refuses an expired setup code like a wrong one', async () => {
    const phone = newPhone();
    const created = await app.get(PlatformUsersService).create(OPERATOR, {
      phone,
      name: 'دعم تجريبي',
      role: 'support',
      grantedPermissions: [],
      revokedPermissions: [],
    });
    vi.setSystemTime(Date.now() + 25 * 60 * MINUTE);
    const late = await postSignIn(app, { phone, setupCode: created.setupCode });
    expect(late.body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('signing in (rule 39)', () => {
  it('refuses a used TOTP step, accepts the next, and takes each recovery code once', async () => {
    const user = await setUpUser(app, 'sales');
    // The setup's step is used: the same code again is refused.
    const replay = await signIn(app, user, totpCode(user.secret, user.setupStep));
    expect(replay.body.code).toBe('TOTP_INVALID');
    nextStep();
    const fresh = await signIn(app, user, codeOf(user.secret));
    expect(fresh.status).toBe(200);
    expect(fresh.body.permissions).toEqual(['console.tenants.manage']);

    const recovery = user.recovery[0] as string;
    const byRecovery = await signIn(app, user, recovery.toLowerCase());
    expect(byRecovery.status).toBe(200);
    expect(byRecovery.body.recoveryCodesRemaining).toBe(9);
    // A recovery code is not a TOTP: sensitive actions still need one.
    expect(byRecovery.body.session.reauthenticatedUntil).toBeNull();
    const twice = await signIn(app, user, recovery);
    expect(twice.body.code).toBe('TOTP_INVALID');
    const failures = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.entityId, user.userId),
          eq(platformAuditEntries.action, 'platform_user.totp_failed'),
        ),
      );
    expect(failures).toHaveLength(2);
  });

  it('answers unknown phones, disabled users and wrong passwords alike, and locks after five', async () => {
    const user = await setUpUser(app, 'finance');
    const attempt = async (phone: string, password: string) =>
      (await postSignIn(app, { phone, password })).body.code;
    expect(await attempt(newPhone(), PASSWORD)).toBe('INVALID_CREDENTIALS');
    for (let i = 0; i < 5; i += 1) {
      expect(await attempt(user.phone, 'wrong-password-1')).toBe('INVALID_CREDENTIALS');
    }
    expect(await attempt(user.phone, PASSWORD)).toBe('RATE_LIMITED');
    const failed = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.entityId, user.userId),
          eq(platformAuditEntries.action, 'platform_user.sign_in_failed'),
        ),
      );
    expect(failed).toHaveLength(5);
    vi.setSystemTime(Date.now() + 16 * MINUTE);
    nextStep();
    expect((await signIn(app, user, codeOf(user.secret))).status).toBe(200);
  });

  it('counts TOTP guesses toward the lock, which a correct password never clears', async () => {
    const user = await setUpUser(app, 'sales');
    const ticket = async () =>
      (await postSignIn(app, { phone: user.phone, password: PASSWORD }, 200)).body.ticket as string;
    const guess = async (stepTicket: string) =>
      (
        await client(app)
          .post('/api/console/auth/totp')
          .send({ ticket: stepTicket, code: '000000' })
      ).body.code;
    const first = await ticket();
    for (let i = 0; i < 2; i += 1) expect(await guess(first)).toBe('TOTP_INVALID');
    // The password again (the 3rd and 4th claims) does not clear the two wrong codes.
    const second = await ticket();
    // Five attempts counted (two passwords, three codes): the fifth, wrong, locks the user.
    expect(await guess(second)).toBe('TOTP_INVALID');
    expect(await guess(second)).toBe('RATE_LIMITED');
    nextStep();
    const locked = await client(app)
      .post('/api/console/auth/totp')
      .send({ ticket: second, code: codeOf(user.secret) });
    expect(locked.body.code).toBe('RATE_LIMITED');
  });

  it('ends the session when wrong re-auth codes lock the user (reauth_failed)', async () => {
    const user = await setUpUser(app, 'support');
    let last = '';
    for (let i = 0; i < 5; i += 1) {
      last = (await asUser(user.cookie).post('/api/console/auth/reauth').send({ code: '000000' }))
        .body.code;
    }
    expect(last).toBe('TOTP_INVALID');
    const ended = await asUser(user.cookie).get('/api/console/me');
    expect(ended.body.code).toBe('SESSION_ENDED');
  });

  it('ends the session at sign-out, at 30 idle minutes and at 12 hours', async () => {
    const user = await setUpUser(app, 'dispatch');
    await asUser(user.cookie).post('/api/console/auth/sign-out').expect(204);
    const ended = await asUser(user.cookie).get('/api/console/me');
    expect(ended.body.code).toBe('SESSION_ENDED');
    expect(await lastRequest(user.userId)).toMatchObject({
      requestRoute: 'GET /api/console/me',
      details: { outcome: 'SESSION_ENDED', params: {} },
    });

    nextStep();
    const idle = sessionCookie(
      (await signIn(app, user, codeOf(user.secret))).headers['set-cookie'],
    );
    vi.setSystemTime(Date.now() + 29 * MINUTE);
    await asUser(idle).get('/api/console/me').expect(200);
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    expect((await asUser(idle).get('/api/console/me')).body.code).toBe('SESSION_ENDED');

    nextStep();
    const long = sessionCookie(
      (await signIn(app, user, codeOf(user.secret))).headers['set-cookie'],
    );
    // A request every 29 minutes keeps it from idling, until the 12 hours are over.
    for (let i = 0; i < 24; i += 1) {
      vi.setSystemTime(Date.now() + 29 * MINUTE);
      await asUser(long).get('/api/console/me').expect(200);
    }
    vi.setSystemTime(Date.now() + 29 * MINUTE);
    expect((await asUser(long).get('/api/console/me')).body.code).toBe('SESSION_ENDED');
  });

  it('changes the own password, ending the other sessions', async () => {
    const user = await setUpUser(app, 'support');
    nextStep();
    const other = sessionCookie(
      (await signIn(app, user, codeOf(user.secret))).headers['set-cookie'],
    );
    const wrong = await asUser(user.cookie)
      .put('/api/console/me/password')
      .send({ currentPassword: 'not-the-password', newPassword: 'olive-harbor-stone-77' });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    await asUser(user.cookie)
      .put('/api/console/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'olive-harbor-stone-77' })
      .expect(204);
    await asUser(user.cookie).get('/api/console/me').expect(200);
    expect((await asUser(other).get('/api/console/me')).body.code).toBe('SESSION_ENDED');
  });
});

describe('every console request (rules 40, 41, 43)', () => {
  it('needs a TOTP in the last 5 minutes for slug and status changes, audited with the tenant', async () => {
    const admin = await setUpUser(app, 'admin');
    const { tenantId } = await api.newTenant();
    const slug = `c-${Date.now().toString(36)}`;
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    const refused = await asUser(admin.cookie)
      .put(`/api/console/tenants/${tenantId}/slug`)
      .send({ slug });
    expect(refused.body.code).toBe('REAUTH_REQUIRED');
    expect(await lastRequest(admin.userId)).toMatchObject({
      requestRoute: 'PUT /api/console/tenants/:id/slug',
      subjectTenantId: tenantId,
      details: { outcome: 'REAUTH_REQUIRED', params: { id: tenantId } },
    });
    const status = await asUser(admin.cookie)
      .post(`/api/console/tenants/${tenantId}/status`)
      .send({ to: 'suspended', reason: 'other' });
    expect(status.body.code).toBe('REAUTH_REQUIRED');

    await reauth(admin);
    const me = await asUser(admin.cookie).get('/api/console/me').expect(200);
    expect(me.body.session.reauthenticatedUntil).not.toBeNull();
    await asUser(admin.cookie)
      .put(`/api/console/tenants/${tenantId}/slug`)
      .send({ slug })
      .expect(200);
    expect(await lastRequest(admin.userId)).toMatchObject({ details: { outcome: 'allowed' } });
    const tenantAudit = await withTenant(db, tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'tenant.slug_changed')),
    );
    expect(tenantAudit[0]).toMatchObject({ actorKind: 'platform', actorId: admin.userId });

    const wrong = await asUser(admin.cookie)
      .post('/api/console/auth/reauth')
      .send({ code: '000000' });
    expect(wrong.body.code).toBe('TOTP_INVALID');
  });

  it('refuses a write from another origin and a missing permission, audited', async () => {
    const sales = await setUpUser(app, 'sales');
    const foreign = await client(app)
      .post('/api/console/auth/sign-out')
      .set('cookie', sales.cookie)
      .set('origin', 'https://evil.example');
    expect(foreign.body.code).toBe('FORBIDDEN');
    expect(await lastRequest(sales.userId)).toMatchObject({ details: { outcome: 'FORBIDDEN' } });
    // The restaurant app's origin is not the console's.
    const restaurant = await client(app)
      .post('/api/console/auth/sign-out')
      .set('cookie', sales.cookie)
      .set('origin', 'app://restaurant');
    expect(restaurant.body.code).toBe('FORBIDDEN');
    const users = await asUser(sales.cookie).get('/api/console/platform-users');
    expect(users.body.code).toBe('FORBIDDEN');
    expect(await lastRequest(sales.userId)).toMatchObject({
      requestRoute: 'GET /api/console/platform-users',
      details: { outcome: 'FORBIDDEN' },
    });
    const recover = await asUser(sales.cookie)
      .post('/api/console/accounts/lookup')
      .send({ phone: newPhone() });
    expect(recover.body.code).toBe('FORBIDDEN');
  });

  it('writes no audit for an unknown token, and keeps staff and console sessions apart', async () => {
    const consoleRequests = () =>
      db
        .select()
        .from(platformAuditEntries)
        .where(eq(platformAuditEntries.action, 'console.request'));
    const before = await consoleRequests();
    const unknown = await client(app)
      .get('/api/console/me')
      .set('cookie', '__Secure-vf-console=not-a-session');
    expect(unknown.status).toBe(401);
    expect(await consoleRequests()).toHaveLength(before.length);

    // A real owner's access token, on every console route of S01 and S02.
    const { tenantId, owner } = await api.ownerOnDevice();
    const consoleRoutes = listRoutes(app).filter((route) => route.access?.kind === 'console');
    for (const route of consoleRoutes) {
      const path = route.path.replace(/:\w+/g, tenantId);
      const response = await client(app)
        [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch'](path)
        .set('authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
    const admin = await setUpUser(app, 'admin');
    const staffRoute = await client(app).get('/api/me').set('cookie', admin.cookie);
    expect(staffRoute.status).toBe(401);
  });

  it('declares every console route behind a console session or a sign-in step', () => {
    for (const route of listRoutes(app).filter((r) => r.path.startsWith('/api/console/'))) {
      const kind = route.access?.kind;
      expect(kind === 'console' || route.path.startsWith('/api/console/auth/'), route.path).toBe(
        true,
      );
    }
  });
});

describe('platform users (rule 42)', () => {
  it('creates with a setup code once, within the limits; an admin never changes themself', async () => {
    const admin = await setUpUser(app, 'admin');
    await reauth(admin);
    const outside = await asUser(admin.cookie)
      .post('/api/console/platform-users')
      .send({
        phone: newPhone(),
        name: 'مبيعات',
        role: 'sales',
        grantedPermissions: ['console.users.manage'],
      });
    expect(outside.body.code).toBe('PERMISSION_NOT_GRANTABLE');
    const created = await asUser(admin.cookie)
      .post('/api/console/platform-users')
      .send({ phone: newPhone(), name: 'مبيعات', role: 'sales' })
      .expect(201);
    expect(created.body.setupCode).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    const listed = await asUser(admin.cookie).get('/api/console/platform-users').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.setupCode);

    const promoted = await asUser(admin.cookie)
      .patch(`/api/console/platform-users/${created.body.user.id}`)
      .send({
        role: 'finance',
        grantedPermissions: [],
        revokedPermissions: ['console.tenants.status'],
      })
      .expect(200);
    expect(promoted.body.effectivePermissions).toEqual([]);
    for (const change of [{ disabled: true }, { role: 'support' }]) {
      const self = await asUser(admin.cookie)
        .patch(`/api/console/platform-users/${admin.userId}`)
        .send(change);
      expect(self.body.code).toBe('FORBIDDEN');
    }
    const selfReset = await asUser(admin.cookie).post(
      `/api/console/platform-users/${admin.userId}/reset`,
    );
    expect(selfReset.body.code).toBe('FORBIDDEN');
  });

  it('disables and resets another user, ending their sessions', async () => {
    const admin = await setUpUser(app, 'admin');
    const other = await setUpUser(app, 'support');
    await reauth(admin);
    await asUser(admin.cookie)
      .patch(`/api/console/platform-users/${other.userId}`)
      .send({ disabled: true })
      .expect(200);
    expect((await asUser(other.cookie).get('/api/console/me')).body.code).toBe('SESSION_ENDED');
    // A disabled user is answered as a wrong password, and the attempt is audited (rule 43).
    const disabled = await postSignIn(app, { phone: other.phone, password: PASSWORD });
    expect(disabled.body.code).toBe('INVALID_CREDENTIALS');
    const [failure] = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.entityId, other.userId),
          eq(platformAuditEntries.action, 'platform_user.sign_in_failed'),
        ),
      );
    expect(failure).toBeDefined();
    const enabled = await asUser(admin.cookie)
      .patch(`/api/console/platform-users/${other.userId}`)
      .send({ disabled: false })
      .expect(200);
    expect(enabled.body.status).toBe('active');
    const reset = await asUser(admin.cookie)
      .post(`/api/console/platform-users/${other.userId}/reset`)
      .expect(200);
    expect(reset.body.user.status).toBe('pending_setup');
    const signInAgain = await postSignIn(app, { phone: other.phone, password: PASSWORD });
    expect(signInAgain.body.code).toBe('INVALID_CREDENTIALS');
    const actions = await db
      .select({ action: platformAuditEntries.action })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, other.userId));
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'platform_user.disabled',
        'platform_user.updated',
        'platform_user.reset',
      ]),
    );
  });

  // Admins are counted across the platform: the earlier tests' admins are disabled first (only
  // this file sets admins up).
  it('never disables or demotes the last admin (LAST_ADMIN), concurrently too', async () => {
    await db
      .update(platformUsers)
      .set({ status: 'disabled' })
      .where(and(eq(platformUsers.role, 'admin'), eq(platformUsers.status, 'active')));
    const first = await setUpUser(app, 'admin');
    const second = await setUpUser(app, 'admin');
    nextStep();
    const service = app.get(PlatformUsersService);
    const actor = (user: SignedIn) => ({
      kind: 'platform' as const,
      userId: user.userId,
      sessionId: user.userId,
      permissions: [],
      reauthenticatedAt: null,
    });
    // Each disables the other at once: one wins, the other is refused.
    const [a, b] = await Promise.allSettled([
      service.update(actor(first), second.userId, { disabled: true }),
      service.update(actor(second), first.userId, { disabled: true }),
    ]);
    const outcomes = [a, b].map((result) =>
      result.status === 'fulfilled' ? 'ok' : (result.reason as { code: string }).code,
    );
    expect(outcomes.sort()).toEqual(['LAST_ADMIN', 'ok']);
    // The survivor is the last admin: the CLI may not demote them, but may reset them.
    const survivor = a.status === 'fulfilled' ? first : second;
    await expect(
      service.update(OPERATOR, survivor.userId, { role: 'sales' }),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    await expect(
      service.update(OPERATOR, survivor.userId, { disabled: true }),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    const reset = await service.reset(OPERATOR, survivor.userId);
    expect(reset.user.status).toBe('pending_setup');
  });
});

describe('owner recovery (rule 15)', () => {
  it('looks up an account, authorizes a reset and changes the phone, in both audits', async () => {
    const support = await setUpUser(app, 'support');
    const { tenantId, ownerPhone } = await api.newTenant();
    const looked = await asUser(support.cookie)
      .post('/api/console/accounts/lookup')
      .send({ phone: ownerPhone })
      .expect(200);
    expect(looked.body.memberships).toEqual([
      expect.objectContaining({ tenantId, roles: ['owner'], tenantStatus: 'onboarding' }),
    ]);
    const missing = await asUser(support.cookie)
      .post('/api/console/accounts/lookup')
      .send({ phone: newPhone() });
    expect(missing.body.code).toBe('NOT_FOUND');

    const accountId = looked.body.id as string;
    // The same person is a cashier in another restaurant: that tenant's audit gets nothing.
    const elsewhere = await api.ownerOnDevice();
    await elsewhere.device.addMember(elsewhere.owner, {
      phone: ownerPhone,
      displayName: 'كاشير',
      roles: ['cashier'],
      branchScope: { allBranches: true },
    });
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    const needsTotp = await asUser(support.cookie)
      .post(`/api/console/accounts/${accountId}/password-reset`)
      .send({ reason: 'تحقق من الهوية بالهاتف' });
    expect(needsTotp.body.code).toBe('REAUTH_REQUIRED');
    await reauth(support);
    const reset = await asUser(support.cookie)
      .post(`/api/console/accounts/${accountId}/password-reset`)
      .send({ reason: 'تحقق من الهوية بالهاتف' })
      .expect(200);
    expect(reset.body.accountId).toBe(accountId);

    const taken = await asUser(support.cookie)
      .put(`/api/console/accounts/${accountId}/phone`)
      .send({ phone: (await api.newTenant()).ownerPhone, reason: 'رقم جديد' });
    expect(taken.body.code).toBe('ALREADY_MEMBER');
    const newNumber = newPhone();
    const changed = await asUser(support.cookie)
      .put(`/api/console/accounts/${accountId}/phone`)
      .send({ phone: newNumber, reason: 'رقم جديد' })
      .expect(200);
    expect(changed.body.phone).toBe(newNumber);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account?.phoneVerifiedAt).toBeNull();

    const platform = await db
      .select({ action: platformAuditEntries.action, reason: platformAuditEntries.reason })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, accountId));
    expect(platform).toEqual(
      expect.arrayContaining([
        { action: 'account.password_reset_authorized', reason: 'تحقق من الهوية بالهاتف' },
        { action: 'account.phone_changed', reason: 'رقم جديد' },
      ]),
    );
    const tenant = await withTenant(db, tenantId, (tx) =>
      tx
        .select({
          action: auditEntries.action,
          reason: auditEntries.reason,
          kind: auditEntries.actorKind,
        })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, accountId)),
    );
    expect(tenant).toEqual(
      expect.arrayContaining([
        { action: 'account.password_reset_authorized', reason: null, kind: 'platform' },
        { action: 'account.phone_changed', reason: null, kind: 'platform' },
      ]),
    );
    const notOwner = await withTenant(db, elsewhere.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.entityId, accountId)),
    );
    expect(notOwner).toEqual([]);
    // The phone never reaches the platform audit.
    const rows = await db
      .select()
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.actorId, support.userId));
    expect(JSON.stringify(rows)).not.toContain(newNumber.slice(1));
  });
});
