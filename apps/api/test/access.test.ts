import type { INestApplication } from '@nestjs/common';
import { effectivePermissions } from '@vertex-food/contracts';
import { createDatabase, staffSessions, tenants, withTenant } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { listRoutes } from '../src/core/routes.js';
import { createTestApp } from './app.js';
import { newPhone, PASSWORD, pinFor, TestApi, type TestDevice } from './staff.js';

// Spec S02 access over HTTP: staff management (rules 1–9, 14), and every S01 and S02 route
// refused without the permission, for another tenant's ids, and for the wrong kind of session.

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

/** An owner on a PC of a two-branch tenant, with a manager of the first branch signed in. */
async function withManager() {
  const setup = await api.ownerOnDevice(['main', 'east']);
  const [main, east] = setup.branchIds as [string, string];
  const manager = await setup.device.addMember(
    setup.owner,
    {
      displayName: 'مدير',
      roles: ['manager'],
      branchScope: { allBranches: false, branchIds: [main] },
    },
    pinFor(1),
  );
  await api.firstSignIn(manager.phone);
  const managerSession = await setup.device.signIn(manager.id, pinFor(1));
  await setup.device
    .as(managerSession)
    .post('/api/sessions/current/reauth')
    .send({ password: PASSWORD })
    .expect(204);
  return { ...setup, main, east, manager, managerSession };
}

const member = (roles: string[], branchIds: string[] | null) => ({
  phone: newPhone(),
  displayName: 'عضو',
  roles,
  branchScope: branchIds ? { allBranches: false, branchIds } : { allBranches: true },
  grantedPermissions: [],
  revokedPermissions: [],
});

