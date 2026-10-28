import {
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappOptOuts,
  whatsappSealContext,
} from '@vertex-food/db';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeWhatsAppTransport } from '../src/transport/fake-transport.js';
import {
  ADMIN_PHONE,
  SECOND_ADMIN_PHONE,
  STAFF_PHONE,
  SYRIAN_NUMBER,
  TURKISH_NUMBER,
} from './credentials.js';
import {
  crypto,
  db,
  deliveryStatus,
  enqueue,
  events,
  hashOf,
  linkedSession,
  message,
  otpChallenge,
  pastGaps,
  platformUser,
  resetMessaging,
  session,
} from './fixtures.js';
import { type Gateway, startGateway } from './gateway.js';

let gateways: Gateway[] = [];
async function gateway(transport?: FakeWhatsAppTransport) {
  const started = await startGateway(transport);
  gateways.push(started);
  return started;
}

beforeEach(async () => {
  await resetMessaging();
});
afterEach(async () => {
  for (const started of gateways) await started.app.close();
  gateways = [];
});

async function queueOtp(phone = STAFF_PHONE, code = '123456') {
  const challengeId = await otpChallenge(phone);
  const id = await enqueue({
    kind: 'otp',
    template: 'otp',
    phone,
    params: { code },
    otpChallengeId: challengeId,
  });
  return { id, challengeId };
}

/** Sends a number already made, as if `count` messages went out `ago` (rule 8's windows). */
async function pastSends(sessionId: string, count: number, ago: string, firstContact = false) {
  await db.insert(whatsappMessages).values(
    Array.from({ length: count }, () => ({
      id: uuidv7(),
      kind: 'alert',
      template: 'alert',
      sessionId,
      recipientHash: hashOf(`+9998${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`),
      status: 'sent',
      firstContact,
      deadlineAt: sql`now()`,
      nextAttemptAt: sql`now()`,
      sentAt: sql`now() - ${ago}::interval`,
    })),
  );
}

describe('sending an OTP', () => {
  it('renders the text from the sealed parameters, sends it and records the outcome', async () => {
    const gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { id, challengeId } = await queueOtp();
    await gw.drain();

    expect(gw.transport.sent).toEqual([
      {
        sessionId,
        messageId: 'fake-message-1',
        to: STAFF_PHONE,
        text: expect.stringContaining('رمز التحقق في فيرتكس فود: 123456'),
      },
    ]);
    const sent = await message(id);
    expect(sent).toMatchObject({
      status: 'sent',
      sessionId,
      attempts: 1,
      firstContact: true,
      transportMessageId: 'fake-message-1',
      paramsSealed: null,
    });
    expect(sent.sentAt).not.toBeNull();
    expect(sent.bodySealed).not.toContain('123456');
    expect(crypto.box.open(whatsappSealContext(id, 'body'), sent.bodySealed ?? '')).toContain(
      '123456',
    );
    expect(await deliveryStatus(challengeId)).toBe('sent');
    const known = await db
      .select()
      .from(whatsappKnownRecipients)
      .where(eq(whatsappKnownRecipients.recipientHash, hashOf(STAFF_PHONE)));
    expect(known).toHaveLength(1);
  });

  it('moves the message and its challenge forward only, whatever order receipts come in', async () => {
    const gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { id, challengeId } = await queueOtp();
    await gw.drain();
    const ack = (status: 'sent' | 'delivered' | 'read' | 'failed') => {
      gw.transport.acknowledge(sessionId, { messageId: 'fake-message-1', status, at: new Date() });
      return gw.settle();
    };

    await ack('delivered');
    expect((await message(id)).status).toBe('delivered');
    expect((await message(id)).deliveredAt).not.toBeNull();
    expect(await deliveryStatus(challengeId)).toBe('delivered');
    await ack('sent');
    await ack('failed');
    expect((await message(id)).status).toBe('delivered');
    await ack('read');
    await ack('delivered');
    const read = await message(id);
    expect(read.status).toBe('read');
    expect(read.readAt).not.toBeNull();
    expect(await deliveryStatus(challengeId)).toBe('delivered');
  });

  it('is sent even to a phone that opted out (rule 22)', async () => {
    const gw = await gateway();
    await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await db.insert(whatsappOptOuts).values({
      id: uuidv7(),
      recipientHash: hashOf(STAFF_PHONE),
      optedOutAt: sql`now()`,
      lastKeywordAt: sql`now()`,
    });
    const { id } = await queueOtp();
    await gw.drain();
    expect((await message(id)).status).toBe('sent');
  });
});

