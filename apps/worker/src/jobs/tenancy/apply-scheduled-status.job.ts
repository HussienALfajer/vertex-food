import { Inject, Injectable } from '@nestjs/common';
import { eventCatalog, type TenantStatus } from '@vertex-food/contracts';
import {
  and,
  asc,
  auditEntries,
  type Database,
  eq,
  isNotNull,
  lte,
  outboxEvents,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/** Tenants handled per run; the rest wait a minute. */
const BATCH = 100;

/**
 * Applies due scheduled suspensions and closures (spec S01, "Jobs"): sets the status from the
 * scheduled one, clears the schedule, sets `status_changed_at` to the scheduled time (and
 * `closed_at`, `archived_at` on closure), with the audit entry and the outbox event in the same
 * transaction. Enforcement never waits for it: every read goes through `effectiveStatus`. Safe
 * twice: it updates a tenant only while its row still holds the schedule it read, so a run after
 * another, or after the API applied or replaced the change, does nothing. Runs as the jobs role.
 */
@Injectable()
export class ApplyScheduledStatusJob implements ScheduledJob {
  readonly queue = 'tenancy.apply-scheduled-status';
  readonly cron = '* * * * *';

  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  /** Applies what is due at `now`; answers how many tenants changed. */
  async run(now = new Date()): Promise<number> {
    const due = await this.db
      .select({
        id: tenants.id,
        status: tenants.status,
        scheduledStatus: tenants.scheduledStatus,
        scheduledStatusReason: tenants.scheduledStatusReason,
        scheduledStatusAt: tenants.scheduledStatusAt,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)
      .where(and(isNotNull(tenants.scheduledStatus), lte(tenants.scheduledStatusAt, now)))
      .orderBy(asc(tenants.scheduledStatusAt))
      .limit(BATCH);
    let applied = 0;
    for (const tenant of due) {
      const { scheduledStatus, scheduledStatusReason, scheduledStatusAt } = tenant;
      if (!scheduledStatus || !scheduledStatusReason || !scheduledStatusAt) continue;
      const changed = await withTenant(this.db, tenant.id, async (tx) => {
        const closing = scheduledStatus === 'closed';
        const [row] = await tx
          .update(tenants)
          .set({
            status: scheduledStatus,
            statusReason: tenant.scheduledStatusReason,
            statusChangedAt: scheduledStatusAt,
            scheduledStatus: null,
            scheduledStatusReason: null,
            scheduledStatusAt: null,
            ...(closing ? { closedAt: scheduledStatusAt, archivedAt: scheduledStatusAt } : {}),
            // Moves the version forward, as every change does (spec S01 rule 16).
            updatedAt: new Date(Math.max(Date.now(), tenant.updatedAt.getTime() + 1)),
          })
          // Every status field it read: any change since (a replaced, moved or cancelled schedule,
          // a status written by the API or by another run) leaves the row alone. A run that waits
          // for another's row lock re-checks this once that one commits. Not `updated_at`: rows
          // keep its microseconds, which a JavaScript date cannot give back.
          .where(
            and(
              eq(tenants.id, tenant.id),
              eq(tenants.status, tenant.status),
              eq(tenants.scheduledStatus, scheduledStatus),
              eq(tenants.scheduledStatusReason, scheduledStatusReason),
              eq(tenants.scheduledStatusAt, scheduledStatusAt),
            ),
          )
          .returning({ id: tenants.id });
        if (!row) return false;
        await tx.insert(auditEntries).values({
          tenantId: tenant.id,
          actorKind: 'system',
          actorName: this.queue.replace('.', '/'),
          action: 'tenant.status_changed',
          entityType: 'tenant',
          entityId: tenant.id,
          details: {
            from: tenant.status,
            to: scheduledStatus,
            reason: tenant.scheduledStatusReason,
            scheduled: true,
          },
          occurredAt: now,
        });
        await tx.insert(outboxEvents).values({
          tenantId: tenant.id,
          type: 'tenant.status_changed.v1',
          payload: eventCatalog['tenant.status_changed.v1'].parse({
            tenantId: tenant.id,
            from: tenant.status as TenantStatus,
            to: scheduledStatus as TenantStatus,
          }),
        });
        return true;
      });
      if (changed) applied += 1;
    }
    return applied;
  }
}