describe('adding members (rules 1–3)', () => {
  it('links an existing account without telling, and refuses a second membership', async () => {
    const other = await api.newTenant();
    const { device, owner } = await api.ownerOnDevice();
    const body = { ...member(['cashier'], null), phone: other.ownerPhone };
    const added = await device.as(owner).post('/api/staff').send(body).expect(201);
    const fresh = await device
      .as(owner)
      .post('/api/staff')
      .send(member(['cashier'], null));
    expect(Object.keys(added.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(added.body).toMatchObject({ status: 'active', hasPassword: false, pinSet: false });
    const again = await device.as(owner).post('/api/staff').send(body);
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_MEMBER']);
  });

  it('refuses grants outside the limits (rule 5)', async () => {
    const { device, owner } = await api.ownerOnDevice();
    const response = await device
      .as(owner)
      .post('/api/staff')
      .send({ ...member(['cashier'], null), grantedPermissions: ['staff.manage'] });
    expect([response.status, response.body.code]).toEqual([422, 'PERMISSION_NOT_GRANTABLE']);
  });

  it('refuses adding members while the restaurant is suspended (rule 36)', async () => {
    const { device, owner, tenantId } = await api.ownerOnDevice();
    // A suspension waits for the end of the business day (S01 rule 6): set it as it lands.
    const owners = createDatabase(inject('ownerUrl'));
    const now = new Date();
    await owners
      .update(tenants)
      .set({
        status: 'suspended',
        statusReason: 'other',
        onboardingCompletedAt: now,
        activatedAt: now,
      })
      .where(eq(tenants.id, tenantId));
    await owners.$client.end();
    const response = await device
      .as(owner)
      .post('/api/staff')
      .send(member(['cashier'], null));
    expect(response.body.code).toBe('TENANT_SUSPENDED');
  });
});

describe('who manages whom (rule 7)', () => {
  it('lets a manager add floor staff of their branch only, with no adjustments', async () => {
    const { device, managerSession, main, east } = await withManager();
    const as = device.as(managerSession);
    await as
      .post('/api/staff')
      .send(member(['cashier'], [main]))
      .expect(201);
    for (const body of [
      member(['manager'], [main]),
      member(['cashier'], [east]),
      member(['cashier'], null),
      { ...member(['cashier'], [main]), grantedPermissions: ['tenant.view'] },
    ]) {
      const response = await as.post('/api/staff').send(body);
      expect(response.body.code, JSON.stringify(body.roles)).toBe('FORBIDDEN');
    }
  });

  it('refuses a manager changing another manager or an owner', async () => {
    const { device, owner, managerSession, main, ownerMembershipId } = await withManager();
    const peer = await device
      .as(owner)
      .post('/api/staff')
      .send(member(['manager'], [main]));
    for (const target of [peer.body.id, ownerMembershipId]) {
      const current = await device.as(owner).get(`/api/staff/${target}`).expect(200);
      const changed = await device
        .as(managerSession)
        .patch(`/api/staff/${target}/access`)
        .send({
          roles: ['cashier'],
          branchScope: { allBranches: false, branchIds: [main] },
          grantedPermissions: [],
          revokedPermissions: [],
          updatedAt: current.body.updatedAt,
        });
      expect(changed.body.code).toBe('FORBIDDEN');
      const deactivated = await device
        .as(managerSession)
        .post(`/api/staff/${target}/deactivate`)
        .send({ reason: 'تجربة' });
      expect(deactivated.body.code).toBe('FORBIDDEN');
    }
  });

  it('shows a manager the members of their branches only', async () => {
    const { device, owner, managerSession, east } = await withManager();
    const elsewhere = await device
      .as(owner)
      .post('/api/staff')
      .send(member(['waiter'], [east]));
    const list = await device.as(managerSession).get('/api/staff').expect(200);
    const ids = list.body.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(elsewhere.body.id);
    const one = await device.as(managerSession).get(`/api/staff/${elsewhere.body.id}`);
    expect(one.body.code).toBe('NOT_FOUND');
  });

  it('gives the catalog with the roles the caller may assign', async () => {
    const { device, owner, managerSession } = await withManager();
    const forOwner = await device.as(owner).get('/api/access/catalog').expect(200);
    const forManager = await device.as(managerSession).get('/api/access/catalog').expect(200);
    expect(forOwner.body).toMatchObject({ mayAdjustPermissions: true });
    expect(forOwner.body.assignableRoles).toHaveLength(6);
    expect(forManager.body).toMatchObject({ mayAdjustPermissions: false });
    expect(forManager.body.assignableRoles.sort()).toEqual([
      'cashier',
      'driver',
      'kitchen',
      'waiter',
    ]);
  });
});

describe('access changes (rules 4, 8, 9)', () => {
  it('keeps the last owner and refuses a stale change', async () => {
    const { device, owner, ownerMembershipId } = await api.ownerOnDevice();
    const current = await device.as(owner).get(`/api/staff/${ownerMembershipId}`).expect(200);
    const change = {
      roles: ['manager'],
      branchScope: { allBranches: true },
      grantedPermissions: [],
      revokedPermissions: [],
      updatedAt: current.body.updatedAt,
    };
    const demoted = await device
      .as(owner)
      .patch(`/api/staff/${ownerMembershipId}/access`)
      .send(change);
    expect([demoted.status, demoted.body.code]).toEqual([409, 'LAST_OWNER']);
    const deactivated = await device
      .as(owner)
      .post(`/api/staff/${ownerMembershipId}/deactivate`)
      .send({ reason: 'تجربة' });
    expect(deactivated.body.code).toBe('LAST_OWNER');
    const stale = await device
      .as(owner)
      .patch(`/api/staff/${ownerMembershipId}/access`)
      .send({ ...change, roles: ['owner'], updatedAt: new Date(0).toISOString() });
    expect(stale.body.code).toBe('CONFLICT');
  });

  it('ends the sessions of a deactivated member and drops them from member lists', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const main = branchIds[0] as string;
    const cashier = await device.addMember(
      owner,
      {
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [main] },
      },
      pinFor(2),
    );
    const session = await device.signIn(cashier.id, pinFor(2));
    await device
      .as(owner)
      .post(`/api/staff/${cashier.id}/deactivate`)
      .send({ reason: 'غادر العمل' })
      .expect(200);
    expect((await device.as(session).get('/api/me')).body.code).toBe('SESSION_ENDED');
    const pc = await device.device();
    const list = await pc.get('/api/devices/current/members').expect(200);
    const ids = list.body.list.members.map((m: { membershipId: string }) => m.membershipId);
    expect(ids).not.toContain(cashier.id);
    const reopen = await pc
      .post('/api/sessions')
      .send({ membershipId: cashier.id, pin: pinFor(2) });
    expect(reopen.body.code).toBe('MEMBERSHIP_INACTIVE');
    await device.as(owner).post(`/api/staff/${cashier.id}/reactivate`).send({}).expect(200);
    await device.signIn(cashier.id, pinFor(2));
  });

  it('ends sessions on the PCs of a branch removed from the scope', async () => {
    const { device, owner, branchIds, tenantId } = await api.ownerOnDevice(['main', 'east']);
    const [main, east] = branchIds as [string, string];
    const waiter = await device.addMember(
      owner,
      {
        displayName: 'نادل',
        roles: ['waiter'],
        branchScope: { allBranches: false, branchIds: [main, east] },
      },
      pinFor(3),
    );
    const session = await device.signIn(waiter.id, pinFor(3));
    const moved = await device
      .as(owner)
      .patch(`/api/staff/${waiter.id}/access`)
      .send({
        roles: ['waiter'],
        branchScope: { allBranches: false, branchIds: [east] },
        grantedPermissions: [],
        revokedPermissions: [],
        updatedAt: waiter.updatedAt,
      })
      .expect(200);
    expect(moved.body.branchIds).toEqual([east]);
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(staffSessions).where(eq(staffSessions.id, session.sessionId)),
    );
    expect(row?.endReason).toBe('branch_left');
    const reopen = await (await device.device())
      .post('/api/sessions')
      .send({ membershipId: waiter.id, pin: pinFor(3) });
    expect(reopen.body.code).toBe('BRANCH_NOT_IN_SCOPE');
  });

  it('takes manager-only grants away with the manager role (edge case 4)', async () => {
    const { device, owner, manager, main } = await withManager();
    const granted = await device
      .as(owner)
      .patch(`/api/staff/${manager.id}/access`)
      .send({
        roles: ['manager'],
        branchScope: { allBranches: false, branchIds: [main] },
        grantedPermissions: ['branch.settings.edit'],
        revokedPermissions: [],
        updatedAt: manager.updatedAt,
      })
      .expect(200);
    expect(granted.body.effectivePermissions).toContain('branch.settings.edit');
    const demoted = await device
      .as(owner)
      .patch(`/api/staff/${manager.id}/access`)
      .send({
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [main] },
        grantedPermissions: [],
        revokedPermissions: [],
        updatedAt: granted.body.updatedAt,
      })
      .expect(200);
    expect(demoted.body.effectivePermissions).toEqual(effectivePermissions(['cashier'], [], []));
  });
});

