import {
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappOptOuts,
  whatsappSealContext,
} from '@vertex-food/db';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_PHONE, STRANGER_PHONE, SYRIAN_NUMBER, TURKISH_NUMBER } from './credentials.js';
import { crypto, db, hashOf, linkedSession, resetMessaging } from './fixtures.js';
import { type Gateway, startGateway } from './gateway.js';

let gw: Gateway;
let syrian: string;

beforeEach(async () => {
  await resetMessaging();
  gw = await startGateway();
  syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
});
afterEach(async () => {
  await gw.app.close();
});

/** The number has messaged this person before (an OTP): a known recipient (rule 25). */
async function known(phone = STAFF_PHONE, sessionId = syrian) {
  await db.insert(whatsappKnownRecipients).values({
    id: uuidv7(),
    sessionId,
    recipientHash: hashOf(phone),
    firstSentAt: sql`now() - interval '1 hour'`,
    lastSentAt: sql`now() - interval '1 hour'`,
  });
}

let ids = 0;
async function receive(text: string, from = STAFF_PHONE, sentAt = new Date(), id?: string) {
  gw.transport.receive(syrian, { id: id ?? `incoming-${++ids}`, from, text, sentAt });
  await gw.settle();
}

/** The queued replies, by template, with the number they must go from. */
async function replies() {
  const rows = await db
    .select({
      id: whatsappMessages.id,
      template: whatsappMessages.template,
      sessionId: whatsappMessages.sessionId,
      recipientSealed: whatsappMessages.recipientSealed,
    })
    .from(whatsappMessages)
    .where(sql`${whatsappMessages.kind} in ('opt_reply', 'auto_reply')`)
    .orderBy(whatsappMessages.createdAt);
  return rows.map((row) => ({
    template: row.template,
    sessionId: row.sessionId,
    to: crypto.box.open(whatsappSealContext(row.id, 'recipient'), row.recipientSealed ?? ''),
  }));
}

async function optOut(phone = STAFF_PHONE) {
  const [row] = await db
    .select()
    .from(whatsappOptOuts)
    .where(eq(whatsappOptOuts.recipientHash, hashOf(phone)));
  return row;
}

describe('incoming messages', () => {
  it('drops a message from someone the number never wrote to, storing nothing', async () => {
    await receive('إيقاف', STRANGER_PHONE);
    await receive('مرحبا', STRANGER_PHONE);
    expect(await replies()).toEqual([]);
    expect(await optOut(STRANGER_PHONE)).toBeUndefined();
    const knownRows = await db
      .select()
      .from(whatsappKnownRecipients)
      .where(eq(whatsappKnownRecipients.recipientHash, hashOf(STRANGER_PHONE)));
    expect(knownRows).toEqual([]);
  });

  it('auto-replies once a day from the receiving number', async () => {
    await known();
    await receive('من أنت؟');
    await receive('هل وصل الرمز؟');
    expect(await replies()).toEqual([
      { template: 'auto_reply', sessionId: syrian, to: STAFF_PHONE },
    ]);
    await db.execute(
      sql`update whatsapp_known_recipients set last_auto_reply_at = now() - interval '25 hours'`,
    );
    await receive('مرحبا');
    expect(await replies()).toHaveLength(2);
  });

  it('processes a message reported twice (notify, then append) once', async () => {
    await known();
    await receive('من أنت؟', STAFF_PHONE, new Date(), 'same-id');
    await db.execute(sql`update whatsapp_known_recipients set last_auto_reply_at = null`);
    await receive('من أنت؟', STAFF_PHONE, new Date(), 'same-id');
    expect(await replies()).toHaveLength(1);
  });

  it('only processes a sender known to the receiving number', async () => {
    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    await known(STAFF_PHONE, turkish);
    await receive('من أنت؟');
    expect(await replies()).toEqual([]);
  });

  it('opts out and in by keyword, Arabic variants included, with one confirmation each', async () => {
    await known();
    await receive(' ايقاف ');
    expect((await optOut())?.optedOutAt).not.toBeNull();
    await receive('من أنت؟');
    await receive('start');
    expect((await optOut())?.optedInAt).not.toBeNull();
    expect(await replies()).toEqual([
      { template: 'opt_out_confirmed', sessionId: syrian, to: STAFF_PHONE },
      { template: 'opt_in_confirmed', sessionId: syrian, to: STAFF_PHONE },
    ]);
  });

  it('orders keywords by their message time: a late, older one changes nothing', async () => {
    await known();
    const now = Date.now();
    await receive('STOP', STAFF_PHONE, new Date(now));
    await receive('تشغيل', STAFF_PHONE, new Date(now - 60_000));
    const row = await optOut();
    expect(row?.optedInAt).toBeNull();
    expect(row?.lastKeywordAt.getTime()).toBe(now);
    expect((await replies()).map((reply) => reply.template)).toEqual(['opt_out_confirmed']);
  });

  it('sends no auto-reply after an opt-out', async () => {
    await known();
    await receive('إيقاف');
    await receive('من أنت؟');
    expect((await replies()).map((reply) => reply.template)).toEqual(['opt_out_confirmed']);
  });

  it('queues no reply when the receiving number has no budget for it now', async () => {
    await known();
    await db.execute(
      sql`update whatsapp_sessions set paused_at = now(), pause_reason = 'manual' where id = ${syrian}`,
    );
    await receive('من أنت؟');
    expect(await replies()).toEqual([]);
    const [row] = await db
      .select({ at: whatsappKnownRecipients.lastAutoReplyAt })
      .from(whatsappKnownRecipients)
      .where(
        and(
          eq(whatsappKnownRecipients.sessionId, syrian),
          eq(whatsappKnownRecipients.recipientHash, hashOf(STAFF_PHONE)),
        ),
      );
    expect(row?.at).toBeNull();
  });

  it('sends a queued reply from the number that received the message', async () => {
    await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    await known();
    await receive('من أنت؟');
    await gw.drain();
    expect(gw.transport.sent).toEqual([
      expect.objectContaining({ sessionId: syrian, to: STAFF_PHONE }),
    ]);
  });
});
