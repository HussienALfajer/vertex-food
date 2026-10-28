import { whatsappKnownRecipients } from '@vertex-food/db';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PHONE,
  STAFF_PHONE,
  STRANGER_PHONE,
  SYRIAN_NUMBER,
  TURKISH_NUMBER,
} from './credentials.js';
import {
  addSession,
  db,
  enqueue,
  hashOf,
  linkedSession,
  otpChallenge,
  pastGaps,
  platformUser,
  resetMessaging,
} from './fixtures.js';
import { type Gateway, logs, startGateway } from './gateway.js';

let gw: Gateway;
const printed: string[] = [];

beforeEach(async () => {
  await resetMessaging();
  logs.length = 0;
  printed.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
  }
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    printed.push(String(chunk));
    return true;
  });
  gw = await startGateway();
});
afterEach(async () => {
  await gw.app.close();
  vi.restoreAllMocks();
});

const CODE = '864213';
const LABEL = 'رقم سوري تجريبي';

/** What must never reach a log: phones (with or without +), the code, the QR, any text. */
const SECRETS = [
  ...[SYRIAN_NUMBER, TURKISH_NUMBER, STAFF_PHONE, ADMIN_PHONE, STRANGER_PHONE].flatMap((phone) => [
    phone,
    phone.slice(1),
  ]),
  CODE,
  'fake-qr',
  LABEL,
  'رمز التحقق',
  'تنبيه فيرتكس',
  'فيرتكس فود',
  'من أنت',
  'إيقاف',
  'مرحبا',
];

describe('the gateway’s logs', () => {
  it('hold ids, kinds and reason codes, never a phone, parameter, body, code or QR', async () => {
    await platformUser(ADMIN_PHONE);
    const syrian = await linkedSession(gw, LABEL, SYRIAN_NUMBER);
    const turkish = await linkedSession(gw, 'رقم تركي', TURKISH_NUMBER);
    const linking = await addSession('رقم ثالث');
    await gw.tick();

    const challenge = await otpChallenge(STAFF_PHONE);
    await enqueue({
      kind: 'otp',
      template: 'otp',
      phone: STAFF_PHONE,
      params: { code: CODE },
      otpChallengeId: challenge,
    });
    await gw.drain();
    const sent = gw.transport.sent[0];
    if (!sent) throw new Error('Nothing sent');
    gw.transport.acknowledge(sent.sessionId, {
      messageId: sent.messageId,
      status: 'read',
      at: new Date(),
    });
    await db.insert(whatsappKnownRecipients).values({
      id: uuidv7(),
      sessionId: syrian,
      recipientHash: hashOf(ADMIN_PHONE),
      firstSentAt: sql`now()`,
      lastSentAt: sql`now()`,
    });
    gw.transport.receive(syrian, {
      id: 'in-1',
      from: ADMIN_PHONE,
      text: 'من أنت؟',
      sentAt: new Date(),
    });
    gw.transport.receive(syrian, {
      id: 'in-2',
      from: ADMIN_PHONE,
      text: 'إيقاف',
      sentAt: new Date(),
    });
    gw.transport.receive(syrian, {
      id: 'in-3',
      from: STRANGER_PHONE,
      text: 'مرحبا',
      sentAt: new Date(),
    });
    await gw.settle();

    gw.transport.failNextSends(1);
    gw.transport.disconnect(turkish, 'forbidden');
    gw.transport.disconnect(syrian, 'connection_lost');
    await gw.settle();
    await pastGaps();
    await gw.drain();
    await gw.sweep.run();
    await gw.settle();

    expect(logs.length).toBeGreaterThan(10);
    expect(logs.join('\n')).toContain(syrian);
    expect(logs.join('\n')).toContain(linking);
    const everything = [...logs, ...printed].join('\n');
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });
});
