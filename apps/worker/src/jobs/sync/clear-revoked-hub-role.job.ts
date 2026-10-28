import { Inject, Injectable } from '@nestjs/common';
import { eventCatalog } from '@vertex-food/contracts';
import {
  and,
  auditEntries,
  type Database,
  devices,
  eq,
  isNotNull,
  sql,
  withTenant,
} from '@vertex-food/db';
import type { Job } from 'pg-boss';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { OutboxJobData, QueueJob } from '../../core/queue/queue-job.js';

/**
 * Clears a revoked PC's hub role (spec S04 "Jobs, events and notifications", rule 42): the branch's
 * configured hub or standby is no longer that PC, so its partial unique index frees the role for
 * the owner to give another PC; the PC keeps the number blocks it holds, which are never reused.
 * Idempotent: it changes only a revoked PC that still holds a role, with its audit entry in the
 * same transaction. Runs as the jobs role, inside the event's tenant.
 */
@Injectable()
export class ClearRevokedHubRoleJob implements QueueJob {
  readonly queue = 'sync.clear-revoked-hub-role';
  readonly events = ['device.revoked.v1'];

  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  async work(jobs: Job<OutboxJobData>[]): Promise<void> {
    for (const job of jobs) {
      const event = eventCatalog['device.revoked.v1'].parse(job.data.payload);
      await withTenant(this.db, job.data.tenantId, async (tx) => {
        const [device] = await tx
          .select({ hubRole: devices.hubRole })
          .from(devices)
          .where(
            and(
              eq(devices.id, event.deviceId),
              eq(devices.status, 'revoked'),
              isNotNull(devices.hubRole),
            ),
          )
          .for('update');
        if (!device) return;
        const now = new Date();
        await tx
          .update(devices)
          .set({ hubRole: null, updatedAt: now })
          .where(and(eq(devices.id, event.deviceId), sql`${devices.hubRole} is not null`));
        await tx.insert(auditEntries).values({
          tenantId: job.data.tenantId,
          actorKind: 'system',
          actorName: 'sync/clear-revoked-hub-role',
          action: 'branch.hub_roles_changed',
          entityType: 'branch',
          entityId: event.branchId,
          details: {
            deviceId: event.deviceId,
            before: device.hubRole,
            after: null,
            reason: 'device_revoked',
          },
          occurredAt: now,
        });
      });
    }
  }
}
