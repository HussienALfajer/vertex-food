import { randomBytes } from 'node:crypto';
import { messageTemplates } from '@vertex-food/contracts';
import { KeyedHash, SecretBox } from '@vertex-food/crypto';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import {
  accounts,
  enqueueWhatsAppMessage,
  isWhatsAppOptedOut,
  otpChallenges,
  sendAvailability,
  whatsappKnownRecipients,
  whatsappMessages,
  whatsappOptOuts,
  whatsappRecipientHash,
  whatsappSealContext,
  whatsappSessions,
} from '../src/index.js';
import { connect } from './connections.js';

// The queue writer and the send-availability check (spec S03 rules 16–17), as the app role.

const { app } = connect();
const crypto = { hash: new KeyedHash(randomBytes(32)), box: new SecretBox(randomBytes(32)) };

let phones = 0;
const newPhone = () => `+9997${String(Date.now() % 1e6).padStart(6, '0')}${phones++}`;

/** A healthy number linked `days` days and an hour ago, holding a live lease. */
async function healthyNumber(
  days = 30,
  values: Partial<typeof whatsappSessions.$inferInsert> = {},
) {
  const [row] = await app
    .insert(whatsappSessions)
    .values({
      label: `رقم ${uuidv7().slice(-12)}`,
      state: 'connected',
      linkedAt: sql`now() - make_interval(days => ${days}, hours => 1)`,
      leaseHolder: uuidv7(),
      leaseExpiresAt: sql`now() + interval '30 seconds'`,
      ...values,
    })
    .returning();
  return row as typeof whatsappSessions.$inferSelect;
}

/** An OTP challenge for a sent OTP message to point at. */
async function otpChallenge(): Promise<string> {
  const accountId = uuidv7();
  await app.insert(accounts).values({ id: accountId, phone: newPhone() });
  const [row] = await app
    .insert(otpChallenges)
    .values({
      accountId,
      purpose: 'new_device',
      codeHash: 'hash',
      expiresAt: sql`now() + interval '5 minutes'`,
      deliveryStatus: 'sent',
    })
    .returning({ id: otpChallenges.id });
  return row?.id as string;
}

/** `count` messages already sent from a number to a recipient, `ago` before now. */
async function sent(
  sessionId: string,
  recipientHash: string,
  count: number,
  values: { kind?: 'otp' | 'alert'; ago?: string; firstContact?: boolean } = {},
) {
  const kind = values.kind ?? 'alert';
  for (let i = 0; i < count; i += 1) {
    const otpChallengeId = kind === 'otp' ? await otpChallenge() : null;
    await app.insert(whatsappMessages).values({
      kind,
      template: kind,
      sessionId,
      recipientHash,
      status: 'sent',
      sentAt: sql`now() - ${values.ago ?? '10 minutes'}::interval`,
      firstContact: values.firstContact ?? false,
      deadlineAt: sql`now()`,
      nextAttemptAt: sql`now()`,
      otpChallengeId,
    });
  }
}

const alert = (phone: string) =>
  ({
    kind: 'alert',
    template: 'alert',
    phone,
    params: { label: 'رقم سوري', event: 'banned' },
  }) as const;

