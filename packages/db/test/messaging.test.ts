import {
  messageTemplateKeys,
  messageTemplates,
  otpChallengeDeliveryStatuses,
  whatsappAlertEventSchema,
  whatsappSessionStateSchema,
} from '@vertex-food/contracts';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  otpChallenges,
  whatsappMessages,
  whatsappSessionEvents,
  whatsappSessions,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S03 in the database: the messaging tables hold the contracts' values and nothing else, the
// app role changes only what may change, and session events are append-only.

const { owner, app } = connect();
const CHECK_REFUSAL = /violates check constraint/;
const DENIED = /permission denied for table/;
const UNIQUE_REFUSAL = /duplicate key value violates unique constraint/;

let labels = 0;
const soon = () => new Date(Date.now() + 60_000);

async function newSession(values: Partial<typeof whatsappSessions.$inferInsert> = {}) {
  const [row] = await app
    .insert(whatsappSessions)
    .values({
      label: `رقم ${labels++}`,
      state: 'linking',
      linkDeadlineAt: soon(),
      ...values,
    })
    .returning();
  return row as typeof whatsappSessions.$inferSelect;
}

function message(values: Partial<typeof whatsappMessages.$inferInsert> = {}) {
  return {
    kind: 'alert',
    template: 'alert',
    recipientHash: `hash-${uuidv7()}`,
    status: 'queued',
    deadlineAt: soon(),
    nextAttemptAt: new Date(),
    ...values,
  } satisfies typeof whatsappMessages.$inferInsert;
}

describe('whatsapp_sessions', () => {
  it('takes every session state of the contracts and refuses another', async () => {
    for (const state of whatsappSessionStateSchema.options) {
      const values =
        state === 'unlinked'
          ? { state, archivedAt: new Date() }
          : { state, linkDeadlineAt: soon() };
      await expect(newSession(values), state).resolves.toMatchObject({ state });
    }
    expect(await refusal(newSession({ state: 'paused' }))).toMatch(CHECK_REFUSAL);
  });

  it('keeps pause, lease and QR fields paired, and archives exactly the unlinked', async () => {
    expect(await refusal(newSession({ pausedAt: new Date() }))).toMatch(CHECK_REFUSAL);
    expect(await refusal(newSession({ leaseHolder: uuidv7() }))).toMatch(CHECK_REFUSAL);
    expect(await refusal(newSession({ qrSealed: 'v1.a.b.c' }))).toMatch(CHECK_REFUSAL);
    expect(await refusal(newSession({ archivedAt: new Date() }))).toMatch(CHECK_REFUSAL);
    expect(await refusal(newSession({ linkDeadlineAt: null }))).toMatch(CHECK_REFUSAL);
    expect(await refusal(newSession({ lastDisconnectReason: 'Stream Errored' }))).toMatch(
      CHECK_REFUSAL,
    );
  });

  it('keeps labels and phones unique among unarchived sessions only', async () => {
    const first = await newSession({ phone: '+9990000001' });
    expect(await refusal(newSession({ label: first.label }))).toMatch(UNIQUE_REFUSAL);
    expect(await refusal(newSession({ phone: '+9990000001' }))).toMatch(UNIQUE_REFUSAL);
    await app
      .update(whatsappSessions)
      .set({ state: 'unlinked', archivedAt: new Date() })
      .where(eq(whatsappSessions.id, first.id));
    await expect(newSession({ label: first.label, phone: '+9990000001' })).resolves.toBeDefined();
  });
});

describe('whatsapp_session_events', () => {
  it('takes the alert events of the contracts as the reason of alert_sent', async () => {
    const session = await newSession();
    for (const event of whatsappAlertEventSchema.options) {
      await app
        .insert(whatsappSessionEvents)
        .values({ sessionId: session.id, type: 'alert_sent', reason: event });
    }
    expect(
      await refusal(
        app
          .insert(whatsappSessionEvents)
          .values({ sessionId: session.id, type: 'alert_sent', reason: 'a library message' }),
      ),
    ).toMatch(CHECK_REFUSAL);
  });

  it('refuses UPDATE and DELETE by the app role and, through the trigger, by the owner', async () => {
    const session = await newSession();
    const [event] = await app
      .insert(whatsappSessionEvents)
      .values({ sessionId: session.id, type: 'created' })
      .returning();
    const byId = eq(whatsappSessionEvents.id, event?.id as string);
    expect(
      await refusal(app.update(whatsappSessionEvents).set({ type: 'linked' }).where(byId)),
    ).toMatch(DENIED);
    expect(await refusal(app.delete(whatsappSessionEvents).where(byId))).toMatch(DENIED);
    expect(
      await refusal(owner.update(whatsappSessionEvents).set({ type: 'linked' }).where(byId)),
    ).toBe('whatsapp_session_events is append-only: UPDATE refused');
    expect(await refusal(owner.delete(whatsappSessionEvents).where(byId))).toBe(
      'whatsapp_session_events is append-only: DELETE refused',
    );
  });
});

