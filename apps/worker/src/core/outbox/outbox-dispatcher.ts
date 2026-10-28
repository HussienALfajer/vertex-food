import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, type Database, describeForLog, inArray, outboxEvents, sql } from '@vertex-food/db';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { JOBS_DATABASE } from '../jobs-database/jobs-database.module.js';
import { BOSS, QUEUE_SCHEMA } from '../queue/queue.module.js';
import type { OutboxJobData } from '../queue/queue-job.js';

/** Events claimed per transaction. */
export const OUTBOX_BATCH_SIZE = 100;
/** The pause between two polls once the outbox is drained. */
const POLL_INTERVAL_MS = 1000;
/**
 * How long shutdown waits for a poll in flight. The poll's statements are bounded by the pool's
 * timeouts; past this wait, shutdown goes on and the pool closes once the poll gives its connection
 * back, its claim rolled back unless it committed.
 */
export const SHUTDOWN_WAIT_MS = 10_000;

/**
 * The transactional outbox's dispatcher (ADR 0012), from Vertex Shifa's worker. As the audited
 * jobs role it claims pending events of every tenant whose type has a subscribed queue, oldest
 * first, skipping those another dispatcher holds, and publishes each to those queues in the same
 * transaction: an event is claimed exactly when its jobs exist. An event nobody subscribes to stays
 * pending, never lost (a worker that does not know a new type yet leaves it to the one that does).
 * It polls from bootstrap until shutdown; a failed batch rolls back and is retried at the next poll.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('Outbox');
  private timer: NodeJS.Timeout | undefined;
  private polling: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(JOBS_DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  /** Claims and hands off one batch; returns the ids of the events it claimed. */
  async dispatchBatch(): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const pending = tx
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            sql`${outboxEvents.dispatchedAt} is null`,
            inArray(
              outboxEvents.type,
              sql`(select event from ${sql.identifier(QUEUE_SCHEMA)}.subscription)`,
            ),
          ),
        )
        .orderBy(outboxEvents.id)
        .limit(OUTBOX_BATCH_SIZE)
        .for('update', { skipLocked: true });
      const claimed = await tx
        .update(outboxEvents)
        .set({ dispatchedAt: sql`now()`, updatedAt: sql`now()` })
        .where(inArray(outboxEvents.id, pending))
        .returning({
          id: outboxEvents.id,
          tenantId: outboxEvents.tenantId,
          type: outboxEvents.type,
          payload: outboxEvents.payload,
        });
      claimed.sort((a, b) => (a.id < b.id ? -1 : 1));
      const db = fromDrizzle(tx, sql);
      for (const event of claimed) {
        const data: OutboxJobData = {
          tenantId: event.tenantId,
          type: event.type,
          payload: event.payload,
        };
        await this.boss.publish(event.type, data, { db, id: event.id });
      }
      return claimed.map((event) => event.id);
    });
  }

  onApplicationBootstrap() {
    this.schedule(0);
  }

  async beforeApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    let timeout: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      this.polling?.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), SHUTDOWN_WAIT_MS);
      }),
    ]);
    clearTimeout(timeout);
    if (finished === false) this.logger.warn('Shutdown did not wait for the poll in flight');
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.polling = this.drain().finally(() => {
        if (!this.stopped) this.schedule(POLL_INTERVAL_MS);
      });
    }, delay);
  }

  /** Dispatches full batches until the outbox is drained or the worker stops. */
  private async drain() {
    try {
      while (!this.stopped && (await this.dispatchBatch()).length === OUTBOX_BATCH_SIZE) {}
    } catch (error) {
      this.logger.error(describeForLog(error));
    }
  }
}
