import {
  chooseWhatsAppNumber,
  type MessageKind,
  type MessageTemplateKey,
  type MessageTemplateParams,
  messageDeadlineSeconds,
  messageTemplates,
  type WhatsAppNumberCandidate,
  whatsappPolicy,
} from '@vertex-food/contracts';
import type { KeyedHash, SecretBox } from '@vertex-food/crypto';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Transaction } from './client.js';
import { whatsappMessages } from './schema/messaging.js';

// The one way to queue a WhatsApp message (spec S03 rules 16–17, ADR 0034), shared by the API's
// OTP sender, the gateway (alerts, replies) and, from S14, the worker's notification jobs. Every
// caller passes the messaging keys (`MESSAGING_HASH_KEY`, `MESSAGING_ENCRYPTION_KEY`), never
// identity's. Counts and deadlines use the database's clock (rule 11).

/** The messaging keys: recipients hashed, recipients, parameters and bodies sealed. */
export interface MessagingCrypto {
  hash: KeyedHash;
  box: SecretBox;
}

const RECIPIENT_PURPOSE = 'whatsapp-recipient';

/** What a sealed value of a message is, bound to its row so a copy elsewhere never opens. */
export type WhatsAppSealedField = 'recipient' | 'params' | 'body';

export function whatsappSealContext(messageId: string, field: WhatsAppSealedField): string {
  return `whatsapp-message:${messageId}:${field}`;
}

/** The keyed hash of an E.164 phone, the only form of a recipient stored outside a sealed box. */
export function whatsappRecipientHash(crypto: MessagingCrypto, phone: string): string {
  return crypto.hash.hash(RECIPIENT_PURPOSE, phone);
}

const E164 = /^\+[0-9]{8,15}$/;

export type EnqueueWhatsAppMessage<Key extends MessageTemplateKey = MessageTemplateKey> = {
  kind: MessageKind;
  template: Key;
  /** E.164; stored only hashed and sealed. */
  phone: string;
  params: MessageTemplateParams<Key>;
  /** For `opt_reply` and `auto_reply`: the number that received the message (rule 13). */
  sessionId?: string;
  /** For `otp`: the challenge whose delivery status follows the message (rule 19). */
  otpChallengeId?: string;
  /** For `notification`: the outbox event that made it, so a job run twice queues once. */
  sourceEventId?: string;
};

export type EnqueueResult =
  | { queued: true; messageId: string; duplicate: boolean }
  | { queued: false; reason: 'opted_out' };

/**
 * Queues one message in the caller's transaction (rule 16): checks the parameters against the
 * template's schema and the template's kind, refuses a `notification` to an opted-out phone
 * without inserting anything, hashes and seals the phone, seals the parameters, sets the deadline
 * and runs `NOTIFY whatsapp_messages`, which wakes the gateway when the transaction commits. A
 * second call with the same `sourceEventId` returns the first message.
 */
export async function enqueueWhatsAppMessage<Key extends MessageTemplateKey>(
  tx: Transaction,
  crypto: MessagingCrypto,
  input: EnqueueWhatsAppMessage<Key>,
): Promise<EnqueueResult> {
  // Widened: S03 has no notification template yet, so the narrowed kinds would hide that branch.
  const template: { kind: MessageKind; params: { parse(value: unknown): unknown } } =
    messageTemplates[input.template];
  // Programming errors, never shown to anyone: the message names codes only.
  if (template.kind !== input.kind) {
    throw new Error(`Template ${input.template} is not of kind ${input.kind}`);
  }
  if (!E164.test(input.phone)) throw new Error('The recipient is not an E.164 phone');
  const params = template.params.parse(input.params);

  const recipientHash = whatsappRecipientHash(crypto, input.phone);
  if (input.kind === 'notification' && (await isWhatsAppOptedOut(tx, recipientHash))) {
    return { queued: false, reason: 'opted_out' };
  }

  const id = uuidv7();
  const deadline = messageDeadlineSeconds(input.template);
  const [row] = await tx
    .insert(whatsappMessages)
    .values({
      id,
      kind: input.kind,
      template: input.template,
      sessionId: input.sessionId ?? null,
      recipientHash,
      recipientSealed: crypto.box.seal(whatsappSealContext(id, 'recipient'), input.phone),
      paramsSealed: crypto.box.seal(whatsappSealContext(id, 'params'), JSON.stringify(params)),
      status: 'queued',
      deadlineAt: sql`now() + make_interval(secs => ${deadline})`,
      nextAttemptAt: sql`now()`,
      otpChallengeId: input.otpChallengeId ?? null,
      sourceEventId: input.sourceEventId ?? null,
    })
    .onConflictDoNothing({ target: whatsappMessages.sourceEventId })
    .returning({ id: whatsappMessages.id });

  if (!row) {
    // Only `source_event_id` is a conflict target: the event already made its message.
    const existing = await tx.execute<{ id: string }>(
      sql`select id from whatsapp_messages where source_event_id = ${input.sourceEventId ?? null}`,
    );
    const first = existing.rows[0];
    if (!first) throw new Error('The message of this source event disappeared');
    return { queued: true, messageId: first.id, duplicate: true };
  }
  await tx.execute(sql`select pg_notify('whatsapp_messages', '')`);
  return { queued: true, messageId: row.id, duplicate: false };
}

