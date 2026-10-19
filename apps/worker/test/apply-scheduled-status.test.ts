import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  createDatabase,
  eq,
  inArray,
  outboxEvents,
  tenantSlugs,
  tenants,
  withTenant,
} from '@vertex-food/db';
import type { PgBoss } from 'pg-boss';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { BOSS } from '../src/core/queue/queue.module.js';
import { jobs } from '../src/jobs/index.js';
import { ApplyScheduledStatusJob } from '../src/jobs/tenancy/apply-scheduled-status.job.js';
import { startWorker } from './worker.js';

// tenancy/apply-scheduled-status (spec S01): applies due changes once; running it twice, or after
// the change was replaced, changes nothing. Synthetic tenants written as the app role.

const app = createDatabase(inject('appUrl'));
let worker: INestApplication;
let job: ApplyScheduledStatusJob;

beforeAll(async () => {
  worker = await startWorker(jobs);
  job = worker.get(ApplyScheduledStatusJob);
});
afterAll(async () => {
  await worker.close();
  await app.$client.end();
});

/** An active tenant with a suspension or closure scheduled at `at`. */
async function scheduled(status: 'suspended' | 'closed', at: Date) {
  const id = uuidv7();
  const now = new Date(Date.now() - 86_400_000);
  // One transaction: a tenant needs its primary slug by commit.
  await app.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id,
      nameAr: 'مطعم تجريبي',
      defaultCurrency: 'USD',
      status: 'active',
      onboardingCompletedAt: now,
      activatedAt: now,
      scheduledStatus: status,
      scheduledStatusReason: 'non_payment',
      scheduledStatusAt: at,
    });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `w-${id.slice(-12)}`, subjectTenantId: id, isPrimary: true });
  });
  return id;
}

const read = (id: string) =>
  app
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .then((rows) => rows[0]);

describe('tenancy/apply-scheduled-status', () => {
  it('is scheduled every minute in pg-boss', async () => {
    const boss = worker.get<PgBoss>(BOSS);
    const schedules = await boss.getSchedules();
    expect(schedules).toContainEqual(
      expect.objectContaining({ name: 'tenancy.apply-scheduled-status', cron: '* * * * *' }),
    );
  });

  it('applies due changes once, with the audit entry and the event', async () => {
    const past = new Date(Date.now() - 60_000);
    const suspended = await scheduled('suspended', past);
    const closed = await scheduled('closed', past);
    const later = await scheduled('suspended', new Date(Date.now() + 3_600_000));

    expect(await job.run()).toBeGreaterThanOrEqual(2);
    expect(await read(suspended)).toMatchObject({
      status: 'suspended',
      statusReason: 'non_payment',
      statusChangedAt: past,
      scheduledStatus: null,
      scheduledStatusAt: null,
      closedAt: null,
    });
    expect(await read(closed)).toMatchObject({
      status: 'closed',
      closedAt: past,
      archivedAt: past,
    });
    expect(await read(later)).toMatchObject({ status: 'active', scheduledStatus: 'suspended' });

    // A second run changes nothing and writes nothing more.
    await job.run();
    for (const id of [suspended, closed]) {
      const [entries, events] = await withTenant(app, id, async (tx) => [
        await tx.select().from(auditEntries).where(eq(auditEntries.entityId, id)),
        await tx
          .select()
          .from(outboxEvents)
          .where(inArray(outboxEvents.tenantId, [id])),
      ]);
      expect(entries).toEqual([
        expect.objectContaining({
          action: 'tenant.status_changed',
          actorKind: 'system',
          actorName: 'tenancy/apply-scheduled-status',
        }),
      ]);
      expect(events).toEqual([
        expect.objectContaining({
          type: 'tenant.status_changed.v1',
          payload: { tenantId: id, from: 'active', to: (await read(id))?.status },
        }),
      ]);
    }
  });

  it('leaves a tenant whose schedule changes while the run waits for its row', async () => {
    const past = new Date(Date.now() - 60_000);
    const id = await scheduled('suspended', past);
    // A barrier: the API's transaction holds the row and replaces the change (edge case 3) with
    // another reason at the same time; the run has read the old schedule and waits for the row.
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const api = app.transaction(async (tx) => {
      await tx.select().from(tenants).where(eq(tenants.id, id)).for('update');
      holding();
      await released;
      await tx.update(tenants).set({ scheduledStatusReason: 'abuse' }).where(eq(tenants.id, id));
    });
    await held;
    const run = job.run(new Date());
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await api;
    await run;
    expect(await read(id)).toMatchObject({
      status: 'active',
      scheduledStatus: 'suspended',
      scheduledStatusReason: 'abuse',
    });
    const entries = await withTenant(app, id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.entityId, id)),
    );
    expect(entries).toEqual([]);
  });

  it('applies a change once when two runs race for it', async () => {
    const id = await scheduled('closed', new Date(Date.now() - 60_000));
    const now = new Date();
    await Promise.all([job.run(now), job.run(now), job.run(now)]);
    expect(await read(id)).toMatchObject({ status: 'closed', scheduledStatus: null });
    const [entries, events] = await withTenant(app, id, async (tx) => [
      await tx.select().from(auditEntries).where(eq(auditEntries.entityId, id)),
      await tx.select().from(outboxEvents).where(eq(outboxEvents.tenantId, id)),
    ]);
    expect(entries).toHaveLength(1);
    expect(events).toHaveLength(1);
  });
});
