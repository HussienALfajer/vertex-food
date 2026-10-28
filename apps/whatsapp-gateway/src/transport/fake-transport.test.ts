import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryCredentials, STAFF_PHONE, SYRIAN_NUMBER } from '../../test/credentials.js';
import { FakeWhatsAppTransport } from './fake-transport.js';
import type { SessionEvents } from './whatsapp-transport.js';

function recorder() {
  const seen: unknown[][] = [];
  const events: SessionEvents = {
    qr: (code) => seen.push(['qr', code]),
    open: (account) => seen.push(['open', account]),
    close: (reason) => seen.push(['close', reason]),
    message: (message) => seen.push(['message', message.id]),
    receipt: (receipt) => seen.push(['receipt', receipt.status]),
    sentText: async (messageId) => (messageId === 'fake-message-1' ? 'synthetic' : null),
  };
  return { seen, events };
}

describe('FakeWhatsAppTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports events only after connect resolves: a QR code for a new session', async () => {
    const transport = new FakeWhatsAppTransport();
    const { seen, events } = recorder();
    await transport.connect('s1', memoryCredentials(), events);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([['qr', 'fake-qr-1']]);
  });

  it('links on a scan by storing the account and restarting, then opens with it', async () => {
    const transport = new FakeWhatsAppTransport();
    const credentials = memoryCredentials();
    const first = recorder();
    await transport.connect('s1', credentials, first.events);
    await vi.advanceTimersByTimeAsync(0);
    await transport.scan('s1', SYRIAN_NUMBER);
    expect(first.seen.at(-1)).toEqual(['close', 'restart_required']);
    expect(transport.isConnected('s1')).toBe(false);

    const second = recorder();
    await transport.connect('s1', credentials, second.events);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.seen).toEqual([['open', { phone: SYRIAN_NUMBER }]]);
  });

  it('replaces a session’s connection when it connects again, like WhatsApp’s 440', async () => {
    const transport = new FakeWhatsAppTransport();
    const credentials = memoryCredentials();
    const first = recorder();
    const old = await transport.connect('s1', credentials, first.events);
    await transport.connect('s1', credentials, recorder().events);
    expect(first.seen).toEqual([['close', 'connection_replaced']]);
    await expect(old.sendText(STAFF_PHONE, 'synthetic')).rejects.toThrow('closed');
    expect(transport.isConnected('s1')).toBe(true);
  });

  it('records what an open connection sends, fails when told to, refuses once closed', async () => {
    const transport = new FakeWhatsAppTransport();
    const connection = await transport.connect('s1', memoryCredentials(), recorder().events);
    expect(await connection.sendText(STAFF_PHONE, 'synthetic text')).toEqual({
      messageId: 'fake-message-1',
    });
    expect(transport.sent).toEqual([
      { sessionId: 's1', messageId: 'fake-message-1', to: STAFF_PHONE, text: 'synthetic text' },
    ]);
    transport.failNextSends(1);
    await expect(connection.sendText(STAFF_PHONE, 'synthetic')).rejects.toThrow('refused');
    await connection.close();
    expect(transport.isConnected('s1')).toBe(false);
    await expect(connection.sendText(STAFF_PHONE, 'synthetic')).rejects.toThrow('closed');
  });

  it('logs out by forgetting the account: the next connect shows a QR code', async () => {
    const transport = new FakeWhatsAppTransport();
    const credentials = memoryCredentials();
    await transport.connect('s1', credentials, recorder().events);
    await vi.advanceTimersByTimeAsync(0);
    await transport.scan('s1', SYRIAN_NUMBER);
    const connection = await transport.connect('s1', credentials, recorder().events);
    await connection.logout();
    expect(transport.loggedOut).toEqual(['s1']);
    expect(transport.isConnected('s1')).toBe(false);
    const next = recorder();
    await transport.connect('s1', credentials, next.events);
    await vi.advanceTimersByTimeAsync(0);
    expect(next.seen).toEqual([['qr', 'fake-qr-2']]);
  });

  it('delivers messages, receipts, retry requests and disconnects to the open connection', async () => {
    const transport = new FakeWhatsAppTransport();
    const { seen, events } = recorder();
    await transport.connect('s1', memoryCredentials(), events);
    transport.receive('s1', { id: 'm1', from: STAFF_PHONE, text: 'synthetic', sentAt: new Date() });
    transport.acknowledge('s1', { messageId: 'fake-message-1', status: 'read', at: new Date() });
    expect(await transport.retryRequest('s1', 'fake-message-1')).toBe('synthetic');
    transport.disconnect('s1', 'connection_lost');
    expect(seen).toEqual([
      ['message', 'm1'],
      ['receipt', 'read'],
      ['close', 'connection_lost'],
    ]);
    expect(() => transport.disconnect('s1', 'connection_lost')).toThrow('no open connection');
  });
});
