import { Inject, Injectable, Logger } from '@nestjs/common';
import { whatsappPolicy } from '@vertex-food/contracts';
import { type Database, whatsappMessages } from '@vertex-food/db';
import { and, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service.js';
import { DATABASE } from '../core/database/database.module.js';
import { endMessages } from '../sending/message-status.js';

/** A `sending` message untouched this long has lost its gateway (killed mid-send). */
const STUCK_SENDING_SECONDS = 60;

/**
 * The gateway's sweep, every minute (spec S03 rule 31): sealed texts cleared one hour after
 * sending, sealed parameters and recipients one hour after a final status, overdue messages
 * expired (`deadline`, their OTP challenge failed), rows older than 30 days deleted; then the
 * alerts that come from time passing (rule 29). Counts are logged, never content.
 */
@Injectable()
export class SweepService {
  private readonly logger = new Logger('Sweep');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  async run(): Promise<void> {
    const retention = sql`now() - make_interval(hours => ${whatsappPolicy.contentRetentionHours})`;
    const bodies = await this.db
      .update(whatsappMessages)
      .set({ bodySealed: null })
      .where(and(isNotNull(whatsappMessages.bodySealed), lt(whatsappMessages.sentAt, retention)))
      .returning({ id: whatsappMessages.id });
    const contents = await this.db
      .update(whatsappMessages)
      .set({ paramsSealed: null, recipientSealed: null })
      .where(
        and(
          or(isNotNull(whatsappMessages.paramsSealed), isNotNull(whatsappMessages.recipientSealed)),
          inArray(whatsappMessages.status, ['sent', 'delivered', 'read', 'failed', 'expired']),
          lt(sql`coalesce(${whatsappMessages.sentAt}, ${whatsappMessages.updatedAt})`, retention),
        ),
      )
      .returning({ id: whatsappMessages.id });
    const expired = await this.db.transaction(async (tx) => {
      const overdue = await tx.execute<{ id: string }>(sql`
        select id from whatsapp_messages
        where deadline_at <= now()
          and (status = 'queued'
            or (status = 'sending'
              and updated_at < now() - make_interval(secs => ${STUCK_SENDING_SECONDS})))
        for update skip locked
      `);
      return endMessages(
        tx,
        overdue.rows.map((row) => row.id),
        'expired',
        'deadline',
      );
    });
    const deleted = await this.db
      .delete(whatsappMessages)
      .where(
        lt(
          whatsappMessages.createdAt,
          sql`now() - make_interval(days => ${whatsappPolicy.messageRetentionDays})`,
        ),
      )
      .returning({ id: whatsappMessages.id });
    if (bodies.length + contents.length + expired + deleted.length > 0) {
      this.logger.log(
        `Swept: ${bodies.length} texts and ${contents.length} recipients cleared, ${expired} expired, ${deleted.length} deleted`,
      );
    }
    await this.alerts.checkDisconnected();
    await this.alerts.checkHealth();
  }
}
