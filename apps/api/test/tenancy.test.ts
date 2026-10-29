import type { INestApplication } from '@nestjs/common';
import {
  DomainError,
  nextBusinessDayEnd,
  type StaffPermission,
  staffPermissions,
} from '@vertex-food/contracts';
import {
  auditEntries,
  branchHourExceptions,
  branches as branchTable,
  createDatabase,
  outboxEvents,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { StaffActor, SystemActor } from '../src/core/access/actor.js';
import { toErrorResponse } from '../src/core/errors/error.filter.js';
import { listRoutes } from '../src/core/routes.js';
import { StaffService } from '../src/modules/platform/access/staff.service.js';
import { AreasService } from '../src/modules/platform/areas/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import { giveAgreement } from './commercial.js';
import { newPhone } from './staff.js';

// Spec S01 over the API: the rules exercised on the service the routes call, with staff actors as
// the session verifier builds them. Access over HTTP (sessions, 403, other tenants) is in
// `access.test.ts` (spec S02).

const AZAZ = '0199fd00-0000-7000-8000-00000000c001';
const OPERATOR: SystemActor = { kind: 'system', name: 'test operator' };

let app: INestApplication;
let tenancy: TenancyService;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  app = await createTestApp();
  tenancy = app.get(TenancyService);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

function staff(
  tenantId: string,
  permissions: readonly StaffPermission[] = staffPermissions,
  branchIds?: string[],
): StaffActor {
  return {
    kind: 'staff',
    tenantId,
    tenantStatus: 'active',
    accountId: uuidv7(),
    membershipId: uuidv7(),
    sessionId: uuidv7(),
    sessionKind: 'device',
    deviceId: null,
    branchId: null,
    roles: ['owner'],
    permissions: [...permissions],
    allBranches: branchIds === undefined,
    branchIds: branchIds ?? [],
    passwordVerifiedAt: null,
  };
}

let slugCount = 0;
async function newTenant(branchCodes = ['main']) {
  slugCount += 1;
  const detail = await tenancy.createTenant(OPERATOR, {
    nameAr: 'مطعم تجريبي',
    slug: `test-${Date.now().toString(36)}-${slugCount}`,
    defaultCurrency: 'USD',
    branches: branchCodes.map((code, index) => ({ nameAr: `فرع ${index + 1}`, code })),
    owner: { phone: newPhone(), displayName: 'مالك تجريبي' },
  });
  const owner = staff(detail.tenant.id);
  return { detail, tenantId: detail.tenant.id, owner, branchIds: detail.branches.map((b) => b.id) };
}

const weekly = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: '10:00',
  closesAt: '23:00',
}));

/** Fills every onboarding item of a branch, as the wizard would. */
async function completeBranch(owner: StaffActor, branchId: string) {
  const { branch } = await tenancy.getBranch(owner, branchId);
  const updated = await tenancy.updateBranch(owner, branchId, {
    cityId: AZAZ,
    addressDescription: 'قرب الساحة',
    location: { latitudeE7: 365_876_000, longitudeE7: 370_448_000 },
    contactPhones: [{ phone: '+963900000001', whatsapp: true }],
    updatedAt: branch.updatedAt,
  });
  return tenancy.replaceHours(owner, branchId, {
    businessDayEndsAt: '04:00',
    periods: [...weekly, { weekday: 7, opensAt: '13:00', closesAt: '01:00' }],
    updatedAt: updated.updatedAt,
  });
}

describe('routes', () => {
  it('refuse every non-public route without a session, device token or ticket', async () => {
    const routes = listRoutes(app).filter((route) => route.access?.kind !== 'public');
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, uuidv7());
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const response = await request(app.getHttpServer())[method](path).send({});
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
      expect(['UNAUTHENTICATED', 'TICKET_INVALID']).toContain(response.body.code);
    }
  });

  it('keep the health check public', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});

