import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  createDatabase,
  otpChallenges,
  platformAuditEntries,
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappRecipientHash,
  whatsappSealContext,
  whatsappSessionCredentials,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { messagingCrypto, whatsappQrSealContext } from '../src/modules/platform/messaging/index.js';
import { createTestApp, TEST_MESSAGING_ENV } from './app.js';
import { asConsoleUser, type ConsoleUser, consoleUser, reauthenticate } from './console.js';
import { client, PASSWORD, proofOfWork, TestApi } from './staff.js';

// Spec S03, the API's part (PR 3): the gateway OTP sender (availability, the sealed queued
// message, a failed delivery expiring the challenge without the cooldown), the delivery route and
// its limit, and the console's platform numbers with re-authentication, transitions, the session
// limit, usage counted from `linked_at`, events and the platform audit.

const MINUTE = 60_000;
const crypto = messagingCrypto({
  hashKey: Buffer.from(TEST_MESSAGING_ENV.MESSAGING_HASH_KEY, 'base64'),
  encryptionKey: Buffer.from(TEST_MESSAGING_ENV.MESSAGING_ENCRYPTION_KEY, 'base64'),
});

let app: INestApplication;
let api: GatewayTestApi;
const db = createDatabase(inject('databaseUrl'));

/** Codes come from the queued message, opened with this run's messaging key. */
class GatewayTestApi extends TestApi {
  override async lastCode(accountId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: whatsappMessages.id, params: whatsappMessages.paramsSealed })
      .from(whatsappMessages)
      .innerJoin(otpChallenges, eq(otpChallenges.id, whatsappMessages.otpChallengeId))
      .where(eq(otpChallenges.accountId, accountId))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!row?.params) return undefined;
    const params = crypto.box.open(whatsappSealContext(row.id, 'params'), row.params);
    return params === undefined ? undefined : (JSON.parse(params) as { code: string }).code;
  }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp({ otpSender: 'gateway' });
  api = new GatewayTestApi(app, db);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
});

/** Every test starts with no platform number: the earlier ones are archived as unlinked. */
beforeEach(async () => {
  await db
    .update(whatsappSessions)
    .set({ state: 'unlinked', archivedAt: sql`now()`, qrSealed: null, qrExpiresAt: null })
    .where(isNull(whatsappSessions.archivedAt));
});

let numberCount = 0;

/** A platform number as the gateway leaves it: connected, its lease held, linked `days` ago. */
async function platformNumber(
  options: { days?: number; state?: string; leaseSeconds?: number; label?: string } = {},
) {
  numberCount += 1;
  const [row] = await db
    .insert(whatsappSessions)
    .values({
      label: options.label ?? `رقم ${numberCount}-${randomUUID().slice(0, 8)}`,
      phone: `+999${String(numberCount).padStart(9, '0')}`,
      state: options.state ?? 'connected',
      linkedAt: sql`now() - make_interval(days => ${options.days ?? 30})`,
      linkDeadlineAt: options.state === 'linking' ? sql`now() + interval '3 minutes'` : null,
      lastConnectedAt: sql`now()`,
      leaseHolder: randomUUID(),
      leaseExpiresAt: sql`now() + make_interval(secs => ${options.leaseSeconds ?? 3600})`,
    })
    .returning();
  if (!row) throw new Error('No session');
  return row;
}

/** An owner with a password, signed in once (through a platform number). */
async function ownerWithPassword() {
  const number = await platformNumber();
  const tenant = await api.newTenant();
  await api.firstSignIn(tenant.ownerPhone);
  return { ...tenant, number };
}

/** A password sign-in on a new PC, without moving the clock: answers the HTTP response. */
async function passwordSignIn(phone: string) {
  const solved = await proofOfWork(app);
  return client(app)
    .post('/api/auth/sign-in')
    .send({ phone, password: PASSWORD, intent: 'register_device', proofOfWork: solved });
}

