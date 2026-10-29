import type { Job, QueueOptions } from 'pg-boss';

/**
 * What the outbox dispatcher hands to pg-boss for one outbox event; the job's id is the event's id.
 * The payload holds ids and codes only (ADR 0016). From Vertex Shifa's worker.
 */
export type OutboxJobData = { tenantId: string; type: string; payload: unknown };

/**
 * One pg-boss queue fed by outbox events, a Nest provider in `src/jobs/<area>/<name>.job.ts`
 * (ADR 0020), listed in `src/jobs/index.ts`. Its queue is created and subscribed to its events at
 * start.
 */
export interface QueueJob {
  /** The queue's name, `<area>.<name>` after its file. */
  readonly queue: string;
  /** The outbox event types the dispatcher delivers to this queue. */
  readonly events: readonly string[];
  /** The queue's retry, expiry and heartbeat settings; pg-boss's defaults otherwise. */
  readonly options?: QueueOptions;
  /**
   * Handles a batch of jobs; throwing fails them for a retry with backoff. Idempotent: a job may
   * run again after a crash or a retry (ADR 0001).
   */
  work(jobs: Job<OutboxJobData>[]): Promise<void>;
  /**
   * Handles the jobs whose every attempt failed, a crash or a lost heartbeat included: pg-boss
   * copies each into the queue's dead-letter queue, `<queue>.failed`, worked here. Idempotent too.
   */
  failed?(jobs: Job<OutboxJobData>[]): Promise<void>;
}