describe('creating a tenant', () => {
  it('starts onboarding with its slug and branches, audited, with events', async () => {
    const { detail, tenantId } = await newTenant(['main', 'east']);
    expect(detail.tenant).toMatchObject({ status: 'onboarding', branchCount: 2 });
    expect(detail.slugs).toEqual([expect.objectContaining({ isPrimary: true })]);
    expect(detail.branches.map((b) => b.code)).toEqual(['main', 'east']);
    expect(detail.branches[0]).toMatchObject({
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD'],
      businessDayEndsAt: '04:00',
      contactPhones: [],
    });
    const [actions, events] = await withTenant(db, tenantId, async (tx) => [
      await tx
        .select({ action: auditEntries.action, actorName: auditEntries.actorName })
        .from(auditEntries),
      await tx.select({ type: outboxEvents.type }).from(outboxEvents),
    ]);
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'tenant.created', actorName: 'test operator' },
        { action: 'branch.created', actorName: 'test operator' },
        // Spec S02 rule 3: the first owner, created with the tenant.
        { action: 'staff.added', actorName: 'test operator' },
      ]),
    );
    // Spec S05 rule 18: the first branch's copy of the entitlements makes the tenant's state.
    expect(events.map((e) => e.type).sort()).toEqual([
      'branch.created.v1',
      'branch.created.v1',
      'entitlements.changed.v1',
      'staff.member_added.v1',
      'tenant.created.v1',
    ]);
  });

  it('refuses a taken or reserved slug', async () => {
    const { detail } = await newTenant();
    const input = {
      nameAr: 'مطعم آخر',
      defaultCurrency: 'TRY' as const,
      branches: [{ nameAr: 'الرئيسي', code: 'main' }],
      owner: { phone: newPhone(), displayName: 'مالك' },
    };
    expect(
      await codeOf(tenancy.createTenant(OPERATOR, { ...input, slug: detail.tenant.slug })),
    ).toBe('SLUG_TAKEN');
    expect(await codeOf(tenancy.createTenant(OPERATOR, { ...input, slug: 'admin' }))).toBe(
      'SLUG_RESERVED',
    );
    expect(await codeOf(tenancy.createTenant(OPERATOR, { ...input, slug: 'a--b' }))).toBe(
      'SLUG_RESERVED',
    );
  });
});

