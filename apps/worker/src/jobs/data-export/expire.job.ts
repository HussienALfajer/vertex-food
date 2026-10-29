import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  auditEntries,
  type Database,
  dataExportChunks,
  dataExports,
  eq,
  lte,
  withTenant,
} from '@vertex-food/db';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/** Exports expired per run; the rest wait an hour. */
const BATCH = 100;

/**
 * Expires ready exports 7 days after they were built (spec S06 rule 14): deletes the file's chunks
 * and sets `expired`, with `data_export.expired`, in one transaction per export inside its tenant.
 * The row stays as the record of the export. It finds the due exports across tenants through the
 * jobs role's `jobs_expire` policy, which shows it ready exports only. Safe twice: it changes an
 * export only while it is still `ready` and due. Runs as the jobs role.
 */
@Injectable()
export class DataExportExpireJob implements ScheduledJob {
  readonly queue = 'data-export.expire';
  readonly cron = '0 * * * *';

  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  /** Expires what is due at `now`; answers how many exports expired. */
  async run(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: dataExports.id, tenantId: dataExports.tenantId })
      .from(dataExports)
      .where(and(eq(dataExports.status, 'ready'), lte(dataExports.expiresAt, now)))
      .orderBy(asc(dataExports.expiresAt))
      .limit(BATCH);
    let expired = 0;
    for (const { id, tenantId } of due) {
      const changed = await withTenant(this.db, tenantId, async (tx) => {
        const [row] = await tx
          .update(dataExports)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(dataExports.id, id),
              eq(dataExports.status, 'ready'),
              lte(dataExports.expiresAt, now),
            ),
          )
          .returning({ id: dataExports.id });
        if (!row) return false;
        await tx.delete(dataExportChunks).where(eq(dataExportChunks.exportId, id));
        await tx.insert(auditEntries).values({
          tenantId,
          actorKind: 'system',
          actorName: this.queue.replace('.', '/'),
          action: 'data_export.expired',
          entityType: 'data_export',
          entityId: id,
          details: {},
          occurredAt: now,
        });
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }
}
