import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  canAdvanceWhatsAppMessage,
  chooseWhatsAppNumber,
  type MessageKind,
  type MessageTemplateKey,
  messageKinds,
  type WhatsAppMessageStatus,
  whatsappPolicy,
  whatsappRetryDelaySeconds,
  whatsappSendGapSeconds,
} from '@vertex-food/contracts';
import {
  type Database,
  isWhatsAppOptedOut,
  type MessagingCrypto,
  otpChallenges,
  type Transaction,
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappNumberCandidates,
  whatsappSealContext,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AlertsService } from '../alerts/alerts.service.js';
import { DATABASE, MESSAGING_CRYPTO } from '../core/database/database.module.js';
import { describeError } from '../core/log/describe-error.js';
import { Tasks } from '../core/tasks.js';
import { SessionRegistry } from '../sessions/session-registry.js';
import type { Receipt } from '../transport/whatsapp-transport.js';
import { endMessages } from './message-status.js';
import { renderMessage } from './render.js';

/** Replies go only from the number that received the message (rule 13). */
const REPLY_KINDS = new Set<MessageKind>(['opt_reply', 'auto_reply']);
/** What an opt-out stops at claim time (rules 24, 27): never an OTP or an opt-out's own reply. */
const OPT_OUT_STOPS = new Set<MessageKind>(['notification', 'alert', 'auto_reply']);
/** Queued messages looked at per claim, in priority order. */
const CLAIM_BATCH = 100;
/** How long a receipt may wait for the send it acknowledges to be recorded. */
const PENDING_RECEIPT_MS = 60_000;

type QueuedRow = {
  id: string;
  kind: MessageKind;
  template: MessageTemplateKey;
  session_id: string | null;
  recipient_hash: string;
  params_sealed: string | null;
  body_sealed: string | null;
  attempts: number;
  otp_challenge_id: string | null;
};

interface Claim {
  id: string;
  kind: MessageKind;
  sessionId: string;
  recipientHash: string;
  firstContact: boolean;
  otpChallengeId: string | null;
  attempts: number;
}

/**
 * The sender (spec S03 rules 7–15, 19–20, 24): claims queued messages in priority order with
 * `FOR UPDATE SKIP LOCKED` for the connected numbers this instance runs, each through the shared
 * limits (`whatsappNumberCandidates`, `chooseWhatsAppNumber`), renders and seals the text once,
 * sends it, and records the outcome: sent with its known recipient, or queued again with backoff,
 * pausing a number after three failures in a row. Receipts move a message only forward and its
 * OTP challenge with it. One send at a time per number and per recipient. Woken by `NOTIFY
 * whatsapp_messages` and every 2 s (`wake`). Logs hold message and session ids and kinds only.
 */
