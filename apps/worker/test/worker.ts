import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { configureApp } from '../src/app.js';
import { loadConfig } from '../src/core/config/config.js';
import type { WorkerJobs } from '../src/jobs/index.js';
import { WorkerModule } from '../src/worker.module.js';

export const testConfig = () =>
  loadConfig({ DATABASE_QUEUE_URL: inject('queueUrl'), DATABASE_JOBS_URL: inject('jobsUrl') });

/** The worker as production starts it, on this run's database, with `jobs`. Close it after use. */
export async function startWorker(jobs: Partial<WorkerJobs> = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      WorkerModule.forRoot(testConfig(), { scheduled: [], repeating: [], events: [], ...jobs }),
    ],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();
  return app;
}