async function challenge(id: string) {
  const [row] = await db.select().from(otpChallenges).where(eq(otpChallenges.id, id));
  return row;
}

const delivery = (id: string) => client(app).get(`/api/auth/otp/${id}/delivery`);

describe('the gateway OTP sender (rules 18–22)', () => {
  it('queues a new-device code sealed for the gateway, and its delivery is readable', async () => {
    const { ownerPhone } = await ownerWithPassword();
    vi.setSystemTime(Date.now() + 61_000);
    const started = await passwordSignIn(ownerPhone);
    expect(started.status).toBe(200);
    expect(started.body.step).toBe('otp');
    const challengeId = started.body.challengeId as string;

    expect((await challenge(challengeId))?.deliveryStatus).toBe('queued');
    const [message] = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.otpChallengeId, challengeId));
    expect(message).toMatchObject({
      kind: 'otp',
      template: 'otp',
      status: 'queued',
      sessionId: null,
      recipientHash: whatsappRecipientHash(crypto, ownerPhone),
    });
    if (!message?.recipientSealed || !message.paramsSealed) throw new Error('Not sealed');
    expect(
      crypto.box.open(whatsappSealContext(message.id, 'recipient'), message.recipientSealed),
    ).toBe(ownerPhone);
    const code = await api.lastCode(await api.accountId(ownerPhone));
    expect(code).toMatch(/^[0-9]{6}$/);
    // Nothing of the phone or the code in clear.
    expect(JSON.stringify(message)).not.toContain(ownerPhone);
    expect(JSON.stringify(message)).not.toContain(code);
    // The deadline is 60 s on the database's clock (rule 20).
    const seconds = (message.deadlineAt.getTime() - message.createdAt.getTime()) / 1000;
    expect(seconds).toBeCloseTo(60, 0);

    expect((await delivery(challengeId).expect(200)).body).toEqual({ status: 'queued' });
    await db
      .update(otpChallenges)
      .set({ deliveryStatus: 'delivered' })
      .where(eq(otpChallenges.id, challengeId));
    expect((await delivery(challengeId).expect(200)).body).toEqual({ status: 'delivered' });

    await client(app)
      .post('/api/auth/otp/verify')
      .send({ challengeId, code, intent: 'register_device' })
      .expect(200);
  });

  it('refuses a new-device sign-in when no number could send, with no cooldown after it', async () => {
    const { ownerPhone, number } = await ownerWithPassword();
    await db
      .update(whatsappSessions)
      .set({ pausedAt: sql`now()`, pauseReason: 'manual' })
      .where(eq(whatsappSessions.id, number.id));
    vi.setSystemTime(Date.now() + 61_000);

    const refused = await passwordSignIn(ownerPhone);
    expect(refused.body.code).toBe('OTP_DELIVERY_UNAVAILABLE');
    const accountId = await api.accountId(ownerPhone);
    const [failed] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.accountId, accountId))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    expect(failed).toMatchObject({ purpose: 'new_device', deliveryStatus: 'failed' });
    expect(failed?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      await db
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.otpChallengeId, failed?.id as string)),
    ).toEqual([]);
    expect((await delivery(failed?.id as string).expect(200)).body).toEqual({ status: 'failed' });

    // Edge case 3: the next try is allowed at once, not after the minute.
    await db
      .update(whatsappSessions)
      .set({ pausedAt: null, pauseReason: null })
      .where(eq(whatsappSessions.id, number.id));
    const retried = await passwordSignIn(ownerPhone);
    expect(retried.status).toBe(200);
    expect(retried.body.step).toBe('otp');
  });

  it('expires a code whose delivery failed later, and still counts it toward 3 an hour', async () => {
    const { ownerPhone } = await ownerWithPassword();
    const accountId = await api.accountId(ownerPhone);
    // The first sign-in's code counts too: two more new-device codes reach the hourly 3.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      vi.setSystemTime(Date.now() + (attempt === 0 ? 61_000 : 1_000));
      const started = await passwordSignIn(ownerPhone);
      expect(started.body.step).toBe('otp');
      const challengeId = started.body.challengeId as string;
      const code = await api.lastCode(accountId);
      // The gateway marks the challenge as its message failed or expired (rule 19).
      await db
        .update(otpChallenges)
        .set({ deliveryStatus: 'failed' })
        .where(eq(otpChallenges.id, challengeId));
      const verified = await client(app)
        .post('/api/auth/otp/verify')
        .send({ challengeId, code, intent: 'register_device' });
      expect(verified.body.code).toBe('OTP_EXPIRED');
    }
    vi.setSystemTime(Date.now() + 1_000);
    expect((await passwordSignIn(ownerPhone)).body.code).toBe('RATE_LIMITED');
  });

  it('keeps a first sign-in quiet when no number could send (S02 rule 13)', async () => {
    const tenant = await api.newTenant();
    const solved = await proofOfWork(app);
    const requested = await client(app)
      .post('/api/auth/otp/request')
      .send({
        phone: tenant.ownerPhone,
        purpose: 'first_sign_in',
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    const challengeId = requested.body.challengeId as string;
    expect((await challenge(challengeId))?.deliveryStatus).toBe('failed');
    expect((await delivery(challengeId).expect(200)).body).toEqual({ status: 'unknown' });
  });
});

