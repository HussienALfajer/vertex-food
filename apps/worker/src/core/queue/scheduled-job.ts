/**
 * A job pg-boss runs on a schedule, a Nest provider in `src/jobs/<area>/<name>.job.ts` (ADR 0020),
 * listed in `src/jobs/index.ts`. pg-boss sends one job per tick to the queue whichever worker
 * instance holds the schedule, and one instance works it.
 */
export interface ScheduledJob {
  /** The queue's name, `<area>.<name>` after its file. */
  readonly queue: string;
  /** A cron expression in UTC: `* * * * *` is every minute. */
  readonly cron: string;
  /**
   * Does one run; throwing fails the job for a retry. Safe to run twice or concurrently: it
   * changes only rows still in the state it read (ADR 0001).
   */
  run(): Promise<unknown>;
}