describe('onboarding', () => {
  it('lists what is missing, completes once everything is set, and is idempotent', async () => {
    const { tenantId, owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    const before = await tenancy.getTenant(owner);
    expect(before.onboarding.missing.map((m) => m.item)).toEqual([
      'branch.city',
      'branch.address',
      'branch.location',
      'branch.phone',
      'branch.hours',
    ]);
    try {
      await tenancy.completeOnboarding(owner);
      expect.unreachable();
    } catch (error) {
      expect((error as DomainError).code).toBe('ONBOARDING_INCOMPLETE');
      expect((error as DomainError).details?.missing).toHaveLength(5);
    }
    expect(await codeOf(tenancy.changeStatus(OPERATOR, tenantId, { to: 'active' }))).toBe(
      'ONBOARDING_INCOMPLETE',
    );
    await completeBranch(owner, branchId);
    const done = await tenancy.completeOnboarding(owner);
    expect(done.onboarding).toEqual({ complete: true, missing: [] });
    expect(done.onboardingCompletedAt).not.toBeNull();
    expect((await tenancy.completeOnboarding(owner)).onboardingCompletedAt).toBe(
      done.onboardingCompletedAt,
    );
    // Spec S05 rule 9: activation needs an agreement in force.
    expect(await codeOf(tenancy.changeStatus(OPERATOR, tenantId, { to: 'active' }))).toBe(
      'AGREEMENT_NOT_IN_FORCE',
    );
    await giveAgreement(app, tenantId);
    const active = await tenancy.changeStatus(OPERATOR, tenantId, { to: 'active' });
    expect(active.tenant).toMatchObject({ status: 'active' });
    expect(active.tenant.activatedAt).not.toBeNull();
  });
});

describe('status lifecycle', () => {
  async function activeTenant() {
    const created = await newTenant();
    await completeBranch(created.owner, created.branchIds[0] ?? '');
    await tenancy.completeOnboarding(created.owner);
    await giveAgreement(app, created.tenantId);
    await tenancy.changeStatus(OPERATOR, created.tenantId, { to: 'active' });
    return created;
  }

  /** Moves a scheduled change into the past, as time passing would. */
  async function makeDue(tenantId: string) {
    await db
      .update(tenants)
      .set({ scheduledStatusAt: new Date(Date.now() - 1000) })
      .where(eq(tenants.id, tenantId));
  }

  it('schedules a suspension at the next business day end and enforces it once due', async () => {
    const { tenantId, owner } = await activeTenant();
    const requestedAt = new Date();
    const scheduled = await tenancy.changeStatus(OPERATOR, tenantId, {
      to: 'suspended',
      reason: 'non_payment',
      note: 'synthetic test note',
    });
    expect(scheduled.tenant.status).toBe('active');
    expect(scheduled.tenant.scheduledChange?.status).toBe('suspended');
    expect(Date.parse(scheduled.tenant.scheduledChange?.at ?? '')).toBe(
      nextBusinessDayEnd(requestedAt, ['04:00']).getTime(),
    );
    // A repeat of the same request is refused, so a double submit never applies twice.
    expect(
      await codeOf(tenancy.changeStatus(OPERATOR, tenantId, { to: 'suspended', reason: 'other' })),
    ).toBe('INVALID_STATUS_TRANSITION');
    // Until then the restaurant still writes.
    const before = await tenancy.getTenant(owner);
    await tenancy.updateTenant(owner, {
      nameAr: 'مطعم تجريبي 2',
      nameLatin: null,
      defaultCurrency: 'USD',
      updatedAt: before.updatedAt,
    });
    await makeDue(tenantId);
    // Enforced without the job having run (rule 7).
    const suspended = await tenancy.getTenant(owner);
    expect(suspended).toMatchObject({ status: 'suspended', statusReason: 'non_payment' });
    expect(
      await codeOf(
        tenancy.updateTenant(owner, {
          nameAr: 'مطعم',
          nameLatin: null,
          defaultCurrency: 'USD',
          updatedAt: suspended.updatedAt,
        }),
      ),
    ).toBe('TENANT_SUSPENDED');
    // Reactivation is immediate; the due change was written first, with its own audit entry.
    const reactivated = await tenancy.changeStatus(OPERATOR, tenantId, { to: 'active' });
    expect(reactivated.tenant).toMatchObject({ status: 'active', scheduledChange: null });
    const changes = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ actorName: auditEntries.actorName })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'tenant.status_changed')),
    );
    expect(changes.map((c) => c.actorName)).toEqual(
      expect.arrayContaining(['tenancy/apply-scheduled-status', 'test operator']),
    );
  });

  it('checks the status once its locks are held: a write that waited past a suspension is refused', async () => {
    const { tenantId, owner, branchIds } = await activeTenant();
    await tenancy.changeStatus(OPERATOR, tenantId, { to: 'suspended', reason: 'non_payment' });
    const { branch } = await tenancy.getBranch(owner, branchIds[0] ?? '');
    // A barrier: another transaction holds the tenant row, as a status change would, and moves the
    // suspension a moment ahead. The branch write starts while it holds the row.
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = withTenant(db, tenantId, async (tx) => {
      await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
      await tx
        .update(tenants)
        .set({ scheduledStatusAt: new Date(Date.now() + 300) })
        .where(eq(tenants.id, tenantId));
      holding();
      await released;
    });
    await held;
    const write = codeOf(
      tenancy.updateBranch(owner, branch.id, {
        addressDescription: 'شارع آخر',
        updatedAt: branch.updatedAt,
      }),
    );
    // The write waits for the row while the suspension's time passes, then is checked at its time.
    await new Promise((resolve) => setTimeout(resolve, 600));
    release();
    await holder;
    expect(await write).toBe('TENANT_SUSPENDED');
  });

  it('checks a staff write at its lock time too: adding a member past a suspension is refused (BE-03)', async () => {
    const { tenantId, owner } = await activeTenant();
    await tenancy.changeStatus(OPERATOR, tenantId, { to: 'suspended', reason: 'non_payment' });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = withTenant(db, tenantId, async (tx) => {
      await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
      await tx
        .update(tenants)
        .set({ scheduledStatusAt: new Date(Date.now() + 300) })
        .where(eq(tenants.id, tenantId));
      holding();
      await released;
    });
    await held;
    const write = codeOf(
      app.get(StaffService).add(owner, {
        phone: newPhone(),
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: true },
        grantedPermissions: [],
        revokedPermissions: [],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    release();
    await holder;
    expect(await write).toBe('TENANT_SUSPENDED');
  });

  it('moves a scheduled suspension when a business day end changes, audited (owner 2026-10-19)', async () => {
    const { tenantId, owner, branchIds } = await activeTenant();
    const branchId = branchIds[0] ?? '';
    await tenancy.changeStatus(OPERATOR, tenantId, { to: 'suspended', reason: 'non_payment' });
    const scheduledAt = (await tenancy.getTenant(owner)).scheduledChange?.at;
    const detail = await tenancy.getBranch(owner, branchId);
    // The same day end changes nothing.
    const same = await tenancy.replaceHours(owner, branchId, {
      businessDayEndsAt: '04:00',
      periods: detail.hours,
      updatedAt: detail.branch.updatedAt,
    });
    expect((await tenancy.getTenant(owner)).scheduledChange?.at).toBe(scheduledAt);
    const changedAt = new Date();
    await tenancy.replaceHours(owner, branchId, {
      businessDayEndsAt: '06:00',
      periods: detail.hours,
      updatedAt: same.updatedAt,
    });
    const moved = await tenancy.getTenant(owner);
    expect(moved.status).toBe('active');
    expect(moved.scheduledChange).toMatchObject({ status: 'suspended', reason: 'non_payment' });
    expect(Date.parse(moved.scheduledChange?.at ?? '')).toBe(
      nextBusinessDayEnd(changedAt, ['06:00']).getTime(),
    );
    const [entries, events] = await withTenant(db, tenantId, async (tx) => [
      await tx
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, 'tenant.status_rescheduled')),
      await tx
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.type, 'tenant.status_scheduled.v1')),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        entityId: tenantId,
        details: {
          status: 'suspended',
          from: scheduledAt,
          to: moved.scheduledChange?.at,
          branchId,
        },
      }),
    ]);
    expect(events).toHaveLength(2);
  });

  it('lists a tenant in the console under the status in force, before the job writes it', async () => {
    const { tenantId, detail } = await activeTenant();
    await tenancy.changeStatus(OPERATOR, tenantId, { to: 'suspended', reason: 'non_payment' });
    const list = (status: 'active' | 'suspended') =>
      tenancy.listTenants({ page: 1, pageSize: 50, order: 'asc', status, q: detail.tenant.slug });
    expect((await list('active')).items.map((t) => t.id)).toEqual([tenantId]);
    await makeDue(tenantId);
    const active = await list('active');
    expect(active).toMatchObject({ items: [], total: 0 });
    const suspended = await list('suspended');
    expect(suspended.total).toBe(1);
    expect(suspended.items).toEqual([
      expect.objectContaining({ id: tenantId, status: 'suspended', branchCount: 1 }),
    ]);
  });

  it('cancels a scheduled change, and refuses to cancel when none is scheduled', async () => {
    const { tenantId } = await activeTenant();
    expect(await codeOf(tenancy.changeStatus(OPERATOR, tenantId, { cancelScheduled: true }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    await tenancy.changeStatus(OPERATOR, tenantId, { to: 'closed', reason: 'other' });
    const cancelled = await tenancy.changeStatus(OPERATOR, tenantId, { cancelScheduled: true });
    expect(cancelled.tenant).toMatchObject({ status: 'active', scheduledChange: null });
  });

  it('closes an onboarding tenant at once; a closed tenant refuses writes and keeps 90 days of reading', async () => {
    const { tenantId, owner, branchIds } = await newTenant();
    const closed = await tenancy.changeStatus(OPERATOR, tenantId, {
      to: 'closed',
      reason: 'abuse',
    });
    expect(closed.tenant.status).toBe('closed');
    const view = await tenancy.getTenant(owner);
    expect(view.ownerReadUntil).not.toBeNull();
    expect(Date.parse(view.ownerReadUntil ?? '') - Date.parse(view.closedAt ?? '')).toBe(
      90 * 86_400_000,
    );
    const { branch } = await tenancy.getBranch(owner, branchIds[0] ?? '');
    expect(
      await codeOf(
        tenancy.updateBranch(owner, branch.id, {
          addressDescription: 'شارع',
          updatedAt: branch.updatedAt,
        }),
      ),
    ).toBe('TENANT_CLOSED');
    expect(await codeOf(tenancy.completeOnboarding(owner))).toBe('TENANT_CLOSED');
    expect(await codeOf(tenancy.setSlug(OPERATOR, tenantId, 'closed-slug'))).toBe('TENANT_CLOSED');
    expect(await codeOf(tenancy.changeStatus(OPERATOR, tenantId, { to: 'active' }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('slugs', () => {
  it('keeps every old slug as an alias of its tenant (edge case 15)', async () => {
    const { tenantId, detail } = await newTenant();
    const first = detail.tenant.slug;
    await tenancy.setSlug(OPERATOR, tenantId, `${first}-b`);
    const twice = await tenancy.setSlug(OPERATOR, tenantId, `${first}-c`);
    expect(twice.tenant.slug).toBe(`${first}-c`);
    expect(twice.slugs.map((s) => [s.slug, s.isPrimary])).toEqual([
      [first, false],
      [`${first}-b`, false],
      [`${first}-c`, true],
    ]);
    // An alias is never given to anyone, its own tenant included.
    expect(await codeOf(tenancy.setSlug(OPERATOR, tenantId, first))).toBe('SLUG_TAKEN');
    const other = await newTenant();
    expect(await codeOf(tenancy.setSlug(OPERATOR, other.tenantId, first))).toBe('SLUG_TAKEN');
  });
});

describe('branches', () => {
  it('refuse a stale updatedAt with CONFLICT (rule 16)', async () => {
    const { owner, branchIds } = await newTenant();
    const { branch } = await tenancy.getBranch(owner, branchIds[0] ?? '');
    await tenancy.updateBranch(owner, branch.id, {
      addressDescription: 'أول',
      updatedAt: branch.updatedAt,
    });
    expect(
      await codeOf(
        tenancy.updateBranch(owner, branch.id, {
          addressDescription: 'ثان',
          updatedAt: branch.updatedAt,
        }),
      ),
    ).toBe('CONFLICT');
  });

  it("answer another tenant's branch with NOT_FOUND", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const [other = ''] = b.branchIds;
    expect(await codeOf(tenancy.getBranch(a.owner, other))).toBe('NOT_FOUND');
    expect(
      await codeOf(
        tenancy.replaceHours(a.owner, other, {
          businessDayEndsAt: '04:00',
          periods: [],
          updatedAt: new Date().toISOString(),
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('hold each permission to its fields and branches', async () => {
    const { tenantId, owner, branchIds } = await newTenant(['main', 'east']);
    const [main = '', east = ''] = branchIds;
    const manager = staff(tenantId, ['tenant.view', 'branch.hours.edit'], [main]);
    const cashier = staff(tenantId, ['tenant.view']);
    const { branch } = await tenancy.getBranch(owner, main);
    // A manager edits the phones of their branch, not its address, charges or another branch.
    const phones = await tenancy.updateBranch(manager, main, {
      contactPhones: [{ phone: '+905000000001', whatsapp: false }],
      updatedAt: branch.updatedAt,
    });
    expect(phones.contactPhones).toEqual([{ phone: '+905000000001', whatsapp: false }]);
    expect(
      await codeOf(
        tenancy.updateBranch(manager, main, {
          addressDescription: 'شارع',
          updatedAt: phones.updatedAt,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(
        tenancy.replaceCharges(manager, main, { lines: [], updatedAt: phones.updatedAt }),
      ),
    ).toBe('FORBIDDEN');
    const eastBranch = (await tenancy.getBranch(owner, east)).branch;
    expect(
      await codeOf(
        tenancy.replaceHours(manager, east, {
          businessDayEndsAt: '04:00',
          periods: weekly,
          updatedAt: eastBranch.updatedAt,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(await codeOf(tenancy.getBranch(manager, east))).toBe('NOT_FOUND');
    expect((await tenancy.listBranches(manager)).map((b) => b.id)).toEqual([main]);
    // A cashier edits no hours and no profile.
    expect(
      await codeOf(
        tenancy.replaceHours(cashier, main, {
          businessDayEndsAt: '04:00',
          periods: weekly,
          updatedAt: phones.updatedAt,
        }),
      ),
    ).toBe('FORBIDDEN');
    const tenant = await tenancy.getTenant(cashier);
    expect(
      await codeOf(
        tenancy.updateTenant(cashier, {
          nameAr: 'مطعم',
          nameLatin: null,
          defaultCurrency: 'USD',
          updatedAt: tenant.updatedAt,
        }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('keep the default currency among the accepted ones and fixed once locked (rule 11)', async () => {
    const { owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    let { branch } = await tenancy.getBranch(owner, branchId);
    expect(
      await codeOf(
        tenancy.updateBranch(owner, branchId, {
          defaultCurrency: 'TRY',
          updatedAt: branch.updatedAt,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    branch = await tenancy.updateBranch(owner, branchId, {
      defaultCurrency: 'TRY',
      acceptedCurrencies: ['TRY', 'USD', 'SYP'],
      updatedAt: branch.updatedAt,
    });
    expect(branch).toMatchObject({
      defaultCurrency: 'TRY',
      acceptedCurrencies: ['TRY', 'USD', 'SYP'],
    });
    await withTenant(db, owner.tenantId, (tx) =>
      tx
        .update(branchTable)
        .set({ currencyLockedAt: new Date() })
        .where(eq(branchTable.id, branchId)),
    );
    branch = (await tenancy.getBranch(owner, branchId)).branch;
    expect(
      await codeOf(
        tenancy.updateBranch(owner, branchId, {
          defaultCurrency: 'USD',
          updatedAt: branch.updatedAt,
        }),
      ),
    ).toBe('BRANCH_CURRENCY_LOCKED');
    const accepted = await tenancy.updateBranch(owner, branchId, {
      acceptedCurrencies: ['TRY'],
      updatedAt: branch.updatedAt,
    });
    expect(accepted.acceptedCurrencies).toEqual(['TRY']);
  });

  it('are added and archived by Vertex staff, never the last one', async () => {
    const { tenantId, branchIds } = await newTenant();
    expect(
      await codeOf(tenancy.archiveBranch(OPERATOR, tenantId, branchIds[0] ?? '', undefined)),
    ).toBe('LAST_ACTIVE_BRANCH');
    expect(
      await codeOf(tenancy.createBranch(OPERATOR, tenantId, { nameAr: 'آخر', code: 'main' })),
    ).toBe('CONFLICT');
    const east = await tenancy.createBranch(OPERATOR, tenantId, { nameAr: 'الشرقي', code: 'east' });
    expect(east).toMatchObject({ defaultCurrency: 'USD', cityId: null });
    const archived = await tenancy.archiveBranch(OPERATOR, tenantId, east.id, 'synthetic');
    expect(archived.archivedAt).not.toBeNull();
    // Its code stays taken.
    expect(
      await codeOf(tenancy.createBranch(OPERATOR, tenantId, { nameAr: 'جديد', code: 'east' })),
    ).toBe('CONFLICT');
  });
});

describe('hours', () => {
  it('replaces the weekly set, audited with the old and new sets', async () => {
    const { owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    const hours = await completeBranch(owner, branchId);
    expect(hours.periods).toHaveLength(7);
    const detail = await tenancy.getBranch(owner, branchId);
    expect(detail.hours.at(-1)).toEqual({ weekday: 7, opensAt: '13:00', closesAt: '01:00' });
    expect(detail.branch.updatedAt).toBe(hours.updatedAt);
    const [entry] = await withTenant(db, owner.tenantId, (tx) =>
      tx
        .select({ details: auditEntries.details })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'branch_hours.replaced')),
    );
    expect(entry?.details).toMatchObject({
      before: { periods: [] },
      after: { businessDayEndsAt: '04:00', periods: expect.any(Array) },
    });
  });

  it('refuses periods that contain the business day end or overlap', async () => {
    const { owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    const { branch } = await tenancy.getBranch(owner, branchId);
    expect(
      await codeOf(
        tenancy.replaceHours(owner, branchId, {
          businessDayEndsAt: '04:00',
          periods: [{ weekday: 1, opensAt: '22:00', closesAt: '05:00' }],
          updatedAt: branch.updatedAt,
        }),
      ),
    ).toBe('INVALID_HOURS');
  });

  it('keeps one exception per date, never in the past', async () => {
    const { owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const exception = await tenancy.createHourException(owner, branchId, {
      date: future,
      closed: false,
      periods: [{ opensAt: '12:00', closesAt: '16:00' }],
      note: 'عيد',
    });
    expect(
      await codeOf(
        tenancy.createHourException(owner, branchId, { date: future, closed: true, periods: [] }),
      ),
    ).toBe('CONFLICT');
    expect(
      await codeOf(
        tenancy.createHourException(owner, branchId, {
          date: '2020-01-01',
          closed: true,
          periods: [],
        }),
      ),
    ).toBe('INVALID_HOURS');
    const changed = await tenancy.updateHourException(owner, branchId, exception.id, {
      closed: true,
      periods: [],
      note: null,
      updatedAt: exception.updatedAt,
    });
    expect(changed).toMatchObject({ closed: true, periods: [] });
    expect((await tenancy.getBranch(owner, branchId)).exceptions).toHaveLength(1);
    await tenancy.archiveHourException(owner, branchId, exception.id);
    expect((await tenancy.getBranch(owner, branchId)).exceptions).toEqual([]);
    // The date is free again.
    await tenancy.createHourException(owner, branchId, { date: future, closed: true, periods: [] });
  });

  describe('a later business day end (TIME-01, owner 2026-10-20)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * A branch ending its day at 04:00 with an exception on 19 October from 05:00 to 07:00, made
     * on the 19th; then the clock moves to `at` on the 20th.
     */
    async function withYesterdaysException(at: string) {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T12:00:00.000Z') });
      const { owner, branchIds } = await newTenant();
      const [branchId = ''] = branchIds;
      const hours = await completeBranch(owner, branchId);
      const exception = await tenancy.createHourException(owner, branchId, {
        date: '2026-10-19',
        closed: false,
        periods: [{ opensAt: '05:00', closesAt: '07:00' }],
      });
      vi.setSystemTime(new Date(at));
      const move = () =>
        tenancy.replaceHours(owner, branchId, {
          businessDayEndsAt: '06:00',
          periods: hours.periods,
          updatedAt: hours.updatedAt,
        });
      return { owner, branchId, exception, move };
    }

    it('refuses the move when it would make an earlier exception current and invalid', async () => {
      // 05:00 in Damascus: the 20th under the old end, still the 19th under the new one.
      const { owner, branchId, exception, move } = await withYesterdaysException(
        '2026-10-20T02:00:00.000Z',
      );
      const refused = await move().catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(DomainError);
      expect(refused).toMatchObject({
        code: 'INVALID_HOURS',
        details: { exceptionId: exception.id, date: '2026-10-19' },
      });
      // Nothing moved; the exception was not rewritten.
      const detail = await tenancy.getBranch(owner, branchId);
      expect(detail.branch.businessDayEndsAt).toBe('04:00');
      const [row] = await withTenant(db, owner.tenantId, (tx) =>
        tx.select().from(branchHourExceptions).where(eq(branchHourExceptions.id, exception.id)),
      );
      expect(row).toMatchObject({ periods: exception.periods, archivedAt: null });
    });

    it('moves the end once that business date is past under both ends', async () => {
      // 07:00 in Damascus: the 20th under either end, so the 19th's exception is history.
      const { owner, branchId, move } = await withYesterdaysException('2026-10-20T04:00:00.000Z');
      await move();
      const detail = await tenancy.getBranch(owner, branchId);
      expect(detail.branch.businessDayEndsAt).toBe('06:00');
    });
  });
});

describe('charge lines', () => {
  const line = (rateBp: number) => ({
    kind: 'service' as const,
    nameAr: 'خدمة',
    rateBp,
    mode: 'added' as const,
    salesChannels: ['dine_in' as const],
  });

  it('are edited in place, extra lines archived, positions from the list', async () => {
    const { owner, branchIds } = await newTenant();
    const [branchId = ''] = branchIds;
    const { branch } = await tenancy.getBranch(owner, branchId);
    const three = await tenancy.replaceCharges(owner, branchId, {
      lines: [line(1000), line(500), line(250)],
      updatedAt: branch.updatedAt,
    });
    expect(three.lines.map((c) => [c.position, c.rateBp])).toEqual([
      [1, 1000],
      [2, 500],
      [3, 250],
    ]);
    // The answer carries the branch's new version: the next write needs no read back (CONC-01).
    expect(three.updatedAt).not.toBe(branch.updatedAt);
    expect((await tenancy.getBranch(owner, branchId)).branch.updatedAt).toBe(three.updatedAt);
    const one = await tenancy.replaceCharges(owner, branchId, {
      lines: [line(1500)],
      updatedAt: three.updatedAt,
    });
    expect(one.lines).toEqual([
      expect.objectContaining({ id: three.lines[0]?.id, rateBp: 1500, position: 1 }),
    ]);
    expect((await tenancy.getBranch(owner, branchId)).charges).toHaveLength(1);
    // The stale branch updatedAt of the first write is refused.
    expect(
      await codeOf(
        tenancy.replaceCharges(owner, branchId, { lines: [], updatedAt: three.updatedAt }),
      ),
    ).toBe('CONFLICT');
  });
});

describe('images', () => {
  it('replaces the logo, archiving the previous file, and removes it', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 120, b: 60 } },
    })
      .png()
      .toBuffer();
    const { owner } = await newTenant();
    const first = await tenancy.replaceImage(owner, 'logo', png);
    const second = await tenancy.replaceImage(owner, 'logo', png);
    expect((await tenancy.getTenant(owner)).logoFileId).toBe(second.id);
    expect(second.id).not.toBe(first.id);
    await tenancy.removeImage(owner, 'logo');
    expect((await tenancy.getTenant(owner)).logoFileId).toBeNull();
    // Removing nothing is not an error.
    await tenancy.removeImage(owner, 'logo');
  });
});

describe('map links', () => {
  it('resolve a full link and stop at 20 per minute per tenant', async () => {
    const { owner } = await newTenant();
    const link = 'https://www.google.com/maps/@36.5876,37.0448,17z';
    for (let i = 0; i < 20; i++) {
      expect(await tenancy.resolveMapLink(owner, link)).toEqual({
        latitudeE7: 365_876_000,
        longitudeE7: 370_448_000,
      });
    }
    expect(await codeOf(tenancy.resolveMapLink(owner, link))).toBe('RATE_LIMITED');
    expect(await codeOf(tenancy.resolveMapLink(staff(uuidv7()), 'https://example.com/x'))).toBe(
      'MAP_LINK_UNRECOGNIZED',
    );
  });
});

describe('areas', () => {
  it('lists Aleppo with Azaz for the address pickers', async () => {
    const groups = await app.get(AreasService).listCities();
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nameLatin: 'Aleppo',
          cities: expect.arrayContaining([
            expect.objectContaining({ id: AZAZ, nameLatin: 'Azaz' }),
          ]),
        }),
      ]),
    );
  });
});

describe('the console list', () => {
  it('filters by status and finds a tenant by slug', async () => {
    const { detail } = await newTenant();
    const page = await tenancy.listTenants({
      page: 1,
      pageSize: 50,
      order: 'asc',
      status: 'onboarding',
      q: detail.tenant.slug,
    });
    expect(page.items.map((t) => t.id)).toEqual([detail.tenant.id]);
    expect(page.total).toBe(1);
    const none = await tenancy.listTenants({ page: 1, pageSize: 50, order: 'asc', q: '%' });
    // A typed % matches itself, not everything.
    expect(none.items).toEqual([]);
  });
});

describe('database deadlines', () => {
  it('ends a write waiting on a held row in time, retryable, with nothing written', async () => {
    const { tenantId, owner, branchIds } = await newTenant();
    const branchId = branchIds[0] ?? '';
    const { branch } = await tenancy.getBranch(owner, branchId);
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = withTenant(db, tenantId, async (tx) => {
      await tx.select().from(branchTable).where(eq(branchTable.id, branchId)).for('update');
      holding();
      await released;
    });
    await held;
    const started = Date.now();
    const error = await tenancy
      .updateBranch(owner, branchId, {
        addressDescription: 'شارع آخر',
        updatedAt: branch.updatedAt,
      })
      .catch((caught: unknown) => caught);
    const elapsed = Date.now() - started;
    release();
    await holder;

    expect(toErrorResponse(error)).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
    });
    expect(elapsed).toBeLessThan(7_000);
    const after = await tenancy.getBranch(owner, branchId);
    expect(after.branch.updatedAt).toBe(branch.updatedAt);
    const audited = await withTenant(db, tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'branch.updated')),
    );
    expect(audited).toEqual([]);
  }, 10_000);
});
