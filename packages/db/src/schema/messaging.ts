import { eq, isNull, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { otpChallenges, platformUsers } from './identity.js';

// WhatsApp messaging (spec S03, ADR 0012, ADR 0034), copied from Vertex Shifa and adapted.
// Platform scope: Vertex's own numbers and keyed hashes of recipients, never tenant data.
// Recipients' phones are stored only sealed (AES-256-GCM, `MESSAGING_ENCRYPTION_KEY`) or as keyed
// hashes (`MESSAGING_HASH_KEY`); parameters, bodies and QR codes only sealed. Rate limits are
// counted from `whatsapp_messages.sent_at`. The value lists repeat `messaging.ts` in
// @vertex-food/contracts (`test/messaging.test.ts` compares them).

/** `disconnectReasonSchema`: the library-neutral codes of the transport. */
const DISCONNECT_REASONS =
  "'restart_required', 'logged_out', 'forbidden', 'connection_replaced', 'connection_lost'";

/** `whatsappAlertEventSchema`: the `reason` of an `alert_sent` event (rule 29). */
const ALERT_EVENTS =
  "'needs_relink', 'banned', 'disconnected', 'paused_send_failures', 'none_healthy', 'healthy_again'";

/** `messageTemplates`: each template with its kind. */
const TEMPLATE_KINDS =
  "('otp', 'otp'), ('alert', 'alert'), ('opt_out_confirmed', 'opt_reply'), ('opt_in_confirmed', 'opt_reply'), ('auto_reply', 'auto_reply')";

/**
 * A platform WhatsApp number the gateway runs. The gateway instance holding the lease is the only
 * one connected to it. Unlinked sessions are archived.
 */
export const whatsappSessions = pgTable(
  'whatsapp_sessions',
  {
    id: id(),
    label: text().notNull(),
    /** E.164, Vertex's own number, set at the first link. */
    phone: text(),
    state: text().notNull(),
    pausedAt: timestamptz(),
    pauseReason: text(),
    /** The first `open` after a QR scan; the warm-up age counts from it. */
    linkedAt: timestamptz(),
    qrSealed: text(),
    qrExpiresAt: timestamptz(),
    linkDeadlineAt: timestamptz(),
    lastConnectedAt: timestamptz(),
    /** The library-neutral disconnect reason code. */
    lastDisconnectReason: text(),
    consecutiveFailures: smallint().notNull().default(0),
    leaseHolder: uuid(),
    leaseExpiresAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_sessions', t.id),
    check(
      'whatsapp_sessions_label',
      sql`char_length(${t.label}) between 2 and 40 and ${t.label} = btrim(${t.label})`,
    ),
    check('whatsapp_sessions_phone', sql`${t.phone} ~ '^\\+[0-9]{8,15}$'`),
    check(
      'whatsapp_sessions_state',
      sql`${t.state} in ('linking', 'connected', 'disconnected', 'needs_relink', 'banned', 'unlinked')`,
    ),
    check(
      'whatsapp_sessions_pause',
      sql`(${t.pausedAt} is null) = (${t.pauseReason} is null) and (${t.pauseReason} is null or ${t.pauseReason} in ('manual', 'send_failures'))`,
    ),
    check('whatsapp_sessions_qr', sql`(${t.qrSealed} is null) = (${t.qrExpiresAt} is null)`),
    check(
      'whatsapp_sessions_linking',
      sql`${t.state} <> 'linking' or ${t.linkDeadlineAt} is not null`,
    ),
    check(
      'whatsapp_sessions_lease',
      sql`(${t.leaseHolder} is null) = (${t.leaseExpiresAt} is null)`,
    ),
    check('whatsapp_sessions_consecutive_failures', sql`${t.consecutiveFailures} >= 0`),
    // Reason codes only, never a library's message (which can carry a WhatsApp address).
    check(
      'whatsapp_sessions_last_disconnect_reason',
      sql`${t.lastDisconnectReason} is null or ${t.lastDisconnectReason} in (${sql.raw(DISCONNECT_REASONS)})`,
    ),
    check(
      'whatsapp_sessions_unlinked_archived',
      sql`(${t.state} = 'unlinked') = (${t.archivedAt} is not null)`,
    ),
    uniqueIndex('whatsapp_sessions_label_idx').on(t.label).where(isNull(t.archivedAt)),
    uniqueIndex('whatsapp_sessions_phone_idx').on(t.phone).where(isNull(t.archivedAt)),
    index('whatsapp_sessions_state_idx').on(t.state).where(isNull(t.archivedAt)),
  ],
);

/**
 * Baileys' credentials and key store of a session as opaque sealed values (context
 * `whatsapp-credentials:<session id>`), deleted on re-link and unlink. Never exported or read by
 * people. The store's keys name WhatsApp addresses, so only their keyed hash is stored, bound to
 * the session: never a key in clear.
 */
export const whatsappSessionCredentials = pgTable(
  'whatsapp_session_credentials',
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => whatsappSessions.id),
    keyHash: text().notNull(),
    valueSealed: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_session_credentials', t.id),
    unique('whatsapp_session_credentials_session_key_hash_unique').on(t.sessionId, t.keyHash),
  ],
);

