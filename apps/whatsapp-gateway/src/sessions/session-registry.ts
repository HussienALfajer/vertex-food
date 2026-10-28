import { Injectable } from '@nestjs/common';
import type { TransportConnection } from '../transport/whatsapp-transport.js';

/** Injection token of this gateway instance's random id: its `lease_holder` (spec S03 rule 1). */
export const GATEWAY_INSTANCE = Symbol('GatewayInstance');

/**
 * The connections of the sessions this instance runs that are open and linked now. Sessions add
 * and remove them; sending reads them. A session absent here never sends, even while its stored
 * state still says `connected` (during a reconnect, rule 2).
 */
@Injectable()
export class SessionRegistry {
  private readonly connected = new Map<string, TransportConnection>();

  set(sessionId: string, connection: TransportConnection): void {
    this.connected.set(sessionId, connection);
  }

  delete(sessionId: string): void {
    this.connected.delete(sessionId);
  }

  get(sessionId: string): TransportConnection | undefined {
    return this.connected.get(sessionId);
  }

  ids(): string[] {
    return [...this.connected.keys()];
  }
}
