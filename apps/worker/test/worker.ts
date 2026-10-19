import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { configureApp } from '../src/app.js';
import { loadConfig } from '../src/core/config/config.js';
import type { ScheduledJob } from '../src/core/queue/scheduled-job.js';
import { WorkerModule } from '../src/worker.module.js';

export const testConfig = () =>
  loadConfig({ DATABASE_QUEUE_URL: inject('queueUrl'), DATABASE_JOBS_URL: inject('jobsUrl') });

/** The worker as production starts it, on this run's database, with `jobs`. Close it after use. */
export async function startWorker(jobs: Type<ScheduledJob>[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(testConfig(), jobs)],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();
  return app;
}
