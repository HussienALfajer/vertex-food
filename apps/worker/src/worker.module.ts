import { type DynamicModule, Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { HealthController } from './core/health/health.controller.js';
import { JobsDatabaseModule } from './core/jobs-database/jobs-database.module.js';
import { OutboxDispatcher } from './core/outbox/outbox-dispatcher.js';
import { QueueModule } from './core/queue/queue.module.js';
import { RepeatModule } from './core/repeat/repeating-job.js';
import type { WorkerJobs } from './jobs/index.js';

/**
 * The worker (ADR 0002, ADR 0020): its configuration, `GET /health` on a loopback port, pg-boss as
 * the queue role, the jobs role's database, the outbox dispatcher, and the jobs listed in
 * `jobs/index.ts`: scheduled, repeating and fed by outbox events.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: Config, jobs: WorkerJobs): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        JobsDatabaseModule,
        QueueModule.forRoot({ scheduled: jobs.scheduled, events: jobs.events }),
        RepeatModule.forRoot(jobs.repeating),
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
        OutboxDispatcher,
      ],
    };
  }
}