@Injectable()
export class SendingService {
  private readonly logger = new Logger('Sending');
  private readonly tasks = new Tasks(this.logger);
  private draining = false;
  private again = false;
  /** Sessions with a send in flight. */
  private readonly busy = new Set<string>();
  /** Recipients with a send in flight, so per-recipient counts cannot race. */
  private readonly inFlight = new Set<string>();
  /** The gap drawn after this instance's last send from each number (rule 7). */
  private readonly gaps = new Map<string, number>();
  /** Receipts that arrived before their send was recorded, by session and message id. */
  private readonly pendingReceipts = new Map<string, Receipt[]>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGING_CRYPTO) private readonly crypto: MessagingCrypto,
    @Inject(SessionRegistry) private readonly registry: SessionRegistry,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  /** Claims and sends what is due; a call during a run makes the run go once more. */
  wake(): void {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = true;
    this.tasks.run('Claim', async () => {
      try {
        do {
          this.again = false;
          let claimed: number;
          do claimed = await this.claim();
          while (claimed > 0);
        } while (this.again);
      } finally {
        this.draining = false;
      }
    });
  }

  /** Waits for the claims and sends started so far, and those they start (tests, shutdown). */
  settled(): Promise<void> {
    return this.tasks.settled();
  }

  private async claim(): Promise<number> {
    const ready = this.registry.ids().filter((id) => !this.busy.has(id));
    if (ready.length === 0) return 0;
    const claims = await this.db.transaction(async (tx) => {
      const queued = await tx.execute<QueuedRow>(sql`
        select id, kind, template, session_id, recipient_hash, params_sealed, body_sealed,
          attempts, otp_challenge_id
        from whatsapp_messages
        where status = 'queued' and next_attempt_at <= now() and deadline_at > now()
        order by array_position(array[${sql.join(
          messageKinds.map((kind) => sql`${kind}`),
          sql`, `,
        )}]::text[], kind), created_at
        limit ${CLAIM_BATCH}
      `);
      // Rows are read unlocked and each is locked only when it is taken, so another instance
      // claims the rest meanwhile instead of finding them all locked.
      const lock = async (id: string) => {
        const locked = await tx.execute(sql`
          select 1 from whatsapp_messages where id = ${id} and status = 'queued'
          for update skip locked
        `);
        return locked.rows.length > 0;
      };
      const free = new Set(ready);
      const claimed: Claim[] = [];
      for (const row of queued.rows) {
        if (free.size === 0) break;
        if (this.inFlight.has(row.recipient_hash)) continue;
        if (OPT_OUT_STOPS.has(row.kind) && (await isWhatsAppOptedOut(tx, row.recipient_hash))) {
          if (await lock(row.id)) await endMessages(tx, [row.id], 'failed', 'opted_out');
          continue;
        }
        const reply = REPLY_KINDS.has(row.kind);
        const { now, candidates } = await whatsappNumberCandidates(
          tx,
          row.recipient_hash,
          reply ? (row.session_id ?? undefined) : undefined,
        );
        const usable = candidates
          .filter((candidate) => free.has(candidate.id))
          .map((candidate) => ({
            ...candidate,
            stats: {
              ...candidate.stats,
              gapSeconds: this.gaps.get(candidate.id) ?? candidate.stats.gapSeconds,
            },
          }));
        const chosen = chooseWhatsAppNumber(usable, row.kind, now);
        if (!chosen || chosen.budget.notBefore > now || !(await lock(row.id))) continue;
        const body = row.body_sealed ?? this.sealBody(row);
        if (body === undefined) {
          this.logger.error(`Message ${row.id} could not be rendered`);
          await endMessages(tx, [row.id], 'failed', 'transport_error');
          continue;
        }
        await tx
          .update(whatsappMessages)
          .set({
            status: 'sending',
            sessionId: chosen.id,
            attempts: row.attempts + 1,
            bodySealed: body,
            paramsSealed: null,
          })
          .where(eq(whatsappMessages.id, row.id));
        free.delete(chosen.id);
        claimed.push({
          id: row.id,
          kind: row.kind,
          sessionId: chosen.id,
          recipientHash: row.recipient_hash,
          firstContact: chosen.budget.firstContact,
          otpChallengeId: row.otp_challenge_id,
          attempts: row.attempts + 1,
        });
      }
      return claimed;
    });
    for (const claim of claims) {
      this.busy.add(claim.sessionId);
      this.inFlight.add(claim.recipientHash);
      this.tasks.run(`Message ${claim.id} send`, () => this.send(claim));
    }
    return claims.length;
  }

  /** Rule 14: the text from the template and the opened parameters, sealed as `body_sealed`. */
  private sealBody(row: QueuedRow): string | undefined {
    const params =
      row.params_sealed &&
      this.crypto.box.open(whatsappSealContext(row.id, 'params'), row.params_sealed);
    if (!params) return undefined;
    try {
      const text = renderMessage(row.template, JSON.parse(params));
      return this.crypto.box.seal(whatsappSealContext(row.id, 'body'), text);
    } catch {
      return undefined;
    }
  }

  private async send(claim: Claim): Promise<void> {
    try {
      const [row] = await this.db
        .select({
          recipientSealed: whatsappMessages.recipientSealed,
          bodySealed: whatsappMessages.bodySealed,
        })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.id, claim.id));
      const box = this.crypto.box;
      const phone =
        row?.recipientSealed &&
        box.open(whatsappSealContext(claim.id, 'recipient'), row.recipientSealed);
      const text =
        row?.bodySealed && box.open(whatsappSealContext(claim.id, 'body'), row.bodySealed);
      if (!phone || !text) {
        this.logger.error(`Message ${claim.id} could not be opened`);
        await this.db.transaction((tx) => endMessages(tx, [claim.id], 'failed', 'transport_error'));
        return;
      }
      const connection = this.registry.get(claim.sessionId);
      if (!connection) {
        await this.queueAgain(claim, 0);
        return;
      }
      let messageId: string;
      try {
        ({ messageId } = await connection.sendText(phone, text));
      } catch (error) {
        this.logger.warn(
          `Message ${claim.id} failed on session ${claim.sessionId}: ${describeError(error)}`,
        );
        await this.sendFailed(claim);
        return;
      }
      await this.sent(claim, messageId);
    } finally {
      this.busy.delete(claim.sessionId);
      this.inFlight.delete(claim.recipientHash);
      this.wake();
    }
  }

  private async sent(claim: Claim, messageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(whatsappMessages)
        .set({
          status: 'sent',
          sentAt: sql`now()`,
          transportMessageId: messageId,
          firstContact: claim.firstContact,
        })
        .where(and(eq(whatsappMessages.id, claim.id), eq(whatsappMessages.status, 'sending')));
      await tx
        .insert(whatsappKnownRecipients)
        .values({
          id: uuidv7(),
          sessionId: claim.sessionId,
          recipientHash: claim.recipientHash,
          firstSentAt: sql`now()`,
          lastSentAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [whatsappKnownRecipients.sessionId, whatsappKnownRecipients.recipientHash],
          set: { lastSentAt: sql`now()`, updatedAt: sql`now()` },
        });
      await tx
        .update(whatsappSessions)
        .set({ consecutiveFailures: 0 })
        .where(
          and(
            eq(whatsappSessions.id, claim.sessionId),
            gt(whatsappSessions.consecutiveFailures, 0),
          ),
        );
      if (claim.otpChallengeId) {
        await tx
          .update(otpChallenges)
          .set({ deliveryStatus: 'sent' })
          .where(
            and(
              eq(otpChallenges.id, claim.otpChallengeId),
              eq(otpChallenges.deliveryStatus, 'queued'),
            ),
          );
      }
    });
    this.gaps.set(claim.sessionId, whatsappSendGapSeconds());
    this.logger.log(`Message ${claim.id} (${claim.kind}) sent on session ${claim.sessionId}`);
    const key = receiptKey(claim.sessionId, messageId);
    const waiting = this.pendingReceipts.get(key);
    this.pendingReceipts.delete(key);
    for (const receipt of waiting ?? []) await this.receipt(claim.sessionId, receipt);
  }

  /** Rules 6 and 15: a transport error counts against the number and retries with backoff. */
  private async sendFailed(claim: Claim): Promise<void> {
    const paused = await this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(whatsappSessions)
        .set({ consecutiveFailures: sql`${whatsappSessions.consecutiveFailures} + 1` })
        .where(eq(whatsappSessions.id, claim.sessionId))
        .returning({ failures: whatsappSessions.consecutiveFailures });
      let pausedNow = false;
      if (session && session.failures >= whatsappPolicy.maxConsecutiveFailures) {
        const [row] = await tx
          .update(whatsappSessions)
          .set({ pausedAt: sql`now()`, pauseReason: 'send_failures' })
          .where(and(eq(whatsappSessions.id, claim.sessionId), isNull(whatsappSessions.pausedAt)))
          .returning({ id: whatsappSessions.id });
        if (row) {
          await tx.insert(whatsappSessionEvents).values({
            id: uuidv7(),
            sessionId: claim.sessionId,
            type: 'paused',
            reason: 'send_failures',
          });
          pausedNow = true;
        }
      }
      await this.queueAgainIn(tx, claim, whatsappRetryDelaySeconds(claim.attempts));
      return pausedNow;
    });
    if (paused) {
      this.logger.warn(`Session ${claim.sessionId} paused after failed sends`);
      await this.alerts.raise(claim.sessionId, 'paused_send_failures');
      await this.alerts.checkHealth();
    }
  }

  private queueAgain(claim: Claim, delaySeconds: number): Promise<void> {
    return this.db.transaction((tx) => this.queueAgainIn(tx, claim, delaySeconds));
  }

  /** Back to the queue; the next attempt may use another number, except for replies. */
  private async queueAgainIn(tx: Transaction, claim: Claim, delaySeconds: number): Promise<void> {
    await tx
      .update(whatsappMessages)
      .set({
        status: 'queued',
        ...(REPLY_KINDS.has(claim.kind) ? {} : { sessionId: null }),
        nextAttemptAt: sql`now() + make_interval(secs => ${delaySeconds})`,
      })
      .where(and(eq(whatsappMessages.id, claim.id), eq(whatsappMessages.status, 'sending')));
  }

  /** A receipt moves its message forward only, and the OTP challenge with it (rule 19). */
  async receipt(sessionId: string, receipt: Receipt): Promise<void> {
    // `sent` was recorded when the send resolved; nothing moves back from it to `failed`.
    if (receipt.status === 'sent' || receipt.status === 'failed') return;
    const next: WhatsAppMessageStatus = receipt.status;
    const at = receipt.at.toISOString();
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: whatsappMessages.id,
          status: whatsappMessages.status,
          otpChallengeId: whatsappMessages.otpChallengeId,
        })
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.sessionId, sessionId),
            eq(whatsappMessages.transportMessageId, receipt.messageId),
          ),
        )
        .for('update');
      if (!row) return 'unknown';
      if (!canAdvanceWhatsAppMessage(row.status as WhatsAppMessageStatus, next)) return 'ignored';
      await tx
        .update(whatsappMessages)
        .set({
          status: next,
          deliveredAt: sql`coalesce(${whatsappMessages.deliveredAt}, ${at}::timestamptz)`,
          ...(next === 'read' && { readAt: sql`${at}::timestamptz` }),
        })
        .where(eq(whatsappMessages.id, row.id));
      if (row.otpChallengeId) {
        await tx
          .update(otpChallenges)
          .set({ deliveryStatus: 'delivered' })
          .where(
            and(
              eq(otpChallenges.id, row.otpChallengeId),
              inArray(otpChallenges.deliveryStatus, ['queued', 'sent']),
            ),
          );
      }
      return 'applied';
    });
    if (outcome === 'unknown' && this.busy.has(sessionId)) {
      // The send it acknowledges has not been recorded yet: apply it once it is.
      const key = receiptKey(sessionId, receipt.messageId);
      this.pendingReceipts.set(key, [...(this.pendingReceipts.get(key) ?? []), receipt]);
      setTimeout(() => this.pendingReceipts.delete(key), PENDING_RECEIPT_MS).unref();
    }
  }

  /** The text sent as `messageId`, for a retry request, while it is kept (one hour, rule 31). */
  async sentText(sessionId: string, messageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: whatsappMessages.id, bodySealed: whatsappMessages.bodySealed })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.sessionId, sessionId),
          eq(whatsappMessages.transportMessageId, messageId),
          isNotNull(whatsappMessages.bodySealed),
          sql`${whatsappMessages.sentAt} > now() - make_interval(hours => ${whatsappPolicy.contentRetentionHours})`,
        ),
      );
    if (!row?.bodySealed) return null;
    return this.crypto.box.open(whatsappSealContext(row.id, 'body'), row.bodySealed) ?? null;
  }
}

function receiptKey(sessionId: string, messageId: string): string {
  return `${sessionId}\n${messageId}`;
}