describe('whatsapp_messages', () => {
  it('takes each template of the contracts with its own kind only', async () => {
    const session = await newSession();
    const account = uuidv7();
    await app.insert(accounts).values({ id: account, phone: `+99900${Date.now() % 1e7}` });
    for (const template of messageTemplateKeys) {
      const { kind } = messageTemplates[template];
      const challenge = uuidv7();
      if (kind === 'otp') {
        await app.insert(otpChallenges).values({
          id: challenge,
          accountId: account,
          purpose: 'new_device',
          codeHash: 'hash',
          expiresAt: soon(),
          deliveryStatus: 'queued',
        });
      }
      await app.insert(whatsappMessages).values(
        message({
          kind,
          template,
          sessionId: session.id,
          otpChallengeId: kind === 'otp' ? challenge : null,
        }),
      );
      const other = kind === 'alert' ? 'otp' : 'alert';
      expect(
        await refusal(app.insert(whatsappMessages).values(message({ kind: other, template }))),
        template,
      ).toMatch(CHECK_REFUSAL);
    }
    expect(
      await refusal(app.insert(whatsappMessages).values(message({ template: 'marketing' }))),
    ).toMatch(CHECK_REFUSAL);
  });

  it('holds the shape rules: OTP challenge, reply number, failure reason, sent time', async () => {
    for (const values of [
      { kind: 'otp', template: 'otp' },
      { kind: 'auto_reply', template: 'auto_reply' },
      { status: 'failed' },
      { status: 'queued', failureReason: 'deadline' },
      { status: 'failed', failureReason: 'no_number' },
      { status: 'sent' },
      { sentAt: new Date() },
      { kind: 'notification', template: 'alert' },
    ] as const) {
      expect(
        await refusal(app.insert(whatsappMessages).values(message(values))),
        JSON.stringify(values),
      ).toMatch(CHECK_REFUSAL);
    }
    await expect(
      app
        .insert(whatsappMessages)
        .values(message({ status: 'expired', failureReason: 'deadline' })),
    ).resolves.toBeDefined();
  });

  it('lets the app role move a message but never change what it is', async () => {
    const [row] = await app.insert(whatsappMessages).values(message()).returning();
    const byId = eq(whatsappMessages.id, row?.id as string);
    await app.update(whatsappMessages).set({ status: 'sending', attempts: 1 }).where(byId);
    for (const change of [
      { template: 'auto_reply' },
      { recipientHash: 'other' },
      { deadlineAt: soon() },
      { sourceEventId: uuidv7() },
    ]) {
      expect(
        await refusal(app.update(whatsappMessages).set(change).where(byId)),
        JSON.stringify(change),
      ).toMatch(DENIED);
    }
    await app.delete(whatsappMessages).where(byId);
  });

  it('makes one message per OTP challenge and per source event', async () => {
    const event = uuidv7();
    await app.insert(whatsappMessages).values(message({ sourceEventId: event }));
    expect(
      await refusal(app.insert(whatsappMessages).values(message({ sourceEventId: event }))),
    ).toMatch(UNIQUE_REFUSAL);
  });
});

describe('otp_challenges.delivery_status', () => {
  it('takes the S03 statuses, S02 rows included', async () => {
    const accountId = uuidv7();
    await app.insert(accounts).values({ id: accountId, phone: `+99901${Date.now() % 1e7}` });
    for (const deliveryStatus of otpChallengeDeliveryStatuses) {
      await app.insert(otpChallenges).values({
        accountId,
        purpose: 'new_device',
        codeHash: 'hash',
        expiresAt: soon(),
        deliveryStatus,
      });
    }
    expect(
      await refusal(
        app.insert(otpChallenges).values({
          accountId,
          purpose: 'new_device',
          codeHash: 'hash',
          expiresAt: soon(),
          deliveryStatus: 'read',
        }),
      ),
    ).toMatch(CHECK_REFUSAL);
    const [{ count } = { count: 0 }] = await app
      .select({ count: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(eq(otpChallenges.accountId, accountId));
    expect(count).toBe(otpChallengeDeliveryStatuses.length);
  });
});
