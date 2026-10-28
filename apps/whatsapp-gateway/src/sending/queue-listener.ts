import type { Logger } from '@nestjs/common';
import pg from 'pg';
import { describeError } from '../core/log/describe-error.js';

/** The channel `enqueueWhatsAppMessage` notifies in the transaction that queues a message. */
const CHANNEL = 'whatsapp_messages';
/** The wait before listening again after the connection is lost; the 2 s poll covers it. */
const RELISTEN_MS = 5_000;

/**
 * A dedicated connection that `LISTEN`s on `whatsapp_messages` and calls `onNotify` for each
 * queued message (spec S03 rule 14). A lost connection listens again after a pause.
 */
export class QueueListener {
  private client: pg.Client | undefined;
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly databaseUrl: string,
    private readonly onNotify: () => void,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.databaseUrl });
    this.client = client;
    client.on('notification', () => this.onNotify());
    client.on('error', (error) => {
      this.logger.warn(`Queue listener lost: ${describeError(error)}`);
      this.restart(client);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      this.logger.warn(`Queue listener not started: ${describeError(error)}`);
      this.restart(client);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    await this.client?.end().catch(() => {});
  }

  private restart(client: pg.Client): void {
    if (this.client !== client || this.stopped) return;
    this.client = undefined;
    void client.end().catch(() => {});
    this.retry = setTimeout(() => void this.start(), RELISTEN_MS);
  }
}
