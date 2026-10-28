import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import { describeForLog } from '@vertex-food/db';

/**
 * A job run every few seconds, more often than pg-boss's cron allows (one minute), a Nest provider
 * in `src/jobs/<area>/<name>.job.ts` listed in `src/jobs/index.ts`. Every worker instance runs it,
 * so it is safe twice or concurrently: it changes only rows still in the state it read, under a row
 * lock.
 */
export interface RepeatingJob {
  /** `<area>.<name>` after its file, for the log. */
  readonly name: string;
  readonly intervalMs: number;
  /** One run; a failure is logged and the next run comes at the next interval. */
  run(): Promise<unknown>;
}

const REPEATING_JOBS = Symbol('RepeatingJobs');

/** How long shutdown waits for runs in flight. */
const SHUTDOWN_WAIT_MS = 10_000;

/** Runs each repeating job from bootstrap until shutdown, one run at a time per job. */
class Repeater implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('Repeat');
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;

  constructor(private readonly jobs: RepeatingJob[]) {}

  onApplicationBootstrap() {
    for (const job of this.jobs) this.schedule(job);
  }

  async beforeApplicationShutdown() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(this.running),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, SHUTDOWN_WAIT_MS);
      }),
    ]);
    clearTimeout(timeout);
  }

  private schedule(job: RepeatingJob) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = job
        .run()
        .then(
          () => undefined,
          (error: unknown) => this.logger.error(`${job.name}: ${describeForLog(error)}`),
        )
        .finally(() => {
          this.running.delete(run);
          if (!this.stopped) this.schedule(job);
        });
      this.running.add(run);
    }, job.intervalMs);
    this.timers.add(timer);
  }
}

@Module({})
export class RepeatModule {
  static forRoot(jobs: Type<RepeatingJob>[]): DynamicModule {
    return {
      module: RepeatModule,
      providers: [
        ...jobs,
        {
          provide: REPEATING_JOBS,
          inject: jobs,
          useFactory: (...instances: RepeatingJob[]) => new Repeater(instances),
        },
      ],
    };
  }
}
