import type { INestApplication } from '@nestjs/common';
import {
  accounts,
  createDatabase,
  devices,
  staffSessions,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { listRoutes } from '../src/core/routes.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import {
  client,
  newPhone,
  OPERATOR,
  ORIGIN,
  PASSWORD,
  pinFor,
  proofOfWork,
  TestApi,
} from './staff.js';

// Spec S02, the reviews' gaps closed: every route refused before its body is read, device-only
// routes refused to personal sessions, another tenant's ids on every write, what an added phone
// may reveal, the lockouts that re-authentication and PIN changes must respect, and the closure
// (immediate and scheduled) with the owner's read-only access.

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));
const owners = createDatabase(inject('ownerUrl'));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
  await owners.$client.end();
});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A personal-device session cookie of the tenant's owner. */
async function ownerPersonalSession(ownerPhone: string, tenantId: string) {
  const { ticket } = await api.signInWithOtp(ownerPhone, 'personal');
  const opened = await api
    .http()
    .post('/api/auth/personal-session')
    .set('x-sign-in-ticket', ticket)
    .send({ tenantId });
  if (opened.status !== 200) return { status: opened.status, code: opened.body.code as string };
  const cookies = opened.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((value) => value.startsWith('__Secure-vf-session='));
  return { cookie: (cookie as string).split(';')[0] as string };
}

describe('the authentication step on every route (rule 46)', () => {
  it('serves no route under a percent-encoded spelling of its path', async () => {
    const response = await client(app).post('/api/%73taff').send({});
    expect([response.status, response.body.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('refuses every non-public route before parsing a malformed body, in any case', async () => {
    const routes = listRoutes(app).filter((route) => route.access?.kind !== 'public');
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, uuidv7());
      for (const spelled of [path, path.toUpperCase()]) {
        const response = await client(app)
          [route.method.toLowerCase() as Method](spelled)
          .set('content-type', 'application/json')
          .send('{"not": json');
        expect(response.status, `${route.method} ${spelled}`).toBe(401);
        expect(['UNAUTHENTICATED', 'TICKET_INVALID']).toContain(response.body.code);
      }
    }
  });

  it('refuses every device-only route to a personal session (rule 34)', async () => {
    const { ownerPhone, tenantId } = await api.ownerOnDevice();
    const { cookie } = await ownerPersonalSession(ownerPhone, tenantId);
    const routes = listRoutes(app).filter(
      (route) => route.access?.kind === 'staff' && route.access.options.device === 'required',
    );
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, uuidv7());
      const response = await client(app)
        [route.method.toLowerCase() as Method](path)
        .set('cookie', cookie as string)
        .set('origin', ORIGIN)
        .send({});
      expect(response.body.code, `${route.method} ${route.path}`).toBe('DEVICE_REQUIRED');
    }
  });
});

describe("another tenant's ids (ADR 0004)", () => {
  it('answer NOT_FOUND on every write', async () => {
    const mine = await api.ownerOnDevice();
    const theirs = await api.ownerOnDevice();
    const member = theirs.ownerMembershipId;
    const as = mine.device.as(mine.owner);
    const now = new Date().toISOString();
    const writes: [Method, string, object][] = [
      [
        'patch',
        `/api/staff/${member}/access`,
        {
          roles: ['owner'],
          branchScope: { allBranches: true },
          grantedPermissions: [],
          revokedPermissions: [],
          updatedAt: now,
        },
      ],
      ['post', `/api/staff/${member}/deactivate`, { reason: 'تجربة' }],
      ['post', `/api/staff/${member}/reactivate`, {}],
      ['post', `/api/staff/${member}/password-reset`, {}],
      ['put', `/api/staff/${member}/pin`, { pin: pinFor(8) }],
      ['patch', `/api/devices/${theirs.device.deviceId}`, { name: 'اسم جديد' }],
      ['post', `/api/devices/${theirs.device.deviceId}/revoke`, { reason: 'other' }],
      [
        'patch',
        `/api/branches/${theirs.branchIds[0]}/security`,
        { idleLockMinutes: 3, updatedAt: now },
      ],
    ];
    for (const [method, path, body] of writes) {
      const response = await as[method](path).send(body);
      expect(response.body.code, `${method} ${path}`).toBe('NOT_FOUND');
    }
  });
});

