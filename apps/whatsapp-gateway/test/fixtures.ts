import type { MessageTemplateKey } from '@vertex-food/contracts';
import { KeyedHash, SecretBox } from '@vertex-food/crypto';
import {
  accounts,
  createDatabase,
  type EnqueueWhatsAppMessage,
  enqueueWhatsAppMessage,
  type MessagingCrypto,
  otpChallenges,
  platformUsers,
  whatsappMessages,
  whatsappRecipientHash,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { inject } from 'vitest';
import type { Gateway } from './gateway.js';
import { TEST_ENCRYPTION_KEY, TEST_HASH_KEY } from './gateway.js';

/** The owner role: seeds what the API would write and resets the messaging tables. */
export const db = createDatabase(inject('ownerUrl'));

export const crypto: MessagingCrypto = {
  hash: new KeyedHash(TEST_HASH_KEY),
  box: new SecretBox(TEST_ENCRYPTION_KEY),
};

export const hashOf = (phone: string) => whatsappRecipientHash(crypto, phone);

/**
 * Forgets every session, message, opt-out, admin and challenge of earlier tests: sessions are
 * archived (their events are append-only), the rest deleted.
 */
export async function resetMessaging(): Promise<void> {
  await db.execute(sql`
    update whatsapp_sessions set state = 'unlinked', archived_at = now(), lease_holder = null,
      lease_expires_at = null, qr_sealed = null, qr_expires_at = null, paused_at = null,
      pause_reason = null, phone = null
    where archived_at is null
  `);
  await db.execute(sql`delete from whatsapp_messages`);
  await db.execute(sql`delete from whatsapp_known_recipients`);
  await db.execute(sql`delete from whatsapp_session_credentials`);
  await db.execute(sql`delete from whatsapp_opt_outs`);
  await db.execute(sql`delete from otp_challenges`);
  await db.execute(sql`delete from accounts`);
  await db.execute(sql`update platform_users set status = 'disabled' where status <> 'disabled'`);
}

/** A number an admin added in the console, as the API writes it: `linking` for 3 minutes. */
export async function addSession(label: string): Promise<string> {
  const id = uuidv7();
  await db.insert(whatsappSessions).values({
    id,
    label,
    state: 'linking',
    linkDeadlineAt: sql`now() + interval '180 seconds'`,
  });
  await db.insert(whatsappSessionEvents).values({ id: uuidv7(), sessionId: id, type: 'created' });
  return id;
}

/** A number added, taken by the gateway and linked by a scan with `phone`: connected. */
export async function linkedSession(gateway: Gateway, label: string, phone: string) {
  const id = await addSession(label);
  await gateway.tick();
  await gateway.transport.scan(id, phone);
  await gateway.settle();
  return id;
}

/** The API's re-link: credentials deleted, `linking` with a new deadline, QR cleared. */
export async function relink(sessionId: string): Promise<void> {
  await db.execute(sql`delete from whatsapp_session_credentials where session_id = ${sessionId}`);
  await db
    .update(whatsappSessions)
    .set({
      state: 'linking',
      linkDeadlineAt: sql`now() + interval '180 seconds'`,
      qrSealed: null,
      qrExpiresAt: null,
    })
    .where(eq(whatsappSessions.id, sessionId));
}

/**
 * The API's unlink (PR 3): credentials, known recipients and queued messages deleted, except
 * queued OTPs, handed back to any number (`session_id` null); archived, QR cleared, the lease
 * kept so its holder logs the link out.
 */
export async function unlink(sessionId: string): Promise<void> {
  await db.execute(sql`delete from whatsapp_session_credentials where session_id = ${sessionId}`);
  await db.execute(sql`delete from whatsapp_known_recipients where session_id = ${sessionId}`);
  await db.execute(sql`
    delete from whatsapp_messages
    where session_id = ${sessionId} and status = 'queued' and kind <> 'otp'
  `);
  await db.execute(sql`
    update whatsapp_messages set session_id = null
    where session_id = ${sessionId} and status = 'queued' and kind = 'otp'
  `);
  await db
    .update(whatsappSessions)
    .set({ state: 'unlinked', archivedAt: sql`now()`, qrSealed: null, qrExpiresAt: null })
    .where(eq(whatsappSessions.id, sessionId));
}

export async function session(id: string) {
  const [row] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, id));
  if (!row) throw new Error('No such session');
  return row;
}