describe('every route over HTTP', () => {
  async function cashierOf(
    device: TestDevice,
    owner: Parameters<TestDevice['as']>[0],
    main: string,
  ) {
    const cashier = await device.addMember(
      owner,
      {
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [main] },
      },
      pinFor(7),
    );
    return device.signIn(cashier.id, pinFor(7));
  }

  it('refuses a cashier on every staff route that needs a permission they lack', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    const cashier = await cashierOf(device, owner, branchIds[0] as string);
    const routes = listRoutes(app).filter(
      (route) =>
        route.access?.kind === 'staff' &&
        route.access.permissions.length > 0 &&
        !route.access.permissions.includes('tenant.view'),
    );
    expect(routes.length).toBeGreaterThan(15);
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, uuidv7());
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const response = await device.as(cashier)[method](path).send({});
      expect([response.status, response.body.code], `${route.method} ${route.path}`).toEqual([
        403,
        'FORBIDDEN',
      ]);
    }
  });

  it("answers NOT_FOUND for another tenant's branch, member and PC", async () => {
    const mine = await api.ownerOnDevice();
    const theirs = await api.ownerOnDevice();
    const as = mine.device.as(mine.owner);
    for (const path of [
      `/api/branches/${theirs.branchIds[0]}`,
      `/api/staff/${theirs.ownerMembershipId}`,
      `/api/devices/${theirs.device.deviceId}`,
    ]) {
      expect((await as.get(path)).body.code, path).toBe('NOT_FOUND');
    }
  });

  it('refuses console routes to staff sessions', async () => {
    const { device, owner } = await api.ownerOnDevice();
    const routes = listRoutes(app).filter((route) => route.access?.kind === 'console');
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, uuidv7());
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const response = await device.as(owner)[method](path).send({});
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it('lets the owner read and change the restaurant (S01 routes with a session)', async () => {
    const { device, owner, branchIds } = await api.ownerOnDevice();
    await device.as(owner).get('/api/tenant').expect(200);
    await device.as(owner).get('/api/branches').expect(200);
    const branch = await device.as(owner).get(`/api/branches/${branchIds[0]}`).expect(200);
    const secured = await device
      .as(owner)
      .patch(`/api/branches/${branchIds[0]}/security`)
      .send({ idleLockMinutes: 1, updatedAt: branch.body.branch.updatedAt })
      .expect(200);
    expect(secured.body.idleLockMinutes).toBe(1);
    const list = await (await device.device()).get('/api/devices/current/members').expect(200);
    expect(list.body.list.branch.idleLockMinutes).toBe(1);
  });
});