/** What happened to a session, by the gateway or an admin (`platform_user_id`). Append-only. */
export const whatsappSessionEvents = pgTable(
  'whatsapp_session_events',
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => whatsappSessions.id),
    type: text().notNull(),
    /** A reason code, never a library's message. */
    reason: text(),
    /** The admin who acted; null for the gateway. */
    platformUserId: uuid().references(() => platformUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_session_events', t.id),
    check(
      'whatsapp_session_events_type',
      sql`${t.type} in ('created', 'linked', 'connected', 'disconnected', 'needs_relink', 'banned', 'link_timeout', 'duplicate_number', 'paused', 'resumed', 'relink_started', 'unlinked', 'alert_sent')`,
    ),
    // Disconnect and pause reasons, and for `alert_sent` the alert's event (rule 29, throttled
    // per session and event).
    check(
      'whatsapp_session_events_reason',
      sql`${t.reason} is null or ${t.reason} in (${sql.raw(DISCONNECT_REASONS)}, 'manual', 'send_failures', ${sql.raw(ALERT_EVENTS)})`,
    ),
    index('whatsapp_session_events_session_created_idx').on(t.sessionId, t.createdAt),
    index('whatsapp_session_events_platform_user_idx').on(t.platformUserId),
  ],
);

/**
 * The send queue, claimed by the gateway in priority order (rule 14). The text is rendered at
 * claim time from the template and the sealed parameters; the sealed recipient, parameters and
 * body are cleared within an hour (rule 31) and rows are deleted after 30 days. Every transaction
 * that queues a message also runs `NOTIFY whatsapp_messages` (`enqueueWhatsAppMessage`).
 */
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: id(),
    kind: text().notNull(),
    template: text().notNull(),
    /** The number that claimed it; for replies, the number that received the message. */
    sessionId: uuid().references(() => whatsappSessions.id),
    recipientHash: text().notNull(),
    recipientSealed: text(),
    paramsSealed: text(),
    bodySealed: text(),
    status: text().notNull(),
    failureReason: text(),
    attempts: smallint().notNull().default(0),
    /** Set when sent: the number had never messaged this recipient. */
    firstContact: boolean(),
    deadlineAt: timestamptz().notNull(),
    nextAttemptAt: timestamptz().notNull(),
    transportMessageId: text(),
    otpChallengeId: uuid().references(() => otpChallenges.id),
    /** The outbox event that made it: one message per event. */
    sourceEventId: uuid(),
    sentAt: timestamptz(),
    deliveredAt: timestamptz(),
    readAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_messages', t.id),
    check(
      'whatsapp_messages_kind',
      sql`${t.kind} in ('otp', 'alert', 'notification', 'opt_reply', 'auto_reply')`,
    ),
    // Later specs add their `notification` templates to this list with the template.
    check(
      'whatsapp_messages_template',
      sql`(${t.template}, ${t.kind}) in (${sql.raw(TEMPLATE_KINDS)})`,
    ),
    check(
      'whatsapp_messages_status',
      sql`${t.status} in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'expired')`,
    ),
    check(
      'whatsapp_messages_failure_reason',
      sql`(${t.status} in ('failed', 'expired')) = (${t.failureReason} is not null) and (${t.failureReason} is null or ${t.failureReason} in ('transport_error', 'opted_out', 'deadline'))`,
    ),
    check('whatsapp_messages_attempts', sql`${t.attempts} >= 0`),
    check(
      'whatsapp_messages_reply_session',
      sql`${t.kind} not in ('opt_reply', 'auto_reply') or ${t.sessionId} is not null`,
    ),
    check(
      'whatsapp_messages_otp_challenge',
      sql`(${t.kind} = 'otp') = (${t.otpChallengeId} is not null)`,
    ),
    check(
      'whatsapp_messages_source_event',
      sql`${t.kind} <> 'notification' or ${t.sourceEventId} is not null`,
    ),
    check(
      'whatsapp_messages_sent',
      sql`(${t.status} in ('sent', 'delivered', 'read')) = (${t.sentAt} is not null)`,
    ),
    // The claim: queued messages by priority and due time.
    index('whatsapp_messages_claim_idx')
      .on(t.status, t.kind, t.nextAttemptAt)
      .where(eq(t.status, sql`'queued'`)),
    // A number's rolling rate windows (rules 7–11).
    index('whatsapp_messages_session_sent_idx').on(t.sessionId, t.sentAt),
    // A recipient's limits across numbers (rule 10).
    index('whatsapp_messages_recipient_sent_idx').on(t.recipientHash, t.sentAt),
    unique('whatsapp_messages_session_transport_id_unique').on(t.sessionId, t.transportMessageId),
    unique('whatsapp_messages_otp_challenge_unique').on(t.otpChallengeId),
    unique('whatsapp_messages_source_event_unique').on(t.sourceEventId),
  ],
);

/**
 * Recipients a number has sent to: its known recipients (rule 12) and the only senders whose
 * incoming messages it processes (rule 25). Derived from sends, so a queue: deleted with the
 * session's credentials on unlink and on a re-link to another phone.
 */
export const whatsappKnownRecipients = pgTable(
  'whatsapp_known_recipients',
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => whatsappSessions.id),
    recipientHash: text().notNull(),
    firstSentAt: timestamptz().notNull(),
    lastSentAt: timestamptz().notNull(),
    lastAutoReplyAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_known_recipients', t.id),
    unique('whatsapp_known_recipients_session_recipient_unique').on(t.sessionId, t.recipientHash),
  ],
);

/**
 * A person's choice to stop or restart the platform numbers' messages they did not request
 * (rules 26–27), ordered by the incoming message's time. Opted out while `opted_out_at` is set and
 * later than `opted_in_at`.
 */
export const whatsappOptOuts = pgTable(
  'whatsapp_opt_outs',
  {
    id: id(),
    recipientHash: text().notNull(),
    optedOutAt: timestamptz(),
    optedInAt: timestamptz(),
    lastKeywordAt: timestamptz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('whatsapp_opt_outs', t.id),
    check(
      'whatsapp_opt_outs_keyword',
      sql`${t.optedOutAt} is not null or ${t.optedInAt} is not null`,
    ),
    unique('whatsapp_opt_outs_recipient_unique').on(t.recipientHash),
  ],
);
