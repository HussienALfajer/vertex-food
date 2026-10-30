import type { INestApplication } from '@nestjs/common';
import { type AuditEntry, addDays, businessWallClock } from '@vertex-food/contracts';
import { auditEntries, createDatabase, platformAuditEntries, withTenant } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createTestApp } from './app.js';
import { giveAgreement } from './commercial.js';
import { asConsoleUser, consoleUser } from './console.js';
import { client, OPERATOR, pinFor, TestApi } from './staff.js';

// Spec S06's audit logs over the API: the writers' branch (rule 20), the restaurant's log for its
// owner (rules 2–5: filters, cursor, Vertex never named, offline mark, names), and the platform's
// for Vertex admins (rule 18). Both routes only read: no entry is written by reading.

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

const today = () => businessWallClock(new Date()).date;

type Setup = Awaited<ReturnType<TestApi['ownerOnDevice']>>;

/** Entries written straight into the tenant's log, as other specs' writers would. */
async function insertEntries(
  tenantId: string,
  entries: Partial<typeof auditEntries.$inferInsert>[],
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.insert(auditEntries).values(
      entries.map((entry) => ({
        tenantId,
        actorKind: 'system',
        actorName: 'tenancy/apply-scheduled-status',
        action: 'tenant.onboarding_completed',
        entityType: 'tenant',
        entityId: tenantId,
        occurredAt: new Date(),
        ...entry,
      })),
    ),
  );
}

async function log(setup: Setup, query = '') {
  const response = await setup.device.as(setup.owner).get(`/api/tenant/audit${query}`).expect(200);
  return response.body as { items: AuditEntry[]; nextCursor: string | null };
}

describe('the branch of an entry (rule 20)', () => {
  it("records the branch of a branch's change, a device and a one-branch member; none tenant-wide", async () => {
    const setup = await api.ownerOnDevice(['main', 'second']);
    const [first, second] = setup.branchIds as [string, string];
    const branch = await setup.device.as(setup.owner).get(`/api/branches/${first}`).expect(200);
    await setup.device
      .as(setup.owner)
      .patch(`/api/branches/${first}/security`)
      .send({ idleLockMinutes: 3, updatedAt: branch.body.branch.updatedAt })
      .expect(200);
    const tenant = await setup.device.as(setup.owner).get('/api/tenant').expect(200);
    await setup.device
      .as(setup.owner)
      .patch('/api/tenant')
      .send({
        nameAr: 'مطعم معدّل',
        nameLatin: null,
        defaultCurrency: 'USD',
        updatedAt: tenant.body.updatedAt,
      })
      .expect(200);
    const one = await setup.device.addMember(setup.owner, {
      displayName: 'كاشير',
      roles: ['cashier'],
      branchScope: { allBranches: false, branchIds: [second] },
    });
    const two = await setup.device.addMember(setup.owner, {
      displayName: 'مدير',
      roles: ['manager'],
      branchScope: { allBranches: false, branchIds: [first, second] },
    });
    const rows = await withTenant(db, setup.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.tenantId, setup.tenantId)),
    );
    const branchOf = (action: string, entityId?: string) =>
      rows.find((row) => row.action === action && (!entityId || row.entityId === entityId))
        ?.branchId;
    expect(branchOf('branch.security_updated')).toBe(first);
    expect(branchOf('device.registered')).toBe(first);
    expect(branchOf('tenant.profile_updated')).toBeNull();
    expect(branchOf('staff.added', one.id)).toBe(second);
    expect(branchOf('staff.added', two.id)).toBeNull();
  });
});

