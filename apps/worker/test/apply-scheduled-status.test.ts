import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  createDatabase,
  eq,
  inArray,
  outboxEvents,
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
  await app.insert(tenants).values({
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

  it('leaves a tenant whose schedule changed after it was read', async () => {
    const past = new Date(Date.now() - 60_000);
    const id = await scheduled('suspended', past);
    // The API replaced the change (edge case 3) before this run.
    await app
      .update(tenants)
      .set({ scheduledStatus: 'closed', scheduledStatusAt: new Date(Date.now() + 3_600_000) })
      .where(eq(tenants.id, id));
    await job.run(new Date());
    expect(await read(id)).toMatchObject({ status: 'active', scheduledStatus: 'closed' });
  });
});