describe('enqueueWhatsAppMessage', () => {
  it('stores the recipient hashed and sealed and the parameters sealed, bound to the row', async () => {
    const phone = newPhone();
    const result = await app.transaction((tx) => enqueueWhatsAppMessage(tx, crypto, alert(phone)));
    expect(result).toMatchObject({ queued: true, duplicate: false });
    const id = result.queued ? result.messageId : '';
    const [row] = await app.select().from(whatsappMessages).where(eq(whatsappMessages.id, id));
    expect(row).toMatchObject({
      kind: 'alert',
      template: 'alert',
      status: 'queued',
      recipientHash: whatsappRecipientHash(crypto, phone),
      attempts: 0,
    });
    expect(JSON.stringify(row)).not.toContain(phone.slice(1));
    expect(JSON.stringify(row)).not.toContain('رقم سوري');
    expect(crypto.box.open(whatsappSealContext(id, 'recipient'), row?.recipientSealed ?? '')).toBe(
      phone,
    );
    expect(
      JSON.parse(crypto.box.open(whatsappSealContext(id, 'params'), row?.paramsSealed ?? '') ?? ''),
    ).toEqual({ label: 'رقم سوري', event: 'banned' });
    expect(crypto.box.open(whatsappSealContext(uuidv7(), 'params'), row?.paramsSealed ?? '')).toBe(
      undefined,
    );
    const deadline = (row?.deadlineAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0);
    expect(Math.round(deadline / 1000)).toBe(3_600);
  });

  it('refuses parameters outside the template’s schema and a template of another kind', async () => {
    await expect(
      app.transaction((tx) =>
        enqueueWhatsAppMessage(tx, crypto, {
          kind: 'otp',
          template: 'otp',
          phone: newPhone(),
          params: { code: '12ab56' },
        }),
      ),
    ).rejects.toThrow(z.ZodError);
    await expect(
      app.transaction((tx) =>
        enqueueWhatsAppMessage(tx, crypto, { ...alert(newPhone()), kind: 'notification' }),
      ),
    ).rejects.toThrow('Template alert is not of kind notification');
    await expect(
      app.transaction((tx) => enqueueWhatsAppMessage(tx, crypto, alert('0944123456'))),
    ).rejects.toThrow('E.164');
  });

  it('queues one message per source event', async () => {
    const sourceEventId = uuidv7();
    const phone = newPhone();
    const first = await app.transaction((tx) =>
      enqueueWhatsAppMessage(tx, crypto, { ...alert(phone), sourceEventId }),
    );
    const again = await app.transaction((tx) =>
      enqueueWhatsAppMessage(tx, crypto, { ...alert(phone), sourceEventId }),
    );
    expect(first).toMatchObject({ queued: true, duplicate: false });
    expect(again).toEqual({
      queued: true,
      duplicate: true,
      messageId: first.queued && first.messageId,
    });
  });

  it('queues one message when two transactions queue the same source event at once', async () => {
    const sourceEventId = uuidv7();
    const phone = newPhone();
    const results = await Promise.all(
      [0, 1].map(() =>
        app.transaction(async (tx) => {
          const result = await enqueueWhatsAppMessage(tx, crypto, {
            ...alert(phone),
            sourceEventId,
          });
          // Holds the first insert open, so the second meets it uncommitted.
          await new Promise((resolve) => setTimeout(resolve, 100));
          return result;
        }),
      ),
    );
    expect(results.map((r) => r.queued && r.duplicate).sort()).toEqual([false, true]);
    expect(
      await app.$count(whatsappMessages, eq(whatsappMessages.sourceEventId, sourceEventId)),
    ).toBe(1);
  });

  it('refuses a notification to an opted-out phone without inserting anything', async () => {
    // S03 has no notification template; S14 adds the first. A test-only one checks the rule.
    const templates = messageTemplates as Record<string, unknown>;
    templates.test_notification = {
      kind: 'notification',
      params: z.strictObject({}),
      deadlineSeconds: 600,
    };
    try {
      const phone = newPhone();
      const recipientHash = whatsappRecipientHash(crypto, phone);
      await app
        .insert(whatsappOptOuts)
        .values({ recipientHash, optedOutAt: sql`now()`, lastKeywordAt: sql`now()` });
      const before = await app.$count(whatsappMessages);
      const result = await app.transaction((tx) =>
        enqueueWhatsAppMessage(tx, crypto, {
          kind: 'notification',
          template: 'test_notification' as 'alert',
          phone,
          params: {} as never,
          sourceEventId: uuidv7(),
        }),
      );
      expect(result).toEqual({ queued: false, reason: 'opted_out' });
      expect(await app.$count(whatsappMessages)).toBe(before);
      // Alerts and OTPs are not refused at queue time: the gateway skips alerts at claim (rule 27).
      await expect(
        app.transaction((tx) => enqueueWhatsAppMessage(tx, crypto, alert(phone))),
      ).resolves.toMatchObject({ queued: true });
    } finally {
      delete templates.test_notification;
    }
  });

  it('wakes a listener when the transaction commits, and not before', async () => {
    const listener = new pg.Client({ connectionString: inject('appUrl') });
    await listener.connect();
    try {
      const heard: string[] = [];
      listener.on('notification', (n) => heard.push(n.channel));
      await listener.query('listen whatsapp_messages');
      await app.transaction(async (tx) => {
        await enqueueWhatsAppMessage(tx, crypto, alert(newPhone()));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(heard).toEqual([]);
      });
      await expect.poll(() => heard).toEqual(['whatsapp_messages']);
    } finally {
      await listener.end();
    }
  });
});

