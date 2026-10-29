import type { INestApplication } from '@nestjs/common';
import {
  featureCatalog,
  type ResolvedEntitlements,
  resolveEntitlements,
} from '@vertex-food/contracts';
import {
  branchEntitlements,
  branches,
  createDatabase,
  entitlementOverrides,
  entitlementStates,
  eq,
  outboxEvents,
  tenantSlugs,
  tenants,
  withTenant,
} from '@vertex-food/db';
import type { PgBoss } from 'pg-boss';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { BOSS } from '../src/core/queue/queue.module.js';
import { ApplyBoundariesJob } from '../src/jobs/entitlements/apply-boundaries.job.js';
import { jobs } from '../src/jobs/index.js';
import { startWorker } from './worker.js';

// entitlements/apply-boundaries (spec S05 rule 19): a due state is recomputed once, its version
// moves, its branches' copies and the event follow; a second run and a state not yet due change
// nothing. Synthetic tenants written as the app role, as the API would.

const app = createDatabase(inject('appUrl'));
let worker: INestApplication;
let job: ApplyBoundariesJob;

beforeAll(async () => {
  worker = await startWorker(jobs);
  job = worker.get(ApplyBoundariesJob);
});
afterAll(async () => {
  await worker.close();
  await app.$client.end();
});

const HOUR = 3_600_000;

/**
 * A tenant with a branch and a grant of `custom_fields` that ends at `expiresAt`, its state and
 * the branch's copy written an hour before, as the API leaves them.
 */
async function grantedUntil(expiresAt: Date) {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const computedAt = new Date(Date.now() - HOUR);
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `e-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
  });
  const [override] = await app
    .insert(entitlementOverrides)
    .values({
      subjectTenantId: tenantId,
      kind: 'grant',
      featureKey: 'custom_fields',
      reason: 'Synthetic trial',
      startsAt: new Date(computedAt.getTime() - HOUR),
      expiresAt,
      createdByOperator: 'finance1',
    })
    .returning();
  if (!override) throw new Error('No override');
  const resolved = resolveEntitlements(
    {
      catalog: featureCatalog,
      agreement: { terms: [], endings: [] },
      overrides: [{ ...override, kind: 'grant', revokedAt: null }],
    },
    computedAt,
  );
  await app.insert(entitlementStates).values({
    subjectTenantId: tenantId,
    version: 1,
    resolved,
    validUntil: expiresAt,
    computedAt,
  });
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(branches).values({
      id: branchId,
      tenantId,
      nameAr: 'الفرع الرئيسي',
      code: 'main',
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD'],
    });
    await tx.insert(branchEntitlements).values({
      tenantId,
      branchId,
      version: 1,
      features: [{ key: 'custom_fields', until: expiresAt.toISOString() }],
      limits: {},
      validUntil: expiresAt,
    });
  });
  return { tenantId, branchId };
}

async function read(tenantId: string) {
  const [state] = await app
    .select()
    .from(entitlementStates)
    .where(eq(entitlementStates.subjectTenantId, tenantId));
  const [copies, events] = await withTenant(app, tenantId, async (tx) => [
    await tx.select().from(branchEntitlements),
    await tx.select().from(outboxEvents).where(eq(outboxEvents.type, 'entitlements.changed.v1')),
  ]);
  return { state, copies, events };
}

describe('entitlements/apply-boundaries', () => {
  it('is scheduled every minute in pg-boss', async () => {
    const boss = worker.get<PgBoss>(BOSS);
    expect(await boss.getSchedules()).toContainEqual(
      expect.objectContaining({ name: 'entitlements.apply-boundaries', cron: '* * * * *' }),
    );
  });

  it('applies a due boundary once: version, branch copies and the event', async () => {
    const due = await grantedUntil(new Date(Date.now() - 60_000));
    const later = await grantedUntil(new Date(Date.now() + HOUR));
    expect(await job.run()).toBeGreaterThanOrEqual(1);

    const { state, copies, events } = await read(due.tenantId);
    expect(state).toMatchObject({ version: 2, validUntil: null });
    const resolved = state?.resolved as ResolvedEntitlements;
    expect(resolved.features.find((feature) => feature.key === 'custom_fields')).toMatchObject({
      on: false,
      source: 'default',
    });
    expect(copies).toEqual([
      expect.objectContaining({
        branchId: due.branchId,
        version: 2,
        features: [],
        validUntil: null,
      }),
    ]);
    expect(events.map((event) => event.payload)).toEqual([{ tenantId: due.tenantId, version: 2 }]);

    // Not yet due: untouched.
    const untouched = await read(later.tenantId);
    expect(untouched.state?.version).toBe(1);
    expect(untouched.copies[0]?.version).toBe(1);
    expect(untouched.events).toEqual([]);

    // A second run finds nothing due for this tenant.
    await job.run();
    const again = await read(due.tenantId);
    expect(again.state?.version).toBe(2);
    expect(again.state?.updatedAt).toEqual(state?.updatedAt);
    expect(again.events).toHaveLength(1);
  });
});
