import { describe, expect, it } from 'vitest';
import { disconnectAction, reconnectDelay } from './session-state.js';

describe('disconnectAction', () => {
  it('follows the disconnect table', () => {
    expect(disconnectAction('restart_required')).toEqual({ kind: 'reconnect_now' });
    expect(disconnectAction('connection_lost')).toEqual({ kind: 'reconnect_later' });
    expect(disconnectAction('logged_out')).toEqual({ kind: 'stop', state: 'needs_relink' });
    expect(disconnectAction('forbidden')).toEqual({ kind: 'stop', state: 'banned' });
    expect(disconnectAction('connection_replaced')).toEqual({ kind: 'release' });
  });
});

describe('reconnectDelay', () => {
  it('waits 1 s, doubling to at most 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000,
    ]);
  });
});
