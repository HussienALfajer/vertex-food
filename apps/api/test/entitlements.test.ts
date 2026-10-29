import { Controller, Get, type INestApplication, Module, SerializeOptions } from '@nestjs/common';
import {
  DomainError,
  type FeatureKey,
  healthCheckSchema,
  removalTakesEffectAt,
  startOfBusinessDate,
} from '@vertex-food/contracts';
import {
  auditEntries,
  branchEntitlements,
  createDatabase,
  entitlementExceptions,
  entitlementOverrides,
  entitlementStates,
  platformAuditEntries,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { commandRegistry, createCommandRegistry, defineCommand } from '@vertex-food/sync';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { z } from 'zod';
import { RequiresFeature, StaffRoute } from '../src/core/access/access.decorators.js';
import { declarationViolations, listRoutes, type Route } from '../src/core/routes.js';
import { EntitlementsService } from '../src/modules/platform/entitlements/index.js';
import {
  COMMAND_EXECUTORS,
  COMMAND_REGISTRY,
  commandExecutors,
  defineExecutor,
} from '../src/modules/platform/sync/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import { FINANCE, giveAgreement } from './commercial.js';
import { asConsoleUser, consoleUser, reauthenticate } from './console.js';
import { newDeviceKeys, newPhone, OPERATOR, PASSWORD, pinFor, TestApi } from './staff.js';
import { signedCommand, upload, uploaded } from './sync.js';

// Spec S05's entitlements over the API: the limits counted under the state's lock (only one of
// two concurrent additions passes at a limit), @RequiresFeature in the access guard, writes
// refused while suspended, overrides with their removal push, the console's reads, and a command
// executed with its feature off recorded once as an exception. A test command and a test route
// join the application for this file only.

@Controller('probe-entitlements')
class ProbeController {
  @Get('analytics')
  @StaffRoute()
  @RequiresFeature('analytics')
  @SerializeOptions({ schema: healthCheckSchema })
  analytics() {
    return { status: 'ok', database: 'ok' };
  }

  @Get('kitchen')
  @StaffRoute()
  @RequiresFeature('kitchen_display')
  @SerializeOptions({ schema: healthCheckSchema })
  kitchen() {
    return { status: 'ok', database: 'ok' };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const kitchenCommand = defineCommand({
  name: 'test.kitchen_bump',
  version: 1,
  payload: z.object({}),
  resolved: z.object({}),
  access: { actor: 'member', permission: 'hub.manage', station: false },
  feature: 'kitchen_display',
  resolve: () => ({}),
  describe: () => ({ key: 'commands.test.kitchen_bump', params: {} }),
});

let app: INestApplication;
let api: TestApi;
let entitlements: EntitlementsService;
const db = createDatabase(inject('databaseUrl'));
const HOUR = 3_600_000;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp({
    imports: [ProbeModule],
    overrides: [
      {
        token: COMMAND_REGISTRY,
        value: createCommandRegistry([...commandRegistry.definitions(), kitchenCommand]),
      },
      {
        token: COMMAND_EXECUTORS,
        value: [
          ...commandExecutors,
          defineExecutor(kitchenCommand, async () => ({ outcome: 'accepted' })),
        ],
      },
    ],
  });
  api = new TestApi(app, db);
  entitlements = app.get(EntitlementsService);
});
afterAll(async () => {
  vi.useRealTimers();
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

/** Makes the tenant's state due, as time passing its next boundary would (rule 17). */
async function makeDue(tenantId: string) {
  await db
    .update(entitlementStates)
    .set({ validUntil: new Date(Date.now() - HOUR) })
    .where(eq(entitlementStates.subjectTenantId, tenantId));
}

/**
 * An override in force since an hour ago, written as a past one would be (the API pushes a
 * removal to the business day's end); the state recomputes on its next read.
 */
async function overrideSince(
  tenantId: string,
  override:
    | { kind: 'grant' | 'deny'; featureKey: string; expiresAt?: Date }
    | { kind: 'limit'; limitKey: string; value: number },
) {
  await db.insert(entitlementOverrides).values({
    subjectTenantId: tenantId,
    reason: 'Synthetic override',
    startsAt: new Date(Date.now() - 2 * HOUR),
    expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    createdByOperator: 'finance1',
    ...override,
  });
  await makeDue(tenantId);
}

describe('limits (rule 21)', () => {
  it('refuses a PC past the devices limit with the limit, value and usage', async () => {
    const setup = await api.ownerOnDevice();
    await overrideSince(setup.tenantId, { kind: 'limit', limitKey: 'devices', value: 1 });
    const { ticket } = await api.signInWithOtp(setup.ownerPhone);
    const refused = await api.http().post('/api/devices').set('x-sign-in-ticket', ticket).send({
      tenantId: setup.tenantId,
      branchId: setup.branchIds[0],
      name: 'الكاشير 2',
      publicKey: newDeviceKeys().publicKey,
      os: 'Windows 11',
      appVersion: '0.1.0',
    });
    expect([refused.status, refused.body]).toEqual([
      409,
      {
        code: 'ENTITLEMENT_LIMIT_REACHED',
        message: expect.any(String),
        details: { limit: 'devices', value: 1, usage: 1 },
      },
    ]);
  });

  it('lets one of two concurrent member additions pass at the staff limit, and refuses a reactivation', async () => {
    const setup = await api.ownerOnDevice();
    const member = await setup.device.addMember(setup.owner, {
      displayName: 'كاشير',
      roles: ['cashier'],
      branchScope: { allBranches: true },
    });
    await setup.device
      .as(setup.owner)
      .post(`/api/staff/${member.id}/deactivate`)
      .send({ reason: 'left' })
      .expect(200);
    await overrideSince(setup.tenantId, { kind: 'limit', limitKey: 'staff', value: 2 });
    const add = () =>
      setup.device
        .as(setup.owner)
        .post('/api/staff')
        .send({
          phone: newPhone(),
          displayName: 'كاشير',
          roles: ['cashier'],
          branchScope: { allBranches: true },
          grantedPermissions: [],
          revokedPermissions: [],
        });
    const responses = await Promise.all([add(), add()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe(
      'ENTITLEMENT_LIMIT_REACHED',
    );
    const reactivated = await setup.device
      .as(setup.owner)
      .post(`/api/staff/${member.id}/reactivate`)
      .send({});
    expect([reactivated.status, reactivated.body.code]).toEqual([409, 'ENTITLEMENT_LIMIT_REACHED']);
  });

  it('lets one of two concurrent branches pass, each new branch with its copy', async () => {
    const { tenantId } = await api.newTenant();
    await overrideSince(tenantId, { kind: 'limit', limitKey: 'branches', value: 2 });
    const tenancy = app.get(TenancyService);
    const create = (code: string) =>
      tenancy.createBranch(OPERATOR, tenantId, { code, nameAr: `فرع ${code}` });
    const outcomes = await Promise.allSettled([create('east'), create('west')]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(((refused as PromiseRejectedResult).reason as DomainError).code).toBe(
      'ENTITLEMENT_LIMIT_REACHED',
    );
    const [state] = await db
      .select()
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, tenantId));
    const copies = await withTenant(db, tenantId, (tx) => tx.select().from(branchEntitlements));
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy).toMatchObject({ version: state?.version, limits: { branches: 2 } });
    }
  });
});

describe('@RequiresFeature (rule 20)', () => {
  it('answers NOT_ENTITLED before the handler: off, dependency missing, denied, expired', async () => {
    const setup = await api.ownerOnDevice();
    const as = setup.device.as(setup.owner);
    const refused = await as.get('/api/probe-entitlements/analytics');
    expect([refused.status, refused.body.code, refused.body.details]).toEqual([
      403,
      'NOT_ENTITLED',
      { feature: 'analytics' },
    ]);

    // kitchen_display without pos: off, `dependency_missing`.
    await overrideSince(setup.tenantId, { kind: 'grant', featureKey: 'kitchen_display' });
    const missing = await as.get('/api/probe-entitlements/kitchen');
    expect([missing.status, missing.body.code]).toEqual([403, 'NOT_ENTITLED']);
    const resolved = await entitlements.forConsole(setup.tenantId);
    expect(resolved.features.find((feature) => feature.key === 'kitchen_display')).toMatchObject({
      on: false,
      source: 'override',
      reason: 'dependency_missing',
    });
    await giveAgreement(app, setup.tenantId, ['pos']);
    await as.get('/api/probe-entitlements/kitchen').expect(200);

    // A grant through the console's service opens a feature at once.
    const granted = await entitlements.createOverride(FINANCE, setup.tenantId, {
      kind: 'grant',
      featureKey: 'analytics',
      reason: 'Thirty-day trial',
      expiresAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString().slice(0, 10),
    });
    expect(granted.expiresAt).not.toBeNull();
    await as.get('/api/probe-entitlements/analytics').expect(200);

    // A deny in force wins over the agreement and a grant.
    await overrideSince(setup.tenantId, { kind: 'deny', featureKey: 'pos' });
    expect((await as.get('/api/probe-entitlements/kitchen')).body.code).toBe('NOT_ENTITLED');

    // An expired grant opens nothing.
    const other = await api.ownerOnDevice();
    await giveAgreement(app, other.tenantId, ['pos']);
    await overrideSince(other.tenantId, {
      kind: 'grant',
      featureKey: 'analytics',
      expiresAt: new Date(Date.now() - HOUR),
    });
    const expired = await other.device.as(other.owner).get('/api/probe-entitlements/analytics');
    expect([expired.status, expired.body.code]).toEqual([403, 'NOT_ENTITLED']);
  });
});

async function reauthenticateOwner(setup: Awaited<ReturnType<TestApi['ownerOnDevice']>>) {
  await setup.device
    .as(setup.owner)
    .post('/api/sessions/current/reauth')
    .send({ password: PASSWORD })
    .expect(204);
}

describe('a suspended tenant (rule 22)', () => {
  it('refuses staff writes but the exempt ones, and still reads', async () => {
    const setup = await api.ownerOnDevice();
    await db
      .update(tenants)
      .set({
        status: 'suspended',
        statusReason: 'non_payment',
        onboardingCompletedAt: new Date(),
        activatedAt: new Date(),
      })
      .where(eq(tenants.id, setup.tenantId));
    const as = setup.device.as(setup.owner);
    const tenant = await as.get('/api/tenant').expect(200);
    const write = await as
      .patch('/api/tenant')
      .send({ nameAr: 'اسم آخر', updatedAt: tenant.body.updatedAt });
    expect([write.status, write.body.code]).toEqual([403, 'TENANT_SUSPENDED']);
    await reauthenticateOwner(setup);
    await as
      .put('/api/me/pin')
      .send({ newPin: pinFor(5) })
      .expect(204);
  });

  it('marks only staff writes exempt, the ones S02 rule 36, S05 rule 22 and S06 name', () => {
    const exempt = listRoutes(app)
      .filter((route) => route.suspendedAllowed)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(exempt).toEqual([
      'POST /api/devices/:id/revoke',
      'POST /api/maps/resolve-link',
      'POST /api/me/personal-devices/:id/revoke',
      'POST /api/sessions/current/end',
      'POST /api/sessions/current/reauth',
      'POST /api/staff/:id/deactivate',
      'POST /api/tenant/data-exports',
      'POST /api/tenant/data-exports/:id/link',
      'PUT /api/me/password',
      'PUT /api/me/pin',
      'PUT /api/staff/:id/pin',
    ]);
  });
});

describe('route declarations (rules 20, 22)', () => {
  it('declare no feature on console or public routes, checked at start', () => {
    expect(declarationViolations(listRoutes(app))).toEqual([]);
    const route = (overrides: Partial<Route>): Route => ({
      name: 'Probe.route',
      method: 'GET',
      status: 200,
      path: '/api/probe',
      access: { kind: 'public' },
      entitlement: { kind: 'none' },
      suspendedAllowed: false,
      responseSchema: undefined,
      rawResponse: false,
      request: { body: undefined, query: undefined, params: [], file: false },
      ...overrides,
    });
    expect(
      declarationViolations([
        route({ name: 'Probe.public', entitlement: { kind: 'feature', feature: 'pos' } }),
        route({
          name: 'Probe.console',
          access: { kind: 'console', permissions: [], options: {} },
          entitlement: { kind: 'feature', feature: 'pos' },
        }),
        route({
          name: 'Probe.read',
          access: { kind: 'staff', permissions: [], options: {} },
          suspendedAllowed: true,
        }),
      ]),
    ).toEqual([
      'Probe.public: only staff and device routes can require a feature',
      'Probe.console: only staff and device routes can require a feature',
      'Probe.read: @SuspendedAllowed() marks staff writes only',
    ]);
  });
});

describe('overrides (rules 12–14)', () => {
  it('push removals to the business day end, refuse overlaps, revoke once, audited', async () => {
    const { tenantId } = await api.newTenant();
    await giveAgreement(app, tenantId, ['pos']);
    const expiry = new Date(Date.now() + 10 * 24 * HOUR).toISOString().slice(0, 10);
    const grant = await entitlements.createOverride(FINANCE, tenantId, {
      kind: 'grant',
      featureKey: 'analytics',
      reason: 'Trial',
      expiresAt: expiry,
    });
    const startsAt = new Date(grant.startsAt);
    expect(grant.expiresAt).toBe(
      removalTakesEffectAt(startOfBusinessDate(expiry), ['04:00']).toISOString(),
    );
    expect(
      await codeOf(
        entitlements.createOverride(FINANCE, tenantId, {
          kind: 'grant',
          featureKey: 'analytics',
          reason: 'Again',
          expiresAt: expiry,
        }),
      ),
    ).toBe('OVERRIDE_OVERLAP');
    expect(
      await codeOf(
        entitlements.createOverride(FINANCE, tenantId, {
          kind: 'grant',
          featureKey: 'loyalty',
          reason: 'No expiry',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    const deny = await entitlements.createOverride(FINANCE, tenantId, {
      kind: 'deny',
      featureKey: 'pos',
      reason: 'Abuse',
      expiresAt: expiry,
    });
    expect(deny.startsAt).toBe(
      removalTakesEffectAt(new Date(deny.createdAt), ['04:00']).toISOString(),
    );

    const revocation = await entitlements.revokeOverride(FINANCE, grant.id, 'Trial cancelled');
    expect(revocation.revokedAt).toBe(
      removalTakesEffectAt(new Date(revocation.createdAt), ['04:00']).toISOString(),
    );
    expect(new Date(revocation.revokedAt).getTime()).toBeGreaterThan(startsAt.getTime());
    expect(await codeOf(entitlements.revokeOverride(FINANCE, grant.id, 'Again'))).toBe(
      'ALREADY_REVOKED',
    );
    const resolved = await entitlements.forConsole(tenantId);
    expect(resolved.features.find((feature) => feature.key === 'analytics')).toMatchObject({
      on: true,
      source: 'override',
      until: revocation.revokedAt,
    });

    const platform = await db
      .select({ action: platformAuditEntries.action, tenant: platformAuditEntries.subjectTenantId })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, grant.id));
    expect(platform.map((entry) => entry.action).sort()).toEqual([
      'entitlement_override.created',
      'entitlement_override.revoked',
    ]);
    expect(platform.every((entry) => entry.tenant === tenantId)).toBe(true);
    const tenantEntries = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ action: auditEntries.action })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'entitlements.overridden')),
    );
    expect(tenantEntries).toHaveLength(3);
  });

  it('need the override permission and a TOTP re-entry over HTTP; reads need agreements.read', async () => {
    const { tenantId } = await api.newTenant();
    const finance = await consoleUser(app, 'finance');
    const dispatch = await consoleUser(app, 'dispatch');
    const sales = await consoleUser(app, 'sales');
    const body = {
      kind: 'grant',
      featureKey: 'analytics',
      reason: 'Trial',
      expiresAt: new Date(Date.now() + 10 * 24 * HOUR).toISOString().slice(0, 10),
    };
    const noPermission = await asConsoleUser(app, sales)
      .post(`/api/console/tenants/${tenantId}/entitlement-overrides`)
      .send(body);
    expect([noPermission.status, noPermission.body.code]).toEqual([403, 'FORBIDDEN']);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const stale = await asConsoleUser(app, finance)
      .post(`/api/console/tenants/${tenantId}/entitlement-overrides`)
      .send(body);
    expect([stale.status, stale.body.code]).toEqual([403, 'REAUTH_REQUIRED']);
    await reauthenticate(app, finance);
    const created = await asConsoleUser(app, finance)
      .post(`/api/console/tenants/${tenantId}/entitlement-overrides`)
      .send(body)
      .expect(201);
    expect(created.body).toMatchObject({ kind: 'grant', createdBy: finance.userId });
    await asConsoleUser(app, finance)
      .post(`/api/console/entitlement-overrides/${created.body.id}/revoke`)
      .send({ reason: 'Ended' })
      .expect(200);

    const read = await asConsoleUser(app, sales)
      .get(
        `/api/console/tenants/${tenantId}/entitlements?at=${new Date(Date.now() + 365 * 24 * HOUR).toISOString()}`,
      )
      .expect(200);
    expect(read.body.features.find((f: { key: string }) => f.key === 'analytics').on).toBe(false);
    const refused = await asConsoleUser(app, dispatch).get(
      `/api/console/tenants/${tenantId}/entitlements`,
    );
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const missing = await asConsoleUser(app, sales).get(
      `/api/console/tenants/${uuidv7()}/entitlements`,
    );
    expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('commands of a feature that is off (rules 23, 25)', () => {
  it('are executed, with one exception each, and none once the feature is on', async () => {
    const setup = await api.ownerOnDevice();
    const command = () =>
      signedCommand(setup.device, {
        name: 'test.kitchen_bump',
        membershipId: setup.ownerMembershipId,
        payload: {},
        resolved: {},
      });
    const off = command();
    const response = await upload(setup.device, [uploaded(off)], 200);
    expect(response.body.results[0]).toMatchObject({ outcome: 'accepted', replay: false });
    const again = await upload(setup.device, [uploaded(off)], 200);
    expect(again.body.results[0]).toMatchObject({ outcome: 'accepted', replay: true });
    const exceptions = () =>
      db
        .select()
        .from(entitlementExceptions)
        .where(eq(entitlementExceptions.subjectTenantId, setup.tenantId));
    expect(await exceptions()).toEqual([
      expect.objectContaining({
        commandId: off.id,
        featureKey: 'kitchen_display',
        branchId: setup.branchIds[0],
        deviceId: setup.device.deviceId,
      }),
    ]);

    await giveAgreement(app, setup.tenantId, ['pos', 'kitchen_display']);
    await upload(setup.device, [uploaded(command())], 200);
    expect(await exceptions()).toHaveLength(1);

    const page = await entitlements.exceptions(setup.tenantId, undefined);
    expect(page).toMatchObject({ items: [{ commandId: off.id }], nextBefore: null });
  });

  it('name a feature of the catalog, checked when the API starts', async () => {
    const unknown = defineCommand({
      ...kitchenCommand,
      name: 'test.unknown_feature',
      feature: 'teleport' as FeatureKey,
    });
    await expect(
      createTestApp({
        overrides: [
          {
            token: COMMAND_REGISTRY,
            value: createCommandRegistry([...commandRegistry.definitions(), unknown]),
          },
          {
            token: COMMAND_EXECUTORS,
            value: [
              ...commandExecutors,
              defineExecutor(unknown, async () => ({ outcome: 'accepted' })),
            ],
          },
        ],
      }),
    ).rejects.toThrow('names unknown teleport');
  });
});
