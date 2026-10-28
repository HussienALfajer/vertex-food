import { proto, type WAMessage, type WAMessageUpdate } from 'baileys';
import { describe, expect, it } from 'vitest';
import {
  accountPhoneOf,
  disconnectReasonOf,
  incomingOf,
  isIgnoredJid,
  jidOfPhone,
  phoneOfJid,
  receiptOf,
  statusCodeOf,
} from './baileys-mapping.js';

// Recorded shapes of Baileys v7 payloads with synthetic numbers (+999, never assigned).
const STAFF_JID = '999100000001@s.whatsapp.net';
const STAFF_LID = '123456789012345@lid';
const now = new Date('2026-10-28T10:00:00.000Z');

function upsert(overrides: Partial<WAMessage['key']>, message: WAMessage['message']): WAMessage {
  return {
    key: { remoteJid: STAFF_JID, fromMe: false, id: 'INCOMING1', ...overrides },
    message,
    messageTimestamp: 1_793_181_600,
  } as WAMessage;
}

const noLid = async () => null;

describe('disconnect codes', () => {
  it('maps 515, 401, 403 and 440, and anything else to a lost connection', () => {
    expect(disconnectReasonOf(515)).toBe('restart_required');
    expect(disconnectReasonOf(401)).toBe('logged_out');
    expect(disconnectReasonOf(403)).toBe('forbidden');
    expect(disconnectReasonOf(440)).toBe('connection_replaced');
    for (const code of [408, 428, 500, 503, undefined]) {
      expect(disconnectReasonOf(code)).toBe('connection_lost');
    }
  });

  it('reads the status code of a Boom error and nothing else', () => {
    expect(statusCodeOf({ output: { statusCode: 401 } })).toBe(401);
    expect(statusCodeOf(new Error('closed'))).toBeUndefined();
    expect(statusCodeOf(undefined)).toBeUndefined();
  });
});

describe('addresses', () => {
  it('reads the phone of a phone-number JID, with or without a device', () => {
    expect(phoneOfJid(STAFF_JID)).toBe('+999100000001');
    expect(phoneOfJid('999000000001:12@s.whatsapp.net')).toBe('+999000000001');
    expect(phoneOfJid(STAFF_LID)).toBeNull();
    expect(phoneOfJid('120363000000000000@g.us')).toBeNull();
    expect(phoneOfJid(undefined)).toBeNull();
    expect(jidOfPhone('+999100000001')).toBe(STAFF_JID);
  });

  it('counts a session linked only once `creds.me` is set', () => {
    expect(accountPhoneOf({ me: { id: '999000000001:7@s.whatsapp.net' } })).toBe('+999000000001');
    expect(accountPhoneOf({})).toBeNull();
  });

  it('ignores groups, broadcasts, status and newsletters', () => {
    expect(isIgnoredJid('120363000000000000@g.us')).toBe(true);
    expect(isIgnoredJid('status@broadcast')).toBe(true);
    expect(isIgnoredJid('1234@broadcast')).toBe(true);
    expect(isIgnoredJid('120363000000000000@newsletter')).toBe(true);
    expect(isIgnoredJid(STAFF_JID)).toBe(false);
    expect(isIgnoredJid(STAFF_LID)).toBe(false);
  });
});

describe('receipts', () => {
  const update = (status: number, fromMe = true): WAMessageUpdate => ({
    key: { remoteJid: STAFF_JID, fromMe, id: 'SENT1' },
    update: { status },
  });

  it('maps server, delivery and read acknowledgements of sent messages', () => {
    const { Status } = proto.WebMessageInfo;
    expect(receiptOf(update(Status.SERVER_ACK), now)).toEqual({
      messageId: 'SENT1',
      status: 'sent',
      at: now,
    });
    expect(receiptOf(update(Status.DELIVERY_ACK), now)?.status).toBe('delivered');
    expect(receiptOf(update(Status.READ), now)?.status).toBe('read');
    expect(receiptOf(update(Status.PLAYED), now)?.status).toBe('read');
    expect(receiptOf(update(Status.ERROR), now)?.status).toBe('failed');
  });

  it('ignores pending, incoming messages and updates without a status', () => {
    expect(receiptOf(update(proto.WebMessageInfo.Status.PENDING), now)).toBeUndefined();
    expect(receiptOf(update(proto.WebMessageInfo.Status.READ, false), now)).toBeUndefined();
    expect(receiptOf({ key: { fromMe: true, id: 'SENT1' }, update: {} }, now)).toBeUndefined();
  });
});

describe('incoming messages', () => {
  it('reports a plain or extended text with its sender and time', async () => {
    expect(await incomingOf(upsert({}, { conversation: 'إيقاف' }), noLid)).toEqual({
      id: 'INCOMING1',
      from: '+999100000001',
      text: 'إيقاف',
      sentAt: new Date(1_793_181_600_000),
    });
    const extended = upsert({}, { extendedTextMessage: { text: 'synthetic' } });
    expect((await incomingOf(extended, noLid))?.text).toBe('synthetic');
    const ephemeral = upsert({}, { ephemeralMessage: { message: { conversation: 'STOP' } } });
    expect((await incomingOf(ephemeral, noLid))?.text).toBe('STOP');
  });

  it('resolves a LID-addressed sender from the alternate JID or the LID mapping', async () => {
    const alt = upsert({ remoteJid: STAFF_LID, remoteJidAlt: STAFF_JID }, { conversation: 'x' });
    expect((await incomingOf(alt, noLid))?.from).toBe('+999100000001');
    const mapped = upsert({ remoteJid: STAFF_LID }, { conversation: 'x' });
    expect((await incomingOf(mapped, async () => STAFF_JID))?.from).toBe('+999100000001');
    expect((await incomingOf(mapped, noLid))?.from).toBeNull();
    const failing = async () => {
      throw new Error('mapping unavailable');
    };
    expect((await incomingOf(mapped, failing))?.from).toBeNull();
  });

  it('drops its own messages, groups, broadcasts, newsletters and media', async () => {
    const text = { conversation: 'synthetic' };
    expect(await incomingOf(upsert({ fromMe: true }, text), noLid)).toBeUndefined();
    const group = upsert({ remoteJid: '120363000000000000@g.us', participant: STAFF_JID }, text);
    expect(await incomingOf(group, noLid)).toBeUndefined();
    expect(
      await incomingOf(upsert({ remoteJid: 'status@broadcast' }, text), noLid),
    ).toBeUndefined();
    const newsletter = upsert({ remoteJid: '120363000000000000@newsletter' }, text);
    expect(await incomingOf(newsletter, noLid)).toBeUndefined();
    const image = upsert({}, { imageMessage: { caption: 'synthetic' } });
    expect(await incomingOf(image, noLid)).toBeUndefined();
    expect(await incomingOf(upsert({}, null), noLid)).toBeUndefined();
  });
});
