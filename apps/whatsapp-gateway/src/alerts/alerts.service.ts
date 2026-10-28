import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ConsolePermission,
  type ConsoleRole,
  effectiveConsolePermissions,
  type WhatsAppAlertEvent,
  whatsappPolicy,
} from '@vertex-food/contracts';
import {
  type Database,
  enqueueWhatsAppMessage,
  isWhatsAppOptedOut,
  type MessagingCrypto,
  platformUsers,
  type Transaction,
  whatsappRecipientHash,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, MESSAGING_CRYPTO } from '../core/database/database.module.js';

/** The events about one number; the other two are about all of them. */
type SessionAlert = Exclude<WhatsAppAlertEvent, 'none_healthy' | 'healthy_again'>;

/** Serializes the healthy-count check across gateway instances (an advisory lock key). */
const HEALTH_LOCK = 0x5703_0029;

/**
 * Alerts to Vertex admins (spec S03 rules 29–30): an `alert` message to every active platform
 * user holding `console.messaging.manage` who has not opted out, naming the number's label and
 * the event, never a phone or a person. At most once per session and event every 30 minutes,
 * recorded as `alert_sent`. Alerts are queued even when no number is healthy: they wait until
 * their deadline, and the console banner is the signal meanwhile.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MESSAGING_CRYPTO) private readonly crypto: MessagingCrypto,
  ) {}

  /** A number needs a re-link, was banned, stayed disconnected or was paused by failures. */
  async raise(sessionId: string, event: SessionAlert): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [session] = await tx
        .select({ label: whatsappSessions.label })
        .from(whatsappSessions)
        .where(and(eq(whatsappSessions.id, sessionId), isNull(whatsappSessions.archivedAt)))
        .for('update');
      if (!session || (await this.alertedLately(tx, sessionId, event))) return;
      await this.send(tx, sessionId, session.label, event);
    });
  }

  /**
   * Rule 29's disconnections: every number disconnected for more than 5 minutes since its last
   * `disconnected` event, alerted once for that disconnection.
   */
  async checkDisconnected(): Promise<void> {
    const overdue = await this.db.execute<{ id: string }>(sql`
      select s.id from whatsapp_sessions s
      cross join lateral (
        select max(e.created_at) as at from whatsapp_session_events e
        where e.session_id = s.id and e.type = 'disconnected'
      ) since
      where s.archived_at is null
        and s.state = 'disconnected'
        and since.at < now() - make_interval(mins => ${whatsappPolicy.disconnectAlertMinutes})
        and not exists (
          select 1 from whatsapp_session_events a
          where a.session_id = s.id and a.type = 'alert_sent' and a.reason = 'disconnected'
            and a.created_at > since.at
        )
    `);
    for (const { id } of overdue.rows) await this.raise(id, 'disconnected');
  }

  /**
   * Rule 29's healthy count: `none_healthy` when it falls to zero once a number was ever linked,
   * `healthy_again` when it rises back after that alert. Each is recorded on the number it is
   * about: the last to change for `none_healthy`, the healthy one for `healthy_again`. Only the
   * current (unarchived) numbers' alerts count as the last one.
   */
  async checkHealth(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${HEALTH_LOCK})`);
      const numbers = await tx.execute<{ id: string; label: string; healthy: boolean }>(sql`
        select id, label,
          (state = 'connected' and paused_at is null and lease_expires_at > now()) as healthy
        from whatsapp_sessions
        where archived_at is null and linked_at is not null
        order by healthy desc, updated_at desc
      `);
      const [first] = numbers.rows;
      if (!first) return;
      const last = await tx.execute<{ reason: WhatsAppAlertEvent }>(sql`
        select e.reason from whatsapp_session_events e
        join whatsapp_sessions s on s.id = e.session_id and s.archived_at is null
        where e.type = 'alert_sent' and e.reason in ('none_healthy', 'healthy_again')
        order by e.created_at desc, e.id desc limit 1
      `);
      const previous = last.rows[0]?.reason;
      const event: WhatsAppAlertEvent | undefined =
        !first.healthy && previous !== 'none_healthy'
          ? 'none_healthy'
          : first.healthy && previous === 'none_healthy'
            ? 'healthy_again'
            : undefined;
      if (!event || (await this.alertedLately(tx, first.id, event))) return;
      await this.send(tx, first.id, first.label, event);
    });
  }

  private async alertedLately(
    tx: Transaction,
    sessionId: string,
    event: WhatsAppAlertEvent,
  ): Promise<boolean> {
    const recent = await tx.execute(sql`
      select 1 from whatsapp_session_events
      where session_id = ${sessionId} and type = 'alert_sent' and reason = ${event}
        and created_at > now() - make_interval(mins => ${whatsappPolicy.alertThrottleMinutes})
      limit 1
    `);
    return recent.rows.length > 0;
  }

  private async send(
    tx: Transaction,
    sessionId: string,
    label: string,
    event: WhatsAppAlertEvent,
  ): Promise<void> {
    let queued = 0;
    for (const phone of await this.recipients(tx)) {
      // Rule 27: an admin who opted out gets no alert; the console banner still shows.
      if (await isWhatsAppOptedOut(tx, whatsappRecipientHash(this.crypto, phone))) continue;
      await enqueueWhatsAppMessage(tx, this.crypto, {
        kind: 'alert',
        template: 'alert',
        phone,
        params: { label, event },
      });
      queued++;
    }
    await tx
      .insert(whatsappSessionEvents)
      .values({ id: uuidv7(), sessionId, type: 'alert_sent', reason: event });
    this.logger.log(`Alert ${event} for session ${sessionId} queued to ${queued} admins`);
  }

  /** Rule 29: active platform users whose effective permissions hold messaging management. */
  private async recipients(tx: Transaction): Promise<string[]> {
    const users = await tx
      .select({
        phone: platformUsers.phone,
        role: platformUsers.role,
        granted: platformUsers.grantedPermissions,
        revoked: platformUsers.revokedPermissions,
      })
      .from(platformUsers)
      .where(and(eq(platformUsers.status, 'active'), isNull(platformUsers.archivedAt)));
    return users
      .filter((user) =>
        effectiveConsolePermissions(
          user.role as ConsoleRole,
          user.granted as ConsolePermission[],
          user.revoked as ConsolePermission[],
        ).includes('console.messaging.manage'),
      )
      .map((user) => user.phone);
  }
}
