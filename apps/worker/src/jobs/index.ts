import type { Type } from '@nestjs/common';
import type { ScheduledJob } from '../core/queue/scheduled-job.js';
import { ApplyScheduledStatusJob } from './tenancy/apply-scheduled-status.job.js';

/** Every scheduled job of the worker: one class per `jobs/<area>/<name>.job.ts` (ADR 0020). */
export const jobs: Type<ScheduledJob>[] = [ApplyScheduledStatusJob];