describe('claiming', () => {
  it('claims by priority: an OTP before an alert queued earlier', async () => {
    const gw = await gateway();
    await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const alert = await enqueue({
      kind: 'alert',
      template: 'alert',
      phone: ADMIN_PHONE,
      params: { label: 'رقم تركي', event: 'banned' },
    });
    const { id: otp } = await queueOtp();
    await gw.drain();
    expect((await message(otp)).status).toBe('sent');
    expect((await message(alert)).status).toBe('queued');
    await pastGaps();
    await gw.drain();
    expect((await message(alert)).status).toBe('sent');
    expect(gw.transport.sent.map((sent) => sent.to)).toEqual([STAFF_PHONE, ADMIN_PHONE]);
  });

  it('never sends one message twice from two instances claiming at once', async () => {
    const a = await gateway();
    await linkedSession(a, 'رقم سوري', SYRIAN_NUMBER);
    const b = await gateway();
    await linkedSession(b, 'رقم تركي', TURKISH_NUMBER);
    expect(a.sessions.runningIds()).toHaveLength(1);
    expect(b.sessions.runningIds()).toHaveLength(1);
    const ids = await Promise.all([
      queueOtp(STAFF_PHONE).then((otp) => otp.id),
      queueOtp(ADMIN_PHONE).then((otp) => otp.id),
      queueOtp(SECOND_ADMIN_PHONE).then((otp) => otp.id),
    ]);
    // Two rounds: an instance that found every row locked claims on its next wake (the 2 s poll).
    for (let round = 0; round < 2; round++) {
      a.sending.wake();
      b.sending.wake();
      await Promise.all([a.settle(), b.settle()]);
    }

    const sent = [...a.transport.sent, ...b.transport.sent];
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((each) => each.to)).size).toBe(2);
    const statuses = await Promise.all(ids.map(async (id) => (await message(id)).status));
    expect(statuses.sort()).toEqual(['queued', 'sent', 'sent']);
  });

  it('keeps the gap after a send across a restart, counted from sent_at', async () => {
    let gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await queueOtp(STAFF_PHONE);
    await gw.drain();
    const { id: second } = await queueOtp(ADMIN_PHONE);
    await gw.drain();
    expect((await message(second)).status).toBe('queued');

    await gw.app.close();
    gateways = [];
    gw = await gateway(new FakeWhatsAppTransport('fake-restarted'));
    await gw.tick();
    expect((await session(sessionId)).state).toBe('connected');
    await gw.drain();
    expect((await message(second)).status).toBe('queued');
    await pastGaps();
    await gw.drain();
    expect((await message(second)).status).toBe('sent');
  });

  it('holds a number at its daily cap and fails over to the other number', async () => {
    const gw = await gateway();
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    // Linked yesterday: day 2, still a cap of 30 (rule 8).
    await db.execute(sql`update whatsapp_sessions set linked_at = now() - interval '25 hours'`);
    await pastSends(syrian, 30, '2 hours');
    const { id } = await queueOtp();
    await gw.drain();
    expect((await message(id)).status).toBe('queued');

    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    await gw.drain();
    expect(await message(id)).toMatchObject({ status: 'sent', sessionId: turkish });
  });

  it('counts a re-linked number’s sends from its new linked_at only', async () => {
    const gw = await gateway();
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await pastSends(syrian, 30, '2 hours');
    await db.execute(sql`update whatsapp_sessions set linked_at = now() - interval '1 hour'`);
    const { id } = await queueOtp();
    await gw.drain();
    expect((await message(id)).status).toBe('sent');
  });

  it('prefers the number that knows the recipient, and fails over when it disconnects', async () => {
    const gw = await gateway();
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    await db.insert(whatsappKnownRecipients).values({
      id: uuidv7(),
      sessionId: turkish,
      recipientHash: hashOf(STAFF_PHONE),
      firstSentAt: sql`now() - interval '1 day'`,
      lastSentAt: sql`now() - interval '1 day'`,
    });
    const { id: first } = await queueOtp();
    await gw.drain();
    expect(await message(first)).toMatchObject({ sessionId: turkish, firstContact: false });

    gw.transport.disconnect(turkish, 'connection_lost');
    await gw.settle();
    const { id: second } = await queueOtp();
    await gw.drain();
    expect(await message(second)).toMatchObject({
      status: 'sent',
      sessionId: syrian,
      firstContact: true,
    });
  });
});