describe('GET /api/auth/otp/{challengeId}/delivery (rule 21)', () => {
  it('answers unknown for a first sign-in, a decoy and an unknown id', async () => {
    await platformNumber();
    const tenant = await api.newTenant();
    const solved = await proofOfWork(app);
    const real = await client(app)
      .post('/api/auth/otp/request')
      .send({
        phone: tenant.ownerPhone,
        purpose: 'first_sign_in',
        intent: 'register_device',
        proofOfWork: solved,
      })
      .expect(200);
    expect((await challenge(real.body.challengeId))?.deliveryStatus).toBe('queued');
    const decoySolved = await proofOfWork(app);
    const decoy = await client(app)
      .post('/api/auth/otp/request')
      .send({
        phone: '+963900000001',
        purpose: 'password_reset',
        intent: 'register_device',
        proofOfWork: decoySolved,
      })
      .expect(200);
    for (const id of [real.body.challengeId, decoy.body.challengeId, uuidv7()]) {
      expect((await delivery(id).expect(200)).body).toEqual({ status: 'unknown' });
    }
  });

  it('allows 120 reads per 10 minutes per address', async () => {
    const http = client(app);
    const id = uuidv7();
    for (let read = 0; read < 120; read += 1) {
      await http.get(`/api/auth/otp/${id}/delivery`).expect(200);
    }
    expect((await http.get(`/api/auth/otp/${id}/delivery`)).body.code).toBe('RATE_LIMITED');
    await client(app).get(`/api/auth/otp/${id}/delivery`).expect(200);
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    await http.get(`/api/auth/otp/${id}/delivery`).expect(200);
  });
});

