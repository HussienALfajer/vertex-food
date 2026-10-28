import {
  whatsappMessages,
  whatsappOptOuts,
  whatsappSessionEvents,
  whatsappSessions,
} from '@vertex-food/db';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_PHONE,
  SECOND_ADMIN_PHONE,
  STAFF_PHONE,
  STRANGER_PHONE,
  SYRIAN_NUMBER,
  TURKISH_NUMBER,
} from './credentials.js';
import {
  addSession,
  alertRecipients,
  db,
  events,
  hashOf,
  linkedSession,
  message,
  pastGaps,
  platformUser,
  resetMessaging,
} from './fixtures.js';
import { type Gateway, startGateway } from './gateway.js';

let gw: Gateway;

beforeEach(async () => {
  await resetMessaging();
  gw = await startGateway();
});
afterEach(async () => {
  await gw.app.close();
});

const OTHER_ADMIN = '+999100000004';
const OPTED_OUT_ADMIN = '+999100000005';

async function alerts() {
  return db.select().from(whatsappMessages).where(eq(whatsappMessages.kind, 'alert'));
}

describe('alerts', () => {
  it('go to every active admin who manages messaging and has not opted out', async () => {
    await platformUser(ADMIN_PHONE);
    await platformUser(SECOND_ADMIN_PHONE);
    await platformUser(STAFF_PHONE, 'support');
    await platformUser(STRANGER_PHONE, 'admin', { status: 'disabled' });
    await platformUser(OTHER_ADMIN, 'admin', { revoked: ['console.messaging.manage'] });
    await platformUser(OPTED_OUT_ADMIN);
    await db.insert(whatsappOptOuts).values({
      id: uuidv7(),
      recipientHash: hashOf(OPTED_OUT_ADMIN),
      optedOutAt: sql`now()`,
      lastKeywordAt: sql`now()`,
    });
    const id = await addSession('رقم سوري');

    await gw.alerts.raise(id, 'banned');
    expect(await alertRecipients()).toEqual([ADMIN_PHONE, SECOND_ADMIN_PHONE].sort());
    expect(await events(id)).toEqual(['created', 'alert_sent:banned']);
  });

  it('are sent at most once per number and event every 30 minutes', async () => {
    await platformUser(ADMIN_PHONE);
    const id = await addSession('رقم سوري');
    await gw.alerts.raise(id, 'needs_relink');
    await gw.alerts.raise(id, 'needs_relink');
    expect(await alerts()).toHaveLength(1);
    await gw.alerts.raise(id, 'banned');
    expect(await alerts()).toHaveLength(2);
  });

  it('name the number’s label and the event, and wait for a healthy number', async () => {
    await platformUser(ADMIN_PHONE);
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    gw.transport.disconnect(syrian, 'forbidden');
    await gw.settle();
    await pastGaps();
    await gw.drain();
    expect(gw.transport.sent).toEqual([
      expect.objectContaining({
        to: ADMIN_PHONE,
        text: 'تنبيه فيرتكس فود: رقم المنصة «رقم سوري» محظور من واتساب.',
      }),
    ]);
  });

  it('report a number disconnected for more than 5 minutes, once per disconnection', async () => {
    await platformUser(ADMIN_PHONE);
    /** A number not run by any gateway, disconnected `minutes` ago. */
    const disconnectedFor = async (label: string, phone: string, minutes: number) => {
      const id = await addSession(label);
      await db
        .update(whatsappSessions)
        .set({ state: 'disconnected', phone, linkedAt: sql`now() - interval '1 day'` })
        .where(eq(whatsappSessions.id, id));
      await db.insert(whatsappSessionEvents).values({
        id: uuidv7(),
        sessionId: id,
        type: 'disconnected',
        reason: 'connection_lost',
        createdAt: sql`now() - make_interval(mins => ${minutes})`,
      });
      return id;
    };
    const recent = await disconnectedFor('رقم سوري', SYRIAN_NUMBER, 4);
    const overdue = await disconnectedFor('رقم تركي', TURKISH_NUMBER, 6);
    await gw.sweep.run();
    await gw.sweep.run();
    expect(await events(recent)).not.toContain('alert_sent:disconnected');
    const sent = (await events(overdue)).filter((event) => event === 'alert_sent:disconnected');
    expect(sent).toHaveLength(1);
  });

  it('report the healthy count falling to zero and rising back from it', async () => {
    await platformUser(ADMIN_PHONE);
    const syrian = await linkedSession(gw, 'رقم سوري', SYRIAN_NUMBER);
    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    const pause = (id: string, paused: boolean) =>
      db
        .update(whatsappSessions)
        .set(
          paused
            ? { pausedAt: sql`now()`, pauseReason: 'manual' }
            : { pausedAt: null, pauseReason: null },
        )
        .where(eq(whatsappSessions.id, id));

    await pause(syrian, true);
    await gw.sweep.run();
    expect(await alerts()).toEqual([]);
    await pause(turkish, true);
    await gw.sweep.run();
    await gw.sweep.run();
    const none = await alerts();
    expect(none).toHaveLength(1);
    expect(none[0]?.status).toBe('queued');

    await pause(syrian, false);
    await pause(turkish, false);
    await gw.sweep.run();
    expect(await alerts()).toHaveLength(2);
    await gw.drain();
    // One message a minute per recipient (rule 10): the second alert goes a minute later.
    await db.execute(
      sql`update whatsapp_messages set sent_at = sent_at - interval '2 minutes' where sent_at is not null`,
    );
    await gw.drain();
    const texts = gw.transport.sent.map((sent) => sent.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('لم يبقَ أي رقم يعمل، رموز التحقق متوقفة'),
        expect.stringContaining('عاد رقم واحد على الأقل للعمل'),
      ]),
    );
  });
});

describe('the sweep', () => {
  it('clears recipients and parameters an hour after a final status and deletes old rows', async () => {
    const recent = uuidv7();
    const old = uuidv7();
    const base = {
      kind: 'alert',
      template: 'alert',
      recipientHash: hashOf(ADMIN_PHONE),
      recipientSealed: 'sealed-recipient',
      paramsSealed: 'sealed-params',
      status: 'failed',
      failureReason: 'transport_error',
      deadlineAt: sql`now()`,
      nextAttemptAt: sql`now()`,
    };
    await db.insert(whatsappMessages).values([
      { ...base, id: recent, updatedAt: sql`now() - interval '61 minutes'` },
      { ...base, id: old, createdAt: sql`now() - interval '31 days'` },
    ]);
    await gw.sweep.run();
    expect(await message(recent)).toMatchObject({ recipientSealed: null, paramsSealed: null });
    await expect(message(old)).rejects.toThrow('No such message');
  });
});