describe('failures', () => {
  it('queues a failed send again with backoff, on any number', async () => {
    const gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { id } = await queueOtp();
    gw.transport.failNextSends(1);
    await gw.drain();
    const failed = await message(id);
    expect(failed).toMatchObject({ status: 'queued', attempts: 1, sessionId: null });
    const wait = (failed.nextAttemptAt.getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(5);
    expect(wait).toBeLessThanOrEqual(10);
    expect((await session(sessionId)).consecutiveFailures).toBe(1);

    await db.execute(sql`update whatsapp_messages set next_attempt_at = now() where id = ${id}`);
    await gw.drain();
    expect(await message(id)).toMatchObject({ status: 'sent', attempts: 2 });
    expect((await session(sessionId)).consecutiveFailures).toBe(0);
  });

  it('pauses a number after three failed sends in a row and alerts admins', async () => {
    await platformUser(ADMIN_PHONE);
    const gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { id } = await queueOtp();
    gw.transport.failNextSends(3);
    for (let attempt = 0; attempt < 3; attempt++) {
      await db.execute(sql`update whatsapp_messages set next_attempt_at = now() where id = ${id}`);
      await gw.drain();
    }
    expect(await session(sessionId)).toMatchObject({
      pauseReason: 'send_failures',
      consecutiveFailures: 3,
    });
    expect(await events(sessionId)).toEqual(
      expect.arrayContaining(['paused:send_failures', 'alert_sent:paused_send_failures']),
    );
    // Paused: the OTP waits for another number or its deadline.
    await db.execute(sql`update whatsapp_messages set next_attempt_at = now() where id = ${id}`);
    await gw.drain();
    expect(await message(id)).toMatchObject({ status: 'queued', attempts: 3 });
  });

  it('expires a message still queued at its deadline and fails its challenge', async () => {
    const gw = await gateway();
    const { id, challengeId } = await queueOtp();
    await db.execute(
      sql`update whatsapp_messages set deadline_at = now() - interval '1 second' where id = ${id}`,
    );
    await gw.sweep.run();
    expect(await message(id)).toMatchObject({
      status: 'expired',
      failureReason: 'deadline',
      paramsSealed: null,
    });
    expect(await deliveryStatus(challengeId)).toBe('failed');
  });

  it('fails an alert to a phone that opted out after it was queued', async () => {
    const gw = await gateway();
    await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const id = await enqueue({
      kind: 'alert',
      template: 'alert',
      phone: ADMIN_PHONE,
      params: { label: 'رقم تركي', event: 'banned' },
    });
    await db.insert(whatsappOptOuts).values({
      id: uuidv7(),
      recipientHash: hashOf(ADMIN_PHONE),
      optedOutAt: sql`now()`,
      lastKeywordAt: sql`now()`,
    });
    await gw.drain();
    expect(await message(id)).toMatchObject({ status: 'failed', failureReason: 'opted_out' });
    expect(gw.transport.sent).toEqual([]);
  });
});

describe('retry requests', () => {
  it('answers with the sent text within an hour, and with nothing after', async () => {
    const gw = await gateway();
    const sessionId = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const { id } = await queueOtp();
    await gw.drain();
    expect(await gw.transport.retryRequest(sessionId, 'fake-message-1')).toContain('123456');
    expect(await gw.transport.retryRequest(sessionId, 'fake-message-2')).toBeNull();

    await db.execute(
      sql`update whatsapp_messages set sent_at = now() - interval '61 minutes' where id = ${id}`,
    );
    expect(await gw.transport.retryRequest(sessionId, 'fake-message-1')).toBeNull();
    await gw.sweep.run();
    expect((await message(id)).bodySealed).toBeNull();
    expect((await message(id)).recipientSealed).toBeNull();
  });
});