describe("the restaurant's audit log (rules 2–5)", () => {
  it('lists the tenant’s entries newest first, with names, and only to the owner', async () => {
    const setup = await api.ownerOnDevice();
    const branchId = setup.branchIds[0] as string;
    const manager = await setup.device.addMember(
      setup.owner,
      {
        displayName: 'مدير الفرع',
        roles: ['manager'],
        branchScope: { allBranches: false, branchIds: [branchId] },
      },
      pinFor(3),
    );
    const page = await log(setup);
    const added = page.items.find((item) => item.action === 'staff.added' && item.entity.name);
    expect(added).toMatchObject({
      category: 'access',
      actor: { kind: 'staff', name: 'مالك تجريبي', roles: ['owner'] },
      entity: { type: 'staff_membership', id: manager.id, name: 'مدير الفرع' },
      branch: { id: branchId, name: 'فرع 1', archived: false },
      device: { id: setup.device.deviceId, name: 'الكاشير 1' },
      recordedOffline: false,
    });
    expect(added?.details.find((detail) => detail.field === 'branchScope')).toEqual({
      field: 'branchScope',
      change: false,
      value: { allBranches: false, branches: ['فرع 1'] },
    });
    const times = page.items.map((item) => item.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);

    // A manager, a missing session: refused.
    const session = await setup.device.signIn(manager.id, pinFor(3));
    const refused = await setup.device.as(session).get('/api/tenant/audit');
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const anonymous = await client(app).get('/api/tenant/audit');
    expect([anonymous.status, anonymous.body.code]).toEqual([401, 'UNAUTHENTICATED']);

    // Reading writes nothing (rule 19).
    const before = await withTenant(db, setup.tenantId, (tx) => tx.select().from(auditEntries));
    await log(setup);
    const after = await withTenant(db, setup.tenantId, (tx) => tx.select().from(auditEntries));
    expect(after.length).toBe(before.length);
  });

  it('never names a Vertex person, and shows jobs, PCs and offline entries as such (rules 3, 4)', async () => {
    const setup = await api.ownerOnDevice();
    // A CLI operator's agreement (S05) and a console user's entry.
    await giveAgreement(app, setup.tenantId);
    const platformUserId = uuidv7();
    const at = new Date();
    await insertEntries(setup.tenantId, [
      {
        actorKind: 'platform',
        actorId: platformUserId,
        actorName: null,
        action: 'entitlements.overridden',
        occurredAt: at,
      },
      { action: 'tenant.status_changed', occurredAt: at },
      {
        actorKind: 'system',
        actorName: 'device',
        deviceId: setup.device.deviceId,
        branchId: setup.branchIds[0],
        action: 'device.wiped',
        entityType: 'device',
        entityId: setup.device.deviceId,
        occurredAt: at,
      },
      {
        actorKind: 'staff',
        actorId: await api.accountId(setup.ownerPhone),
        actorName: null,
        deviceId: setup.device.deviceId,
        action: 'staff_pin.failed_offline',
        occurredAt: new Date(at.getTime() - 60_000),
        recordedOffline: true,
      },
    ]);
    const response = await setup.device.as(setup.owner).get('/api/tenant/audit').expect(200);
    const items = response.body.items as AuditEntry[];
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(platformUserId);
    expect(text).not.toContain('finance1');
    expect(text).not.toContain('sales1');
    expect(text).not.toContain(OPERATOR.name);
    const of = (action: string) => items.find((item) => item.action === action);
    expect(of('agreement.amended')?.actor).toEqual({
      kind: 'vertex',
      accountId: null,
      name: null,
      roles: [],
    });
    expect(of('entitlements.overridden')?.actor.kind).toBe('vertex');
    expect(of('tenant.status_changed')?.actor).toMatchObject({ kind: 'system', name: null });
    expect(of('device.wiped')?.actor).toMatchObject({ kind: 'device', name: 'الكاشير 1' });
    const offline = of('staff_pin.failed_offline');
    expect(offline).toMatchObject({ recordedOffline: true, actor: { kind: 'staff' } });
    expect(offline?.createdAt).not.toBe(offline?.occurredAt);
  });

  it('resolves the ids of shown details to names, and unknown ones to null (rule 5)', async () => {
    const setup = await api.ownerOnDevice();
    await insertEntries(setup.tenantId, [
      {
        actorKind: 'staff',
        actorId: await api.accountId(setup.ownerPhone),
        actorName: null,
        action: 'branch.hub_roles_changed',
        entityType: 'branch',
        entityId: setup.branchIds[0],
        branchId: setup.branchIds[0],
        details: {
          before: { hubDeviceId: uuidv7(), standbyDeviceId: null },
          after: { hubDeviceId: setup.device.deviceId, standbyDeviceId: null },
          ignored: 'not shown',
        },
      },
    ]);
    const { items } = await log(setup);
    const entry = items.find((item) => item.action === 'branch.hub_roles_changed');
    expect(entry?.entity.name).toBe('فرع 1');
    expect(entry?.details).toEqual([
      { field: 'hubDeviceId', change: true, before: null, after: 'الكاشير 1' },
      { field: 'standbyDeviceId', change: true, before: null, after: null },
    ]);
  });

  it('filters by category, branch, tenant-wide and member, and pages without repeats', async () => {
    const setup = await api.ownerOnDevice(['main', 'second']);
    const [first, second] = setup.branchIds as [string, string];
    const ownerAccount = await api.accountId(setup.ownerPhone);
    const base = Date.now() - 3_600_000;
    await insertEntries(
      setup.tenantId,
      Array.from({ length: 60 }, (_, index) => ({
        action: 'branch.updated',
        entityType: 'branch',
        entityId: index % 2 === 0 ? first : second,
        branchId: index % 2 === 0 ? first : second,
        actorKind: index % 3 === 0 ? 'staff' : 'system',
        actorId: index % 3 === 0 ? ownerAccount : null,
        actorName: index % 3 === 0 ? null : 'tenancy/apply-scheduled-status',
        // Two entries share each instant: the cursor orders them by id.
        occurredAt: new Date(base + Math.floor(index / 2) * 1000),
      })),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?branchId=${first}&category=settings${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
      const page = await log(setup, query);
      seen.push(...page.items.map((item) => item.id));
      for (const item of page.items) {
        expect(item.branch?.id).toBe(first);
        expect(item.category).toBe('settings');
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    // Thirty inserted for the first branch, plus its creation and the PC registered there.
    expect(seen.length).toBeGreaterThanOrEqual(30);
    expect(pages).toBe(1);

    const all = [];
    cursor = null;
    do {
      const page = await log(setup, cursor ? `?before=${encodeURIComponent(cursor)}` : '');
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all.length).toBeGreaterThan(50);
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);

    const wide = await log(setup, '?tenantWide=true');
    expect(wide.items.length).toBeGreaterThan(0);
    expect(wide.items.every((item) => item.branch === null)).toBe(true);
    const devices = await log(setup, '?category=devices&category=access');
    expect(devices.items.every((item) => ['devices', 'access'].includes(item.category))).toBe(true);
    const mine = await log(setup, `?actorAccountId=${ownerAccount}`);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((item) => item.actor.accountId === ownerAccount)).toBe(true);
  });

  it('reads whole Damascus days, at most 366 of them (rule 2)', async () => {
    const setup = await api.ownerOnDevice();
    const yesterday = addDays(today(), -1);
    await insertEntries(setup.tenantId, [
      { occurredAt: new Date(Date.now() - 2 * 86_400_000), reason: 'قديم' },
    ]);
    const old = await log(setup, `?from=${addDays(today(), -3)}&to=${yesterday}`);
    expect(old.items.map((item) => item.reason)).toContain('قديم');
    const recent = await log(setup, `?from=${today()}`);
    expect(recent.items.map((item) => item.reason)).not.toContain('قديم');
    const long = await setup.device
      .as(setup.owner)
      .get(`/api/tenant/audit?from=${addDays(today(), -366)}&to=${today()}`);
    expect([long.status, long.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const both = await setup.device
      .as(setup.owner)
      .get(`/api/tenant/audit?branchId=${setup.branchIds[0]}&tenantWide=true`);
    expect(both.body.code).toBe('VALIDATION_FAILED');
  });

  it("never shows another tenant's entries, whatever the query names", async () => {
    const a = await api.ownerOnDevice();
    const b = await api.ownerOnDevice();
    await insertEntries(b.tenantId, [{ reason: 'سر المطعم ب' }]);
    const bAccount = await api.accountId(b.ownerPhone);
    const page = await log(a, `?branchId=${b.branchIds[0]}`);
    expect(page.items).toEqual([]);
    const byMember = await log(a, `?actorAccountId=${bAccount}`);
    expect(byMember.items).toEqual([]);
    const all = await log(a);
    expect(JSON.stringify(all)).not.toContain('سر المطعم ب');
    expect(all.items.every((item) => item.device?.id !== b.device.deviceId)).toBe(true);
  });
});

describe('the platform audit log (rule 18)', () => {
  it('lists entries with their names to admins only, filtered', async () => {
    const admin = await consoleUser(app, 'admin');
    const support = await consoleUser(app, 'support');
    const setup = await api.ownerOnDevice();
    await giveAgreement(app, setup.tenantId);
    const entityId = uuidv7();
    await db.insert(platformAuditEntries).values({
      actorKind: 'platform',
      actorId: admin.userId,
      action: 'entitlement_override.created',
      entityType: 'entitlement_override',
      entityId,
      subjectTenantId: setup.tenantId,
      details: { kind: 'grant' },
      occurredAt: new Date(),
    });
    const response = await asConsoleUser(app, admin)
      .get(`/api/console/audit?subjectTenantId=${setup.tenantId}`)
      .expect(200);
    const items = response.body.items as {
      action: string;
      actor: { kind: string; id: string | null; name: string | null };
      subjectTenant: { id: string; slug: string; nameAr: string } | null;
      entityId: string | null;
    }[];
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item) => item.subjectTenant?.id === setup.tenantId)).toBe(true);
    const created = items.find((item) => item.entityId === entityId);
    expect(created).toMatchObject({
      actor: { kind: 'platform', id: admin.userId, name: admin.name },
      subjectTenant: { id: setup.tenantId, nameAr: 'مطعم تجريبي' },
    });
    // The CLI operators are named on the platform log (S05's four eyes).
    const approved = items.find((item) => item.action === 'amendment.approved');
    expect(approved?.actor).toEqual({ kind: 'system', id: null, name: 'finance1' });

    const byEntity = await asConsoleUser(app, admin)
      .get(`/api/console/audit?entityId=${entityId}`)
      .expect(200);
    expect(byEntity.body.items.map((item: { entityId: string }) => item.entityId)).toEqual([
      entityId,
    ]);
    const byUser = await asConsoleUser(app, admin)
      .get(`/api/console/audit?actorUserId=${admin.userId}&action=console.request`)
      .expect(200);
    expect(byUser.body.items.length).toBeGreaterThan(0);
    expect(
      byUser.body.items.every(
        (item: { action: string; actor: { id: string } }) =>
          item.action === 'console.request' && item.actor.id === admin.userId,
      ),
    ).toBe(true);
    const request = byUser.body.items[0] as { requestRoute: string | null };
    expect(request.requestRoute).toBe('GET /api/console/audit');

    const refused = await asConsoleUser(app, support).get('/api/console/audit');
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const anonymous = await client(app).get('/api/console/audit');
    expect([anonymous.status, anonymous.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    const long = await asConsoleUser(app, admin).get(
      `/api/console/audit?from=${addDays(today(), -400)}&to=${today()}`,
    );
    expect(long.body.code).toBe('VALIDATION_FAILED');
  });
});
