import { DomainError, type SignInIntent, ticketTtlSeconds } from '@vertex-food/contracts';
import type { Database, Transaction } from '@vertex-food/db';
import type { Ticket } from '../../../core/access/actor.js';
import { randomToken } from './secrets.js';
import { isTokenUsed, useToken } from './single-use.js';
import type { TicketPurpose, TokenSigner } from './tokens.js';

const invalid = () => new DomainError('TICKET_INVALID', 'Invalid or used ticket');

/**
 * Sign-in tickets (spec S02 rule 44): signed, 10 minutes, single use. A ticket proves the account
 * passed a step (an OTP, a password) and lets it take the next one; `consume` uses it up in the
 * transaction of the next step, in PostgreSQL (`used_tokens`), so a restart forgets no use. Copied
 * from Vertex Shifa and adapted.
 */
export class Tickets {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenSigner,
  ) {}

  issue(
    purpose: TicketPurpose,
    intent: SignInIntent,
    accountId: string,
    where: {
      device?: { tenantId: string; deviceId: string } | null;
      personalDeviceId?: string | null;
    } = {},
  ): string {
    return this.tokens.sign(
      'ticket',
      {
        jti: randomToken(16),
        purpose,
        intent,
        acc: accountId,
        tid: where.device?.tenantId ?? null,
        did: where.device?.deviceId ?? null,
        pd: where.personalDeviceId ?? null,
      },
      ticketTtlSeconds,
    ).token;
  }

  /** A valid, unused ticket for `purpose`, or `TICKET_INVALID`. */
  async verify(token: string, purpose: TicketPurpose): Promise<Ticket> {
    const claims = this.tokens.verify(token, 'ticket');
    if (!claims || claims.purpose !== purpose) throw invalid();
    if (await isTokenUsed(this.db, 'ticket', claims.jti)) throw invalid();
    return {
      id: claims.jti,
      purpose,
      intent: claims.intent,
      accountId: claims.acc,
      tenantId: claims.tid,
      deviceId: claims.did,
      personalDeviceId: claims.pd,
    };
  }

  /**
   * Uses up the ticket in `tx`, the transaction of the step it authorizes: if the step fails, the
   * ticket stays usable. A second use (a double submit, a replay, a concurrent request) is
   * `TICKET_INVALID`.
   */
  async consume(tx: Transaction, ticket: Ticket): Promise<void> {
    const expiresAt = new Date(Date.now() + ticketTtlSeconds * 1000);
    if (!(await useToken(tx, 'ticket', ticket.id, expiresAt))) throw invalid();
  }
}
