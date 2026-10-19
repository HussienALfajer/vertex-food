import {
  type DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { describeForLog } from '@vertex-food/db';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';
import type { ScheduledJob } from './scheduled-job.js';

/** Injection token of the process's pg-boss, connected as the queue role. */
export const BOSS = Symbol('PgBoss');
const SCHEDULED_JOBS = Symbol('ScheduledJobs');

/** The schema the owner role creates for pg-boss (migration 0001 in `packages/db`). */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * pg-boss (ADR 0002), run as the queue role in its own schema, never as the jobs role. At start it
 * installs or migrates its tables, then creates each scheduled job's queue, schedules it and works
 * it. It stops gracefully on shutdown. Adapted from Vertex Shifa's queue module; the outbox
 * dispatcher joins it with the first event that has a consumer.
 */
@Global()
@Module({})
export class QueueModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');

  static forRoot(jobs: Type<ScheduledJob>[]): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: BOSS,
          inject: [CONFIG],
          useFactory: (config: Config) =>
            new PgBoss({
              connectionString: config.queueDatabaseUrl,
              schema: QUEUE_SCHEMA,
              createSchema: false,
            }),
        },
        ...jobs,
        {
          provide: SCHEDULED_JOBS,
          inject: jobs,
          useFactory: (...instances: ScheduledJob[]) => instances,
        },
      ],
      exports: [BOSS],
    };
  }

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SCHEDULED_JOBS) private readonly jobs: ScheduledJob[],
  ) {}

  async onModuleInit() {
    this.boss.on('error', (error) => this.logger.error(describeForLog(error)));
    await this.boss.start();
    for (const job of this.jobs) {
      await this.boss.createQueue(job.queue);
      await this.boss.schedule(job.queue, job.cron);
      await this.boss.work(job.queue, async () => {
        await job.run();
      });
    }
  }

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true });
  }
}
