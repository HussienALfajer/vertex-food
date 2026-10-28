import { Inject, Injectable } from '@nestjs/common';
import {
  type AuditAction,
  assertWhatsAppSessionPause,
  assertWhatsAppSessionStateChange,
  type CreatePlatformWhatsAppSession,
  DomainError,
  type MessagingHealth,
  type PlatformWhatsAppSession,
  type WhatsAppQr,
  type WhatsAppSessionDetail,
  type WhatsAppSessionEventType,
  type WhatsAppSessionState,
  whatsappPolicy,
} from '@vertex-food/contracts';
import {
  type Database,
  type MessagingCrypto,
  sendAvailability,
  type Transaction,
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappSessionCredentials,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { PlatformActor } from '../../../core/access/actor.js';
import { auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { MESSAGING_CRYPTO, whatsappQrSealContext } from './messaging-crypto.js';
import {
  NO_USAGE,
  toPlatformWhatsAppSession,
  toWhatsAppSessionEvent,
  type WhatsAppSessionRow,
  type WhatsAppSessionUsage,
} from './messaging.views.js';
import { PLATFORM_USER_NAMES, type PlatformUserNames } from './ports.js';

/** Events shown on a number's detail (spec S03, "API and commands"). */
const RECENT_EVENTS = 50;

/** The hash purpose of the health check's probe: never a recipient's hash. */
const HEALTH_PROBE_PURPOSE = 'whatsapp-health-probe';

/** The time an unscanned link closes (rule 4), on the database's clock. */
const linkDeadline = () => sql`now() + make_interval(secs => ${whatsappPolicy.linkTimeoutSeconds})`;

const notFound = () => new DomainError('NOT_FOUND', 'No such WhatsApp session');

type UsageRow = {
  id: string;
  sent_last_hour: number;
  sent_last_24h: number;
  first_contacts_last_24h: number;
};

/**
 * Vertex's platform WhatsApp numbers for the console (spec S03): the list with each number's
 * usage, a number with its recent events, the messaging health, and the admins' actions (add,
 * re-link, pause, resume, unlink), each with its session event and platform audit entry (rule 43)
 * in its transaction. The API never connects to WhatsApp: the gateway that holds a session's lease
 * sees these changes and links, closes or logs out its connection.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGING_CRYPTO) private readonly crypto: MessagingCrypto,
    @Inject(PLATFORM_USER_NAMES) private readonly userNames: PlatformUserNames,
  ) {}

  async listSessions(): Promise<PlatformWhatsAppSession[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(whatsappSessions)
        .where(isNull(whatsappSessions.archivedAt))
        .orderBy(asc(whatsappSessions.createdAt));
      const { now, usage } = await this.usage(tx);
      return rows.map((row) => toPlatformWhatsAppSession(row, usage.get(row.id) ?? NO_USAGE, now));
    });
  }

  async getSession(id: string): Promise<WhatsAppSessionDetail> {
    return this.db.transaction(async (tx) => {
      const row = await sessionById(tx, id);
      const events = await tx
        .select()
        .from(whatsappSessionEvents)
        .where(eq(whatsappSessionEvents.sessionId, id))
        .orderBy(desc(whatsappSessionEvents.createdAt), desc(whatsappSessionEvents.id))
        .limit(RECENT_EVENTS);
      const names = await this.userNames.names(tx, [
        ...new Set(events.flatMap((event) => event.platformUserId ?? [])),
      ]);
      return {
        session: await this.view(tx, row),
        events: events.map((event) => toWhatsAppSessionEvent(event, names)),
      };
    });
  }

  /**
   * How many numbers are healthy (rule 2) and whether one of them could send an OTP to a phone it
   * never messaged now: a first contact, the strictest case (rules 8–9).
   */
  async health(): Promise<MessagingHealth> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ total: number; healthy: number }>(sql`
        select
          count(*)::int as total,
          count(*) filter (
            where state = 'connected' and paused_at is null and lease_expires_at > now()
          )::int as healthy
        from whatsapp_sessions
        where archived_at is null
      `);
      const { total = 0, healthy = 0 } = result.rows[0] ?? {};
      const probe = this.crypto.hash.hash(HEALTH_PROBE_PURPOSE, 'otp');
      const otpAvailable = healthy > 0 && (await sendAvailability(tx, probe, 'otp')) !== undefined;
      return { healthy, total, otpAvailable };
    });
  }

  /** The current QR code while linking, for the console to render (rule 4). */
  async qr(id: string): Promise<WhatsAppQr> {
    return this.db.transaction(async (tx) => {
      const row = await sessionById(tx, id);
      const now = await databaseNow(tx);
      const linking = row.state === 'linking';
      const current =
        linking && row.qrSealed !== null && row.qrExpiresAt !== null && row.qrExpiresAt > now;
      const qr = current
        ? (this.crypto.box.open(whatsappQrSealContext(row.id), row.qrSealed as string) ?? null)
        : null;
      return {
        state: row.state as WhatsAppSessionState,
        qr,
        expiresAt: qr ? (row.qrExpiresAt?.toISOString() ?? null) : null,
        linkDeadlineAt: linking ? (row.linkDeadlineAt?.toISOString() ?? null) : null,
      };
    });
  }

  /** A new number, `linking` until its QR is scanned; at most 10 unarchived numbers. */
  async createSession(
    operator: PlatformActor,
    input: CreatePlatformWhatsAppSession,
  ): Promise<PlatformWhatsAppSession> {
    try {
      return await this.db.transaction(async (tx) => {
        // Serializes additions, so two at once never both pass the limit.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('whatsapp_sessions.create'))`);
        const [counted] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(whatsappSessions)
          .where(isNull(whatsappSessions.archivedAt));
        if ((counted?.count ?? 0) >= whatsappPolicy.maxSessions) {
          throw new DomainError('WHATSAPP_SESSION_LIMIT', 'Too many platform WhatsApp numbers', {
            limit: whatsappPolicy.maxSessions,
          });
        }
        const [row] = await tx
          .insert(whatsappSessions)
          .values({ label: input.label, state: 'linking', linkDeadlineAt: linkDeadline() })
          .returning();
        if (!row) throw new Error('A WhatsApp session neither inserted nor returned');
        await this.record(tx, operator, row.id, 'created', 'whatsapp_session.created');
        return this.view(tx, row);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'whatsapp_sessions_label_idx')) {
        throw new DomainError('CONFLICT', 'A platform WhatsApp number has this label', {
          field: 'label',
        });
      }
      throw error;
    }
  }

  /**
   * A new QR link for a number that lost its link, was banned or is disconnected: the old link's
   * credentials are deleted first. Its phone and `linked_at` stay until the gateway sees which
   * phone is scanned (rule 5).
   */
  async relink(operator: PlatformActor, id: string): Promise<PlatformWhatsAppSession> {
    return this.db.transaction(async (tx) => {
      const row = await lockSession(tx, id);
      assertWhatsAppSessionStateChange(row.state as WhatsAppSessionState, 'linking', 'admin');
      await tx.delete(whatsappSessionCredentials).where(eq(whatsappSessionCredentials.sessionId, id));
      const [updated] = await tx
        .update(whatsappSessions)
        .set({
          state: 'linking',
          linkDeadlineAt: linkDeadline(),
          qrSealed: null,
          qrExpiresAt: null,
        })
        .where(eq(whatsappSessions.id, id))
        .returning();
      await this.record(tx, operator, id, 'relink_started', 'whatsapp_session.relinked');
      return this.view(tx, updated ?? row);
    });
  }

  /** Stops a number's sending until an admin resumes it (`manual`). */
  async pause(operator: PlatformActor, id: string): Promise<PlatformWhatsAppSession> {
    return this.db.transaction(async (tx) => {
      const row = await lockSession(tx, id);
      assertWhatsAppSessionPause({ ...row, state: row.state as WhatsAppSessionState }, true);
      const [updated] = await tx
        .update(whatsappSessions)
        .set({ pausedAt: sql`now()`, pauseReason: 'manual' })
        .where(eq(whatsappSessions.id, id))
        .returning();
      await this.record(tx, operator, id, 'paused', 'whatsapp_session.paused', 'manual');
      return this.view(tx, updated ?? row);
    });
  }

  /** Resumes a paused number, by hand or after three failed sends (rule 6). */
  async resume(operator: PlatformActor, id: string): Promise<PlatformWhatsAppSession> {
    return this.db.transaction(async (tx) => {
      const row = await lockSession(tx, id);
      assertWhatsAppSessionPause({ ...row, state: row.state as WhatsAppSessionState }, false);
      const [updated] = await tx
        .update(whatsappSessions)
        .set({ pausedAt: null, pauseReason: null, consecutiveFailures: 0 })
        .where(eq(whatsappSessions.id, id))
        .returning();
      await this.record(
        tx,
        operator,
        id,
        'resumed',
        'whatsapp_session.resumed',
        row.pauseReason ?? undefined,
      );
      return this.view(tx, updated ?? row);
    });
  }

  /**
   * Unlinks a number (edge case 7: even the last healthy one): its credentials, known recipients
   * and queued messages are deleted and the session is archived. A queued OTP is not the number's
   * own: it is handed back to any healthy number within its deadline (rule 12). The lease stays,
   * so the gateway holding it sees the archived session and logs the link out.
   */
  async unlink(operator: PlatformActor, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockSession(tx, id);
      assertWhatsAppSessionStateChange(row.state as WhatsAppSessionState, 'unlinked', 'admin');
      await tx.delete(whatsappSessionCredentials).where(eq(whatsappSessionCredentials.sessionId, id));
      await tx.delete(whatsappKnownRecipients).where(eq(whatsappKnownRecipients.sessionId, id));
      const queued = and(eq(whatsappMessages.sessionId, id), eq(whatsappMessages.status, 'queued'));
      await tx.delete(whatsappMessages).where(and(queued, ne(whatsappMessages.kind, 'otp')));
      await tx
        .update(whatsappMessages)
        .set({ sessionId: null })
        .where(and(queued, eq(whatsappMessages.kind, 'otp')));
      await tx
        .update(whatsappSessions)
        .set({
          state: 'unlinked',
          archivedAt: sql`now()`,
          qrSealed: null,
          qrExpiresAt: null,
        })
        .where(eq(whatsappSessions.id, id));
      await this.record(tx, operator, id, 'unlinked', 'whatsapp_session.unlinked');
    });
  }

  /** The admin's session event and platform audit entry, in the change's transaction. */
  private async record(
    tx: Transaction,
    operator: PlatformActor,
    sessionId: string,
    type: WhatsAppSessionEventType,
    action: AuditAction,
    reason?: string,
  ): Promise<void> {
    await tx.insert(whatsappSessionEvents).values({
      sessionId,
      type,
      reason: reason ?? null,
      platformUserId: operator.userId,
    });
    await auditPlatform(tx, operator, {
      action,
      entityType: 'whatsapp_session',
      entityId: sessionId,
      details: reason ? { reason } : null,
    });
  }

  private async view(tx: Transaction, row: WhatsAppSessionRow): Promise<PlatformWhatsAppSession> {
    const { now, usage } = await this.usage(tx, row.id);
    return toPlatformWhatsAppSession(row, usage.get(row.id) ?? NO_USAGE, now);
  }

  /**
   * Each unarchived number's sends over the rolling windows, from `sent_at` against the database's
   * clock (rule 11). Counts start at the number's `linked_at`, as in `whatsappNumberCandidates`: a
   * re-link with another phone warms up from day 1 (edge case 6).
   */
  private async usage(
    tx: Transaction,
    onlyId?: string,
  ): Promise<{ now: Date; usage: Map<string, WhatsAppSessionUsage> }> {
    const now = await databaseNow(tx);
    const result = await tx.execute<UsageRow>(sql`
      select
        s.id,
        count(*) filter (where m.sent_at > now() - interval '1 hour')::int as sent_last_hour,
        count(m.id)::int as sent_last_24h,
        count(*) filter (where m.first_contact)::int as first_contacts_last_24h
      from whatsapp_sessions s
      join whatsapp_messages m
        on m.session_id = s.id
        and m.sent_at > now() - interval '24 hours'
        and m.sent_at >= s.linked_at
      where s.archived_at is null
        and (${onlyId ?? null}::uuid is null or s.id = ${onlyId ?? null}::uuid)
      group by s.id
    `);
    return {
      now,
      usage: new Map(
        result.rows.map((row) => [
          row.id,
          {
            sentLastHour: row.sent_last_hour,
            sentLast24h: row.sent_last_24h,
            firstContactsLast24h: row.first_contacts_last_24h,
          },
        ]),
      ),
    };
  }
}

async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select now() as now`);
  return new Date(result.rows[0]?.now as Date);
}

async function sessionById(tx: Transaction, id: string): Promise<WhatsAppSessionRow> {
  const [row] = await tx
    .select()
    .from(whatsappSessions)
    .where(and(eq(whatsappSessions.id, id), isNull(whatsappSessions.archivedAt)));
  if (!row) throw notFound();
  return row;
}

/** The session locked for a change; archived (unlinked) sessions are gone for the console. */
async function lockSession(tx: Transaction, id: string): Promise<WhatsAppSessionRow> {
  const [row] = await tx
    .select()
    .from(whatsappSessions)
    .where(and(eq(whatsappSessions.id, id), isNull(whatsappSessions.archivedAt)))
    .for('update');
  if (!row) throw notFound();
  return row;
}
