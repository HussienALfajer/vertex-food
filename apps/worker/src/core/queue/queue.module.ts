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
import { type Config, JOBS_ROLE } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';
import type { OutboxJobData, QueueJob } from './queue-job.js';
import type { ScheduledJob } from './scheduled-job.js';

/** Injection token of the process's pg-boss, connected as the queue role. */
export const BOSS = Symbol('PgBoss');
const SCHEDULED_JOBS = Symbol('ScheduledJobs');
const QUEUE_JOBS = Symbol('QueueJobs');

/** The schema the owner role creates for pg-boss (migration 0001 in `packages/db`). */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * What the outbox dispatcher, as the jobs role, may reach in pg-boss's tables: see which event
 * types have subscribers, read the queues' settings and add jobs to the shared job table
 * (`job_common`, used by every queue created without its own partition), reading back only their
 * ids. Run as the queue role, which owns the tables, after every start, since pg-boss may recreate
 * them when it migrates. One implicit transaction: the revoke first makes the grant exact, and the
 * lock keeps two instances starting together from updating the same grants at once. From Vertex
 * Shifa's worker.
 */
export const JOBS_ROLE_GRANTS = `
  SELECT pg_advisory_xact_lock(hashtext('${QUEUE_SCHEMA}.jobs_role_grants'));
  REVOKE ALL ON ALL TABLES IN SCHEMA ${QUEUE_SCHEMA} FROM ${JOBS_ROLE};
  GRANT SELECT (event) ON ${QUEUE_SCHEMA}.subscription TO ${JOBS_ROLE};
  GRANT SELECT ON ${QUEUE_SCHEMA}.queue TO ${JOBS_ROLE};
  GRANT INSERT, SELECT (id) ON ${QUEUE_SCHEMA}.job_common TO ${JOBS_ROLE}`;

/**
 * pg-boss (ADR 0002), run as the queue role in its own schema, never as the jobs role. At start it
 * installs or migrates its tables, grants the jobs role its hand-off, then creates each scheduled
 * job's queue and schedule, and each event job's queue and subscriptions, and works them. It stops
 * gracefully on shutdown. Adapted from Vertex Shifa's queue module.
 */
@Global()
@Module({})
export class QueueModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');

  static forRoot(jobs: {
    scheduled: Type<ScheduledJob>[];
    events: Type<QueueJob>[];
  }): DynamicModule {
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
        ...jobs.scheduled,
        ...jobs.events,
        {
          provide: SCHEDULED_JOBS,
          inject: jobs.scheduled,
          useFactory: (...instances: ScheduledJob[]) => instances,
        },
        {
          provide: QUEUE_JOBS,
          inject: jobs.events,
          useFactory: (...instances: QueueJob[]) => instances,
        },
      ],
      exports: [BOSS],
    };
  }

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SCHEDULED_JOBS) private readonly scheduled: ScheduledJob[],
    @Inject(QUEUE_JOBS) private readonly events: QueueJob[],
  ) {}

  async onModuleInit() {
    this.boss.on('error', (error) => this.logger.error(describeForLog(error)));
    await this.boss.start();
    await this.boss.getDb().executeSql(JOBS_ROLE_GRANTS);
    for (const job of this.scheduled) {
      await this.boss.createQueue(job.queue);
      await this.boss.schedule(job.queue, job.cron);
      await this.boss.work(job.queue, async () => {
        await job.run();
      });
    }
    for (const job of this.events) {
      await this.boss.createQueue(job.queue);
      for (const event of job.events) await this.boss.subscribe(event, job.queue);
      await this.boss.work<OutboxJobData>(job.queue, (jobs) => job.work(jobs));
    }
  }

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true });
  }
}
