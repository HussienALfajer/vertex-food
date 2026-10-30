import type { Type } from '@nestjs/common';
import type { QueueJob } from '../core/queue/queue-job.js';
import type { ScheduledJob } from '../core/queue/scheduled-job.js';
import type { RepeatingJob } from '../core/repeat/repeating-job.js';
import { DataExportBuildJob } from './data-export/build.job.js';
import { DataExportExpireJob } from './data-export/expire.job.js';
import { ApplyBoundariesJob } from './entitlements/apply-boundaries.job.js';
import { ClearRevokedHubRoleJob } from './sync/clear-revoked-hub-role.job.js';
import { ConnectivitySweepJob } from './sync/connectivity-sweep.job.js';
import { ApplyScheduledStatusJob } from './tenancy/apply-scheduled-status.job.js';

/** The worker's jobs by how they run: one class per `jobs/<area>/<name>.job.ts` (ADR 0020). */
export type WorkerJobs = {
  /** On a pg-boss cron schedule (a minute at least). */
  scheduled: Type<ScheduledJob>[];
  /** Every few seconds, in every instance. */
  repeating: Type<RepeatingJob>[];
  /** On outbox events, through pg-boss queues. */
  events: Type<QueueJob>[];
};

export const jobs: WorkerJobs = {
  scheduled: [ApplyScheduledStatusJob, ApplyBoundariesJob, DataExportExpireJob],
  repeating: [ConnectivitySweepJob],
  events: [ClearRevokedHubRoleJob, DataExportBuildJob],
};