describe('what adding a phone may reveal (rule 1, edge case 3)', () => {
  it('shows neither the name nor the password of an account until the person is present', async () => {
    const elsewhere = await api.ownerOnDevice();
    const { device, owner } = await api.ownerOnDevice();
    const added = await device
      .as(owner)
      .post('/api/staff')
      .send({
        phone: elsewhere.ownerPhone,
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: true },
        grantedPermissions: [],
        revokedPermissions: [],
      })
      .expect(201);
    expect(added.body).toMatchObject({ nameAr: null, hasPassword: false, displayName: 'كاشير' });
    const list = await (await device.device()).get('/api/devices/current/members').expect(200);
    const listed = list.body.list.members.find(
      (m: { membershipId: string }) => m.membershipId === added.body.id,
    );
    expect(listed.name).toBe('كاشير');
    // A PIN the restaurant sets, and a PIN session it opens with it, reveal nothing either.
    await device
      .as(owner)
      .put(`/api/staff/${added.body.id}/pin`)
      .send({ pin: pinFor(4) })
      .expect(204);
    const forged = await device.signIn(added.body.id, pinFor(4));
    expect((await device.as(owner).get(`/api/staff/${added.body.id}`)).body).toMatchObject({
      nameAr: null,
      hasPassword: false,
    });
    expect((await device.as(forged).get('/api/me')).body.account).toMatchObject({
      nameAr: null,
      hasPassword: false,
    });
    const devicesRead = await device.as(forged).get('/api/me/personal-devices');
    expect(devicesRead.body.code).toBe('REAUTH_REQUIRED');
    const devicesRevoked = await device
      .as(forged)
      .post(`/api/me/personal-devices/${added.body.id}/revoke`);
    expect(devicesRevoked.body.code).toBe('REAUTH_REQUIRED');
    // Once the person entered their own password in a session here, the tenant sees their name.
    const own = await device.signIn(added.body.id, pinFor(4));
    await device
      .as(own)
      .post('/api/sessions/current/reauth')
      .send({ password: PASSWORD })
      .expect(204);
    const after = await device.as(owner).get(`/api/staff/${added.body.id}`).expect(200);
    expect(after.body).toMatchObject({ nameAr: 'اسم تجريبي', hasPassword: true });
  });

  it("never opens a reset of another tenant's member, with the same answer", async () => {
    const elsewhere = await api.ownerOnDevice();
    const { device, owner } = await api.ownerOnDevice();
    const added = await device
      .as(owner)
      .post('/api/staff')
      .send({
        phone: elsewhere.ownerPhone,
        displayName: 'مدير',
        roles: ['manager'],
        branchScope: { allBranches: true },
        grantedPermissions: [],
        revokedPermissions: [],
      })
      .expect(201);
    await device.as(owner).post(`/api/staff/${added.body.id}/password-reset`).send({}).expect(204);
    const [account] = await db
      .select({ until: accounts.passwordResetAuthorizedUntil })
      .from(accounts)
      .where(eq(accounts.phone, elsewhere.ownerPhone));
    expect(account?.until).toBeNull();
  });
});