describe('isWhatsAppOptedOut', () => {
  it('follows the later of the opt-out and the opt-in', async () => {
    const hash = whatsappRecipientHash(crypto, newPhone());
    const check = () => app.transaction((tx) => isWhatsAppOptedOut(tx, hash));
    expect(await check()).toBe(false);
    await app.insert(whatsappOptOuts).values({
      recipientHash: hash,
      optedOutAt: sql`now() - interval '1 hour'`,
      lastKeywordAt: sql`now() - interval '1 hour'`,
    });
    expect(await check()).toBe(true);
    await app
      .update(whatsappOptOuts)
      .set({ optedInAt: sql`now()`, lastKeywordAt: sql`now()` })
      .where(eq(whatsappOptOuts.recipientHash, hash));
    expect(await check()).toBe(false);
  });
});

describe('sendAvailability', () => {
  // Each case owns its numbers: other healthy numbers of the run are paused first.
  async function only<T>(work: () => Promise<T>): Promise<T> {
    await app
      .update(whatsappSessions)
      .set({ pausedAt: sql`now()`, pauseReason: 'manual' })
      .where(sql`${whatsappSessions.pausedAt} is null and ${whatsappSessions.archivedAt} is null`);
    return work();
  }
  const availability = (hash: string, kind: 'otp' | 'alert') =>
    app.transaction((tx) => sendAvailability(tx, hash, kind));

  it('finds none without a healthy number', async () => {
    await only(async () => {
      const hash = whatsappRecipientHash(crypto, newPhone());
      await healthyNumber(30, { pausedAt: new Date(), pauseReason: 'manual' });
      await healthyNumber(30, { leaseHolder: null, leaseExpiresAt: null });
      await healthyNumber(30, { state: 'disconnected' });
      expect(await availability(hash, 'otp')).toBeUndefined();
    });
  });

  it('prefers the number that knows the recipient, else the one with most budget left', async () => {
    await only(async () => {
      const hash = whatsappRecipientHash(crypto, newPhone());
      const busy = await healthyNumber();
      const free = await healthyNumber();
      await sent(busy.id, `other-${uuidv7()}`, 5);
      expect(await availability(hash, 'otp')).toEqual({ sessionId: free.id, firstContact: true });
      await app.insert(whatsappKnownRecipients).values({
        sessionId: busy.id,
        recipientHash: hash,
        firstSentAt: sql`now()`,
        lastSentAt: sql`now()`,
      });
      expect(await availability(hash, 'otp')).toEqual({ sessionId: busy.id, firstContact: false });
    });
  });

  it('counts the number’s caps from sent messages, OTPs included', async () => {
    await only(async () => {
      const hash = whatsappRecipientHash(crypto, newPhone());
      const young = await healthyNumber(0);
      await sent(young.id, `other-${uuidv7()}`, 15, { kind: 'otp', firstContact: true });
      // Day 1: 30 a day, 15 first contacts; this recipient would be the 16th.
      expect(await availability(hash, 'otp')).toBeUndefined();
      // Sends older than 24 hours no longer count.
      const old = await healthyNumber(2);
      await sent(old.id, `other-${uuidv7()}`, 15, { firstContact: true, ago: '25 hours' });
      expect(await availability(hash, 'otp')).toEqual({ sessionId: old.id, firstContact: true });
    });
  });

  it('counts only the current link’s sends after a re-link with another phone', async () => {
    await only(async () => {
      const hash = whatsappRecipientHash(crypto, newPhone());
      const relinked = await healthyNumber(30);
      await sent(relinked.id, `other-${uuidv7()}`, 30, { ago: '2 hours' });
      // Day 1 again (a new phone): the old phone's 30 sends would fill its cap of 30.
      await app
        .update(whatsappSessions)
        .set({ linkedAt: sql`now() - interval '1 hour'` })
        .where(eq(whatsappSessions.id, relinked.id));
      expect(await availability(hash, 'otp')).toEqual({
        sessionId: relinked.id,
        firstContact: true,
      });
    });
  });

  it('applies the per-recipient limits to every kind but OTPs, across numbers', async () => {
    await only(async () => {
      const hash = whatsappRecipientHash(crypto, newPhone());
      const first = await healthyNumber();
      const second = await healthyNumber();
      await sent(first.id, hash, 1, { ago: '30 seconds' });
      expect(await availability(hash, 'alert')).toBeUndefined();
      expect((await availability(hash, 'otp'))?.sessionId).toBeOneOf([first.id, second.id]);
      // OTPs sent to them do not count toward their per-recipient limits.
      const other = whatsappRecipientHash(crypto, newPhone());
      await sent(second.id, other, 3, { kind: 'otp', ago: '30 seconds' });
      expect(await availability(other, 'alert')).toBeDefined();
    });
  });
});
