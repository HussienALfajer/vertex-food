import { Inject, Injectable, Logger } from '@nestjs/common';
import { matchWhatsAppKeyword, whatsappPolicy } from '@vertex-food/contracts';
import {
  type Database,
  enqueueWhatsAppMessage,
  isWhatsAppOptedOut,
  type MessagingCrypto,
  sendAvailability,
  type Transaction,
  whatsappKnownRecipients,
  whatsappOptOuts,
  whatsappRecipientHash,
} from '@vertex-food/db';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, MESSAGING_CRYPTO } from '../core/database/database.module.js';
import type { IncomingMessage } from '../transport/whatsapp-transport.js';

/** Message ids remembered per process to drop the second report of one message (rule 25). */
const SEEN_LIMIT = 5_000;

/**
 * Incoming messages on platform numbers (spec S03 rules 25–28): only from the receiving number's
 * known recipients, de-duplicated by message id across live (`notify`) and catch-up (`append`)
 * reports. A keyword newer than the person's last one opts them out or in and queues one
 * confirmation from that number; any other text gets one auto-reply a day unless they opted out.
 * A reply is queued only when that number has budget for it now (rule 11). Nothing from anyone
 * else is stored, and no body is ever stored or logged.
 */
@Injectable()
export class IncomingService {
  private readonly logger = new Logger('Incoming');
  private readonly seen = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGING_CRYPTO) private readonly crypto: MessagingCrypto,
  ) {}

  async handle(sessionId: string, message: IncomingMessage): Promise<void> {
    const seenKey = `${sessionId}\n${message.id}`;
    if (message.from === null || this.seen.has(seenKey)) return;
    this.remember(seenKey);
    const phone = message.from;
    const recipientHash = whatsappRecipientHash(this.crypto, phone);
    const outcome = await this.db.transaction(async (tx) => {
      const [known] = await tx
        .select({
          id: whatsappKnownRecipients.id,
          lastAutoReplyAt: whatsappKnownRecipients.lastAutoReplyAt,
        })
        .from(whatsappKnownRecipients)
        .where(
          and(
            eq(whatsappKnownRecipients.sessionId, sessionId),
            eq(whatsappKnownRecipients.recipientHash, recipientHash),
          ),
        )
        .for('update');
      if (!known) return 'unknown sender';
      const keyword = matchWhatsAppKeyword(message.text);
      if (keyword)
        return this.keyword(tx, sessionId, phone, recipientHash, keyword, message.sentAt);
      return this.autoReply(tx, sessionId, phone, recipientHash, known.id);
    });
    this.logger.log(`Message ${message.id} on session ${sessionId}: ${outcome}`);
  }

  /** Rule 26: applied only when newer than the person's last keyword, then confirmed once. */
  private async keyword(
    tx: Transaction,
    sessionId: string,
    phone: string,
    recipientHash: string,
    keyword: 'opt_out' | 'opt_in',
    sentAt: Date,
  ): Promise<string> {
    const at = sql`${sentAt.toISOString()}::timestamptz`;
    const change = keyword === 'opt_out' ? { optedOutAt: at } : { optedInAt: at };
    const [applied] = await tx
      .insert(whatsappOptOuts)
      .values({ id: uuidv7(), recipientHash, lastKeywordAt: at, ...change })
      .onConflictDoUpdate({
        target: whatsappOptOuts.recipientHash,
        set: { ...change, lastKeywordAt: at, updatedAt: sql`now()` },
        setWhere: sql`${whatsappOptOuts.lastKeywordAt} < ${at}`,
      })
      .returning({ id: whatsappOptOuts.id });
    if (!applied) return `${keyword} older than the last keyword`;
    const template = keyword === 'opt_out' ? 'opt_out_confirmed' : 'opt_in_confirmed';
    const queued = await this.reply(tx, sessionId, phone, recipientHash, 'opt_reply', template);
    return `${keyword}, ${queued ? 'confirmation queued' : 'no budget for a confirmation'}`;
  }

  /** Rule 28: one auto-reply per person and number every 24 hours, never after an opt-out. */
  private async autoReply(
    tx: Transaction,
    sessionId: string,
    phone: string,
    recipientHash: string,
    knownId: string,
  ): Promise<string> {
    if (await isWhatsAppOptedOut(tx, recipientHash)) return 'opted out, no auto-reply';
    const [due] = await tx
      .select({ id: whatsappKnownRecipients.id })
      .from(whatsappKnownRecipients)
      .where(
        and(
          eq(whatsappKnownRecipients.id, knownId),
          sql`(${whatsappKnownRecipients.lastAutoReplyAt} is null or ${whatsappKnownRecipients.lastAutoReplyAt} <= now() - make_interval(hours => ${whatsappPolicy.autoReplyHours}))`,
        ),
      );
    if (!due) return 'auto-reply already sent today';
    const queued = await this.reply(
      tx,
      sessionId,
      phone,
      recipientHash,
      'auto_reply',
      'auto_reply',
    );
    if (!queued) return 'no budget for an auto-reply';
    await tx
      .update(whatsappKnownRecipients)
      .set({ lastAutoReplyAt: sql`now()` })
      .where(eq(whatsappKnownRecipients.id, knownId));
    return 'auto-reply queued';
  }

  private async reply(
    tx: Transaction,
    sessionId: string,
    phone: string,
    recipientHash: string,
    kind: 'opt_reply' | 'auto_reply',
    template: 'opt_out_confirmed' | 'opt_in_confirmed' | 'auto_reply',
  ): Promise<boolean> {
    if (!(await sendAvailability(tx, recipientHash, kind, sessionId))) return false;
    await enqueueWhatsAppMessage(tx, this.crypto, { kind, template, phone, params: {}, sessionId });
    return true;
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }
}