describe('console platform numbers', () => {
  let admin: ConsoleUser;
  let support: ConsoleUser;

  beforeAll(async () => {
    admin = await consoleUser(app, 'admin');
    support = await consoleUser(app, 'support');
  });

  /** The admin, re-authenticated for the next 5 minutes (S02 rule 40). */
  async function asAdmin() {
    await reauthenticate(app, admin);
    return asConsoleUser(app, admin);
  }

  async function auditOf(sessionId: string) {
    return db
      .select({ action: platformAuditEntries.action, actorId: platformAuditEntries.actorId })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, sessionId));
  }

  async function eventsOf(sessionId: string) {
    return db
      .select({
        type: whatsappSessionEvents.type,
        reason: whatsappSessionEvents.reason,
        platformUserId: whatsappSessionEvents.platformUserId,
      })
      .from(whatsappSessionEvents)
      .where(eq(whatsappSessionEvents.sessionId, sessionId))
      .orderBy(whatsappSessionEvents.id);
  }

  it('refuses requests without a console session', async () => {
    const response = await client(app).get('/api/console/whatsapp-sessions');
    expect(response.status).toBe(401);
    expect((await client(app).get('/api/console/messaging/health')).status).toBe(401);
  });

  it('lets support read but not act', async () => {
    const number = await platformNumber();
    const asSupport = asConsoleUser(app, support);
    await asSupport.get('/api/console/whatsapp-sessions').expect(200);
    await asSupport.get(`/api/console/whatsapp-sessions/${number.id}`).expect(200);
    await asSupport.get('/api/console/messaging/health').expect(200);
    await reauthenticate(app, support);
    const refusals = [
      await asSupport.post('/api/console/whatsapp-sessions').send({ label: 'رقم الدعم' }),
      await asSupport.get(`/api/console/whatsapp-sessions/${number.id}/qr`),
      await asSupport.post(`/api/console/whatsapp-sessions/${number.id}/pause`),
      await asSupport.post(`/api/console/whatsapp-sessions/${number.id}/resume`),
      await asSupport.post(`/api/console/whatsapp-sessions/${number.id}/relink`),
      await asSupport.post(`/api/console/whatsapp-sessions/${number.id}/unlink`),
    ];
    for (const refused of refusals) {
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('FORBIDDEN');
    }
  });

  it('lists numbers with their usage counted from linked_at', async () => {
    const number = await platformNumber({ days: 5 });
    const sent = (hoursAgo: number, firstContact = false) => ({
      kind: 'alert',
      template: 'alert',
      sessionId: number.id,
      recipientHash: `hash-${randomUUID()}`,
      status: 'sent',
      firstContact,
      deadlineAt: sql`now()`,
      nextAttemptAt: sql`now()`,
      sentAt: sql`now() - make_interval(secs => ${Math.round(hoursAgo * 3600)})`,
    });
    await db
      .insert(whatsappMessages)
      .values([sent(0.1, true), sent(0.5), sent(3), sent(30), sent(24 * 6)]);
    // A re-link with another phone restarted linked_at: the sends before it no longer count.
    const relinked = await platformNumber({ days: 0 });
    await db.insert(whatsappMessages).values([{ ...sent(2), sessionId: relinked.id }]);
    await db
      .update(whatsappSessions)
      .set({ linkedAt: sql`now() - interval '1 hour'` })
      .where(eq(whatsappSessions.id, relinked.id));

    const list = await asConsoleUser(app, support)
      .get('/api/console/whatsapp-sessions')
      .expect(200);
    expect(list.body).toHaveLength(2);
    const [first, second] = list.body;
    expect(first).toMatchObject({
      id: number.id,
      state: 'connected',
      warmUpDay: 6,
      dailyCap: 75,
      firstContactCap: 37,
      hourlyCap: 60,
      sentLastHour: 2,
      sentLast24h: 3,
      firstContactsLast24h: 1,
      leaseHeld: true,
      healthy: true,
      pausedAt: null,
      pauseReason: null,
    });
    expect(first.phone).toBe(number.phone);
    expect(second).toMatchObject({
      id: relinked.id,
      warmUpDay: 1,
      dailyCap: 30,
      sentLast24h: 0,
    });
  });

  it('reads the health: healthy numbers, total and whether an OTP could go', async () => {
    const asSupport = asConsoleUser(app, support);
    expect((await asSupport.get('/api/console/messaging/health').expect(200)).body).toEqual({
      healthy: 0,
      total: 0,
      otpAvailable: false,
    });
    await platformNumber({ leaseSeconds: -1 });
    await platformNumber({ state: 'needs_relink' });
    expect((await asSupport.get('/api/console/messaging/health')).body).toEqual({
      healthy: 0,
      total: 2,
      otpAvailable: false,
    });
    await platformNumber();
    expect((await asSupport.get('/api/console/messaging/health')).body).toEqual({
      healthy: 1,
      total: 3,
      otpAvailable: true,
    });
  });

  it('adds a number with re-authentication, an event and the platform audit', async () => {
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    const stale = await asConsoleUser(app, admin)
      .post('/api/console/whatsapp-sessions')
      .send({ label: 'رقم سوري' });
    expect(stale.body.code).toBe('REAUTH_REQUIRED');

    const http = await asAdmin();
    const created = await http
      .post('/api/console/whatsapp-sessions')
      .send({ label: ' رقم سوري ' })
      .expect(201);
    expect(created.body).toMatchObject({
      label: 'رقم سوري',
      phone: null,
      state: 'linking',
      linkedAt: null,
      warmUpDay: null,
      dailyCap: 0,
      leaseHeld: false,
      healthy: false,
    });
    const [row] = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.id, created.body.id));
    const deadline = ((row?.linkDeadlineAt?.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)) / 1000;
    expect(deadline).toBeCloseTo(180, 0);
    expect(await eventsOf(created.body.id)).toEqual([
      { type: 'created', reason: null, platformUserId: admin.userId },
    ]);
    expect(await auditOf(created.body.id)).toEqual([
      { action: 'whatsapp_session.created', actorId: admin.userId },
    ]);

    const taken = await http.post('/api/console/whatsapp-sessions').send({ label: 'رقم سوري' });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'CONFLICT', details: { field: 'label' } });
    const invalid = await http.post('/api/console/whatsapp-sessions').send({ label: 'ر' });
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an eleventh unarchived number (WHATSAPP_SESSION_LIMIT)', async () => {
    for (let index = 0; index < 9; index += 1) await platformNumber();
    const http = await asAdmin();
    await http.post('/api/console/whatsapp-sessions').send({ label: 'العاشر' }).expect(201);
    const refused = await http.post('/api/console/whatsapp-sessions').send({ label: 'الحادي عشر' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('WHATSAPP_SESSION_LIMIT');
  });

  it('shows the QR code while linking and unexpired, without re-authentication', async () => {
    const linking = await platformNumber({ state: 'linking' });
    const http = asConsoleUser(app, admin);
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    const none = await http.get(`/api/console/whatsapp-sessions/${linking.id}/qr`).expect(200);
    expect(none.body).toEqual({
      state: 'linking',
      qr: null,
      expiresAt: null,
      linkDeadlineAt: linking.linkDeadlineAt?.toISOString(),
    });

    await db
      .update(whatsappSessions)
      .set({
        qrSealed: crypto.box.seal(whatsappQrSealContext(linking.id), '2@fake-qr-code'),
        qrExpiresAt: sql`now() + interval '20 seconds'`,
      })
      .where(eq(whatsappSessions.id, linking.id));
    const shown = await http.get(`/api/console/whatsapp-sessions/${linking.id}/qr`).expect(200);
    expect(shown.body).toMatchObject({ state: 'linking', qr: '2@fake-qr-code' });
    expect(shown.body.expiresAt).not.toBeNull();

    await db
      .update(whatsappSessions)
      .set({ qrExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(whatsappSessions.id, linking.id));
    expect((await http.get(`/api/console/whatsapp-sessions/${linking.id}/qr`)).body.qr).toBeNull();

    const connected = await platformNumber();
    expect((await http.get(`/api/console/whatsapp-sessions/${connected.id}/qr`)).body).toEqual({
      state: 'connected',
      qr: null,
      expiresAt: null,
      linkDeadlineAt: null,
    });
    const missing = await http.get(`/api/console/whatsapp-sessions/${uuidv7()}/qr`);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('pauses and resumes a number, refusing a repeat', async () => {
    const number = await platformNumber();
    const http = await asAdmin();
    const paused = await http
      .post(`/api/console/whatsapp-sessions/${number.id}/pause`)
      .expect(200);
    expect(paused.body).toMatchObject({ pauseReason: 'manual', healthy: false });
    expect(paused.body.pausedAt).not.toBeNull();
    const again = await http.post(`/api/console/whatsapp-sessions/${number.id}/pause`);
    expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');

    const resumed = await http
      .post(`/api/console/whatsapp-sessions/${number.id}/resume`)
      .expect(200);
    expect(resumed.body).toMatchObject({ pausedAt: null, pauseReason: null, healthy: true });
    const twice = await http.post(`/api/console/whatsapp-sessions/${number.id}/resume`);
    expect(twice.body.code).toBe('INVALID_STATUS_TRANSITION');

    // After three failed sends (rule 6): resuming resets the count.
    await db
      .update(whatsappSessions)
      .set({ pausedAt: sql`now()`, pauseReason: 'send_failures', consecutiveFailures: 3 })
      .where(eq(whatsappSessions.id, number.id));
    await http.post(`/api/console/whatsapp-sessions/${number.id}/resume`).expect(200);
    const [row] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, number.id));
    expect(row?.consecutiveFailures).toBe(0);

    expect(await eventsOf(number.id)).toEqual([
      { type: 'paused', reason: 'manual', platformUserId: admin.userId },
      { type: 'resumed', reason: 'manual', platformUserId: admin.userId },
      { type: 'resumed', reason: 'send_failures', platformUserId: admin.userId },
    ]);
    expect((await auditOf(number.id)).map((entry) => entry.action)).toEqual([
      'whatsapp_session.paused',
      'whatsapp_session.resumed',
      'whatsapp_session.resumed',
    ]);
  });

  it('re-links a number that lost its link, deleting only its credentials', async () => {
    const number = await platformNumber({ state: 'needs_relink' });
    await db.insert(whatsappSessionCredentials).values({
      sessionId: number.id,
      keyHash: 'creds',
      valueSealed: 'sealed',
    });
    await db.insert(whatsappKnownRecipients).values({
      sessionId: number.id,
      recipientHash: 'known',
      firstSentAt: sql`now()`,
      lastSentAt: sql`now()`,
    });
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    const stale = await asConsoleUser(app, admin).post(
      `/api/console/whatsapp-sessions/${number.id}/relink`,
    );
    expect(stale.body.code).toBe('REAUTH_REQUIRED');

    const http = await asAdmin();
    const relinked = await http
      .post(`/api/console/whatsapp-sessions/${number.id}/relink`)
      .expect(200);
    expect(relinked.body).toMatchObject({ state: 'linking', phone: number.phone });
    expect(relinked.body.linkedAt).toBe(number.linkedAt?.toISOString());
    expect(
      await db
        .select()
        .from(whatsappSessionCredentials)
        .where(eq(whatsappSessionCredentials.sessionId, number.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(whatsappKnownRecipients)
        .where(eq(whatsappKnownRecipients.sessionId, number.id)),
    ).toHaveLength(1);
    const qr = await http.get(`/api/console/whatsapp-sessions/${number.id}/qr`).expect(200);
    expect(qr.body.linkDeadlineAt).not.toBeNull();

    const linking = await http.post(`/api/console/whatsapp-sessions/${number.id}/relink`);
    expect(linking.body.code).toBe('INVALID_STATUS_TRANSITION');
    const connected = await platformNumber();
    const refused = await http.post(`/api/console/whatsapp-sessions/${connected.id}/relink`);
    expect(refused.body.code).toBe('INVALID_STATUS_TRANSITION');

    expect(await eventsOf(number.id)).toEqual([
      { type: 'relink_started', reason: null, platformUserId: admin.userId },
    ]);
    expect(await auditOf(number.id)).toEqual([
      { action: 'whatsapp_session.relinked', actorId: admin.userId },
    ]);
  });

  it('unlinks a number: credentials, known recipients and its queued messages go', async () => {
    const number = await platformNumber();
    const other = await platformNumber();
    await db
      .insert(whatsappSessionCredentials)
      .values({ sessionId: number.id, keyHash: 'creds', valueSealed: 'sealed' });
    await db.insert(whatsappKnownRecipients).values({
      sessionId: number.id,
      recipientHash: 'known',
      firstSentAt: sql`now()`,
      lastSentAt: sql`now()`,
    });
    const message = (values: Record<string, unknown>) => ({
      kind: 'auto_reply',
      template: 'auto_reply',
      sessionId: number.id,
      recipientHash: `hash-${randomUUID()}`,
      status: 'queued',
      deadlineAt: sql`now() + interval '1 hour'`,
      nextAttemptAt: sql`now()`,
      ...values,
    });
    const [reply, sent, otherReply] = await db
      .insert(whatsappMessages)
      .values([
        message({}),
        message({ status: 'sent', sentAt: sql`now()` }),
        message({ sessionId: other.id }),
      ])
      .returning();

    // A queued OTP retry claimed by this number goes back to any healthy number.
    const { ownerPhone } = await ownerWithPassword();
    vi.setSystemTime(Date.now() + 61_000);
    const started = await passwordSignIn(ownerPhone);
    await db
      .update(whatsappMessages)
      .set({ sessionId: number.id, attempts: 1 })
      .where(eq(whatsappMessages.otpChallengeId, started.body.challengeId));

    const http = await asAdmin();
    await http.post(`/api/console/whatsapp-sessions/${number.id}/unlink`).expect(204);

    const [row] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, number.id));
    expect(row?.state).toBe('unlinked');
    expect(row?.archivedAt).not.toBeNull();
    expect(
      await db
        .select()
        .from(whatsappSessionCredentials)
        .where(eq(whatsappSessionCredentials.sessionId, number.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(whatsappKnownRecipients)
        .where(eq(whatsappKnownRecipients.sessionId, number.id)),
    ).toEqual([]);
    expect(
      await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, reply?.id as string)),
    ).toEqual([]);
    const kept = await db
      .select({ id: whatsappMessages.id })
      .from(whatsappMessages)
      .where(inArray(whatsappMessages.id, [sent?.id as string, otherReply?.id as string]));
    expect(kept).toHaveLength(2);
    const [otp] = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.otpChallengeId, started.body.challengeId));
    expect(otp).toMatchObject({ status: 'queued', sessionId: null });

    expect((await http.get('/api/console/whatsapp-sessions')).body.map((s: { id: string }) => s.id))
      .not.toContain(number.id);
    expect((await http.get(`/api/console/whatsapp-sessions/${number.id}`)).body.code).toBe(
      'NOT_FOUND',
    );
    const again = await http.post(`/api/console/whatsapp-sessions/${number.id}/unlink`);
    expect(again.body.code).toBe('NOT_FOUND');
    expect(await auditOf(number.id)).toEqual([
      { action: 'whatsapp_session.unlinked', actorId: admin.userId },
    ]);
  });

  it('reads a number with its last 50 events, newest first, with the admin named', async () => {
    const number = await platformNumber();
    await db.insert(whatsappSessionEvents).values(
      Array.from({ length: 55 }, (_, index) => ({
        sessionId: number.id,
        type: 'disconnected',
        reason: 'connection_lost',
        createdAt: sql`now() - make_interval(mins => ${60 - index})`,
      })),
    );
    const http = await asAdmin();
    await http.post(`/api/console/whatsapp-sessions/${number.id}/pause`).expect(200);

    const detail = await asConsoleUser(app, support)
      .get(`/api/console/whatsapp-sessions/${number.id}`)
      .expect(200);
    expect(detail.body.session).toMatchObject({ id: number.id, pauseReason: 'manual' });
    expect(detail.body.events).toHaveLength(50);
    expect(detail.body.events[0]).toMatchObject({
      type: 'paused',
      reason: 'manual',
      platformUserName: admin.name,
    });
    expect(detail.body.events[1]).toMatchObject({
      type: 'disconnected',
      reason: 'connection_lost',
      platformUserName: null,
    });
    const missing = await http.get(`/api/console/whatsapp-sessions/${uuidv7()}`);
    expect(missing.status).toBe(404);
  });
});