describe('lockouts on every path (rules 11, 24)', () => {
  it('answers re-entries alike whether the account has a password or not', async () => {
    const elsewhere = await api.ownerOnDevice();
    const { device, owner } = await api.ownerOnDevice();
    const answersFor = async (phone?: string) => {
      const added = await device
        .as(owner)
        .post('/api/staff')
        .send({
          ...(phone ? { phone } : { phone: newPhone() }),
          displayName: 'عضو',
          roles: ['cashier'],
          branchScope: { allBranches: true },
          grantedPermissions: [],
          revokedPermissions: [],
        })
        .expect(201);
      const pin = pinFor(phone ? 11 : 12);
      await device.as(owner).put(`/api/staff/${added.body.id}/pin`).send({ pin }).expect(204);
      const codes: string[] = [];
      for (const tries of [5, 1]) {
        const forged = await device.signIn(added.body.id, pin);
        for (let i = 0; i < tries; i += 1) {
          const response = await device
            .as(forged)
            .post('/api/sessions/current/reauth')
            .send({ password: 'a-guess-of-the-password' });
          codes.push(response.body.code);
        }
      }
      return codes;
    };
    const withPassword = await answersFor(elsewhere.ownerPhone);
    const withoutPassword = await answersFor();
    expect(withPassword).toEqual([...Array(5).fill('INVALID_CREDENTIALS'), 'RATE_LIMITED']);
    expect(withoutPassword).toEqual(withPassword);
  });

  it('counts wrong re-authentications toward the sign-in lock', async () => {
    const { device, ownerMembershipId, ownerPhone } = await api.ownerOnDevice();
    const session = await device.signIn(ownerMembershipId, pinFor(0));
    for (let i = 0; i < 5; i += 1) {
      const wrong = await device
        .as(session)
        .post('/api/sessions/current/reauth')
        .send({ password: 'not-the-password' });
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    }
    const fresh = await device.signIn(ownerMembershipId, pinFor(0));
    const locked = await device
      .as(fresh)
      .post('/api/sessions/current/reauth')
      .send({ password: PASSWORD });
    expect(locked.body.code).toBe('RATE_LIMITED');
    const solved = await proofOfWork(app);
    const signIn = await api
      .http()
      .post('/api/auth/sign-in')
      .send({ phone: ownerPhone, password: PASSWORD, intent: 'personal', proofOfWork: solved });
    expect(signIn.body.code).toBe('RATE_LIMITED');
  });

  // Ten Argon2id checks at 64 MiB: slower than the default limit while other files run.
  it('counts a wrong current PIN as a wrong PIN', { timeout: 30_000 }, async () => {
    const { device, ownerMembershipId } = await api.ownerOnDevice();
    const session = await device.signIn(ownerMembershipId, pinFor(0));
    const change = () =>
      device
        .as(session)
        .put('/api/me/pin')
        .send({ currentPin: pinFor(9), newPin: pinFor(5) });
    for (let i = 0; i < 9; i += 1) expect((await change()).body.code).toBe('INVALID_PIN');
    expect((await change()).body.code).toBe('PIN_DISABLED');
    const reopen = await (await device.device())
      .post('/api/sessions')
      .send({ membershipId: ownerMembershipId, pin: pinFor(0) });
    expect(reopen.body.code).toBe('PIN_DISABLED');
  });
});

describe('the closure (rule 37)', () => {
  it("leaves the owner a read-only personal session and refuses everyone else's", async () => {
    const { device, owner, tenantId, ownerPhone, branchIds } = await api.ownerOnDevice();
    const manager = await device.addMember(owner, {
      displayName: 'مدير',
      roles: ['manager'],
      branchScope: { allBranches: false, branchIds: [branchIds[0] as string] },
    });
    await api.firstSignIn(manager.phone, 'personal');
    await app
      .get(TenancyService)
      .changeStatus(OPERATOR, tenantId, { to: 'closed', reason: 'other' });
    const { cookie } = await ownerPersonalSession(ownerPhone, tenantId);
    await client(app)
      .get('/api/tenant')
      .set('cookie', cookie as string)
      .expect(200);
    const write = await client(app)
      .put('/api/me/password')
      .set('cookie', cookie as string)
      .set('origin', ORIGIN)
      .send({ currentPassword: PASSWORD, newPassword: 'another-long-pass-7' });
    expect(write.body.code).toBe('TENANT_CLOSED');
    const refused = await ownerPersonalSession(manager.phone, tenantId);
    expect(refused.code).toBe('FORBIDDEN');
  });

  it('applies a closure the worker scheduled at the next device request', async () => {
    const { device, owner, tenantId } = await api.ownerOnDevice();
    const now = new Date();
    await owners
      .update(tenants)
      .set({
        status: 'active',
        onboardingCompletedAt: now,
        activatedAt: now,
        scheduledStatus: 'closed',
        scheduledStatusReason: 'other',
        scheduledStatusAt: new Date(now.getTime() - 60_000),
      })
      .where(eq(tenants.id, tenantId));
    const pc = await device.device();
    expect((await pc.get('/api/devices/current/members')).body.code).toBe('DEVICE_REVOKED');
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(devices).where(eq(devices.id, device.deviceId)),
    );
    expect(row).toMatchObject({ status: 'revoked', revokeReason: 'tenant_closed' });
    const [session] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(staffSessions).where(eq(staffSessions.id, owner.sessionId)),
    );
    expect(session?.endReason).toBe('tenant_closed');
  });
});