export async function events(sessionId: string) {
  const rows = await db
    .select({ type: whatsappSessionEvents.type, reason: whatsappSessionEvents.reason })
    .from(whatsappSessionEvents)
    .where(eq(whatsappSessionEvents.sessionId, sessionId))
    .orderBy(asc(whatsappSessionEvents.createdAt), asc(whatsappSessionEvents.id));
  return rows.map((row) => (row.reason ? `${row.type}:${row.reason}` : row.type));
}

/** Queues a message through the shared writer, as the API or the worker would. */
export async function enqueue<Key extends MessageTemplateKey>(
  input: EnqueueWhatsAppMessage<Key>,
): Promise<string> {
  const result = await db.transaction((tx) => enqueueWhatsAppMessage(tx, crypto, input));
  if (!result.queued) throw new Error('Not queued');
  return result.messageId;
}

export async function message(id: string) {
  const [row] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, id));
  if (!row) throw new Error('No such message');
  return row;
}

/** Moves every send back 15 s, past the longest gap (rule 7), so the next one may go now. */
export async function pastGaps(): Promise<void> {
  await db.execute(
    sql`update whatsapp_messages set sent_at = sent_at - interval '15 seconds' where sent_at is not null`,
  );
}

/** An account with a new-device OTP challenge, as S02 creates it with the gateway sender. */
export async function otpChallenge(phone: string): Promise<string> {
  await db.insert(accounts).values({ id: uuidv7(), phone }).onConflictDoNothing();
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.phone, phone));
  const accountId = account?.id as string;
  const id = uuidv7();
  await db.insert(otpChallenges).values({
    id,
    accountId,
    purpose: 'new_device',
    codeHash: 'synthetic-code-hash',
    expiresAt: sql`now() + interval '5 minutes'`,
    deliveryStatus: 'queued',
  });
  return id;
}

export async function deliveryStatus(challengeId: string): Promise<string> {
  const [row] = await db
    .select({ status: otpChallenges.deliveryStatus })
    .from(otpChallenges)
    .where(eq(otpChallenges.id, challengeId));
  return row?.status ?? 'missing';
}

const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGlj$c3ludGhldGljaGFzaA';

/** An active platform user (an admin by default) who may receive alerts. */
export async function platformUser(
  phone: string,
  role: 'admin' | 'support' = 'admin',
  adjust: { revoked?: string[]; status?: 'active' | 'disabled' } = {},
): Promise<void> {
  await db
    .insert(platformUsers)
    .values({
      id: uuidv7(),
      phone,
      name: 'مشرف تجريبي',
      role,
      revokedPermissions: adjust.revoked ?? [],
      status: adjust.status ?? 'active',
      passwordHash: PASSWORD_HASH,
      totpSecret: 'synthetic-sealed-secret',
    })
    .onConflictDoUpdate({
      target: platformUsers.phone,
      set: { role, revokedPermissions: adjust.revoked ?? [], status: adjust.status ?? 'active' },
    });
}

/** The phones of queued alerts, opened as the gateway opens them. */
export async function alertRecipients(): Promise<string[]> {
  const rows = await db
    .select({ id: whatsappMessages.id, recipientSealed: whatsappMessages.recipientSealed })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.kind, 'alert'));
  return rows
    .map((row) =>
      crypto.box.open(`whatsapp-message:${row.id}:recipient`, row.recipientSealed ?? ''),
    )
    .filter((phone): phone is string => phone !== undefined)
    .sort();
}
