import {
  type DynamicModule,
  Module,
  StandardSchemaSerializerInterceptor,
  type Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { HealthController } from './core/health/health.controller.js';
import { JobsDatabaseModule } from './core/jobs-database/jobs-database.module.js';
import { QueueModule } from './core/queue/queue.module.js';
import type { ScheduledJob } from './core/queue/scheduled-job.js';

/**
 * The worker (ADR 0002, ADR 0020): its configuration, `GET /health` on a loopback port, pg-boss as
 * the queue role, the jobs role's database, and the scheduled jobs listed in `jobs/index.ts`.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: Config, jobs: Type<ScheduledJob>[]): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ConfigModule.forRoot(config), JobsDatabaseModule, QueueModule.forRoot(jobs)],
      controllers: [HealthController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor }],
    };
  }
}