/** Opted out (rule 27): `opted_out_at` set and later than `opted_in_at`, or that unset. */
export async function isWhatsAppOptedOut(tx: Transaction, recipientHash: string): Promise<boolean> {
  const result = await tx.execute<{ opted_out: boolean }>(sql`
    select exists (
      select 1 from whatsapp_opt_outs
      where recipient_hash = ${recipientHash}
        and opted_out_at is not null
        and (opted_in_at is null or opted_out_at > opted_in_at)
    ) as opted_out
  `);
  return result.rows[0]?.opted_out === true;
}

type CandidateRow = {
  id: string;
  linked_at: Date | null;
  last_sent_at: Date | null;
  sent_last_hour: number;
  sent_last_24h: number;
  first_contacts_last_24h: number;
  known: boolean;
  recipient_last_minute: number;
  recipient_last_hour: number;
  recipient_last_day: number;
  now: Date;
};

/**
 * The healthy platform numbers (rule 2) with their rolling counts and this recipient's, read in
 * one statement against the database's clock (rule 11), as `chooseWhatsAppNumber` takes them.
 * `onlySessionId` limits them to one number (replies, rule 13). A number's counts start at its
 * `linked_at`; a recipient's span every number. The gap after a number's last send is not stored,
 * so it counts as the longest one.
 */
export async function whatsappNumberCandidates(
  tx: Transaction,
  recipientHash: string,
  onlySessionId?: string,
): Promise<{ now: Date; candidates: WhatsAppNumberCandidate[] }> {
  const result = await tx.execute<CandidateRow>(sql`
    with recipient as (
      select
        count(*) filter (where sent_at > now() - interval '1 minute')::int as last_minute,
        count(*) filter (where sent_at > now() - interval '1 hour')::int as last_hour,
        count(*)::int as last_day
      from whatsapp_messages
      where recipient_hash = ${recipientHash}
        and kind <> 'otp'
        and sent_at > now() - interval '24 hours'
    )
    select
      s.id,
      s.linked_at,
      sends.last_sent_at,
      sends.sent_last_hour,
      sends.sent_last_24h,
      sends.first_contacts_last_24h,
      exists (
        select 1 from whatsapp_known_recipients k
        where k.session_id = s.id and k.recipient_hash = ${recipientHash}
      ) as known,
      recipient.last_minute as recipient_last_minute,
      recipient.last_hour as recipient_last_hour,
      recipient.last_day as recipient_last_day,
      now() as now
    from whatsapp_sessions s
    cross join recipient
    cross join lateral (
      select
        max(m.sent_at) as last_sent_at,
        count(*) filter (where m.sent_at > now() - interval '1 hour')::int as sent_last_hour,
        count(*)::int as sent_last_24h,
        count(*) filter (where m.first_contact)::int as first_contacts_last_24h
      from whatsapp_messages m
      -- Only the current link's sends: a re-link with another phone restarts linked_at and
      -- warms up from day 1 (rule 5, edge case 6), the old phone's sends no longer count.
      where m.session_id = s.id
        and m.sent_at > now() - interval '24 hours'
        and m.sent_at >= s.linked_at
    ) sends
    where s.archived_at is null
      and s.state = 'connected'
      and s.paused_at is null
      and s.lease_expires_at > now()
      and (${onlySessionId ?? null}::uuid is null or s.id = ${onlySessionId ?? null}::uuid)
    order by s.id
  `);
  const now = result.rows[0]?.now ?? (await databaseNow(tx));
  return {
    now: new Date(now),
    candidates: result.rows.map((row) => ({
      id: row.id,
      stats: {
        linkedAt: row.linked_at && new Date(row.linked_at),
        lastSentAt: row.last_sent_at && new Date(row.last_sent_at),
        gapSeconds: whatsappPolicy.gapSeconds.max,
        sentLastHour: row.sent_last_hour,
        sentLast24h: row.sent_last_24h,
        firstContactsLast24h: row.first_contacts_last_24h,
      },
      recipient: {
        knownToNumber: row.known,
        sentLastMinute: row.recipient_last_minute,
        sentLastHour: row.recipient_last_hour,
        sentLastDay: row.recipient_last_day,
      },
    })),
  };
}

async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select now() as now`);
  return new Date(result.rows[0]?.now as Date);
}

/**
 * Whether some healthy platform number could send a message of `kind` to this recipient now
 * (rule 17), and which: the API's OTP sender refuses a sign-in without one (rule 18), and the
 * console's health reads it for `otpAvailable`.
 */
export async function sendAvailability(
  tx: Transaction,
  recipientHash: string,
  kind: MessageKind,
  onlySessionId?: string,
): Promise<{ sessionId: string; firstContact: boolean } | undefined> {
  const { now, candidates } = await whatsappNumberCandidates(tx, recipientHash, onlySessionId);
  const chosen = chooseWhatsAppNumber(candidates, kind, now);
  return chosen && { sessionId: chosen.id, firstContact: chosen.budget.firstContact };
}
