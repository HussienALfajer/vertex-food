import { type DisconnectReason, whatsappPolicy } from '@vertex-food/contracts';

/**
 * What a session does when its connection closes (spec S03, "Session states", from Vertex
 * Shifa's ADR 0022): reconnect at once, reconnect after a backoff, stop in a state that needs an
 * admin, or let go of the session because another connection replaced this one.
 */
export type DisconnectAction =
  | { kind: 'reconnect_now' }
  | { kind: 'reconnect_later' }
  | { kind: 'stop'; state: 'needs_relink' | 'banned' }
  | { kind: 'release' };

export function disconnectAction(reason: DisconnectReason): DisconnectAction {
  switch (reason) {
    case 'restart_required':
      return { kind: 'reconnect_now' };
    case 'logged_out':
      return { kind: 'stop', state: 'needs_relink' };
    case 'forbidden':
      return { kind: 'stop', state: 'banned' };
    case 'connection_replaced':
      return { kind: 'release' };
    case 'connection_lost':
      return { kind: 'reconnect_later' };
  }
}

/** The wait before reconnect attempt `attempt` (from 1): 1 s, doubling, at most 60 s. */
export function reconnectDelay(attempt: number): number {
  const { initial, max } = whatsappPolicy.reconnectSeconds;
  return Math.min(initial * 2 ** (attempt - 1), max) * 1000;
}
