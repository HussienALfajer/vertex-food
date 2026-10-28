import { DomainError, type SignInIntent, ticketTtlSeconds } from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import { accounts, type Database, type Transaction } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import type { Ticket } from '../../../core/access/actor.js';
import { randomToken } from './secrets.js';
import { isTokenUsed, useToken } from './single-use.js';
import type { TicketPurpose, TokenSigner } from './tokens.js';

/** The keyed-hash purpose of a ticket's reference to the account's password. */
const TICKET_CREDENTIAL = 'ticket_credential';

const invalid = () => new DomainError('TICKET_INVALID', 'Invalid or used ticket');

/**
 * Sign-in tickets (spec S02 rule 44): signed, 10 minutes, single use. A ticket proves the account
 * passed a step (an OTP, a password) and lets it take the next one; `consume` uses it up in the
 * transaction of the next step, in PostgreSQL (`used_tokens`), so a restart forgets no use. A
 * ticket also names the password it rests on, so a password set or replaced (rule 14) voids the
 * tickets issued before it, as the console's step tickets do. Copied from Vertex Shifa and adapted.
 */
export class Tickets {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenSigner,
    private readonly hashes: KeyedHash,
  ) {}

  /** `account` as it is once the step that issues the ticket is done (its current password). */
  issue(
    purpose: TicketPurpose,
    intent: SignInIntent,
    account: { id: string; passwordHash: string | null },
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
        acc: account.id,
        ref: this.credentialRef(account.passwordHash),
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
    const ticket = {
      id: claims.jti,
      purpose,
      intent: claims.intent,
      accountId: claims.acc,
      tenantId: claims.tid,
      deviceId: claims.did,
      personalDeviceId: claims.pd,
      credentialRef: claims.ref,
    };
    await this.assertCredentialCurrent(this.db, ticket);
    return ticket;
  }

  /**
   * Uses up the ticket in `tx`, the transaction of the step it authorizes: if the step fails, the
   * ticket stays usable. A second use (a double submit, a replay, a concurrent request) is
   * `TICKET_INVALID`.
   */
  async consume(tx: Transaction, ticket: Ticket): Promise<void> {
    // Shared on the account: a password being replaced at this moment commits first, and voids it.
    await this.assertCredentialCurrent(tx, ticket, { lock: true });
    const expiresAt = new Date(Date.now() + ticketTtlSeconds * 1000);
    if (!(await useToken(tx, 'ticket', ticket.id, expiresAt))) throw invalid();
  }

  private credentialRef(passwordHash: string | null): string {
    return this.hashes.hash(TICKET_CREDENTIAL, passwordHash ?? '');
  }

  private async assertCredentialCurrent(
    db: Database | Transaction,
    ticket: Ticket,
    options: { lock?: boolean } = {},
  ): Promise<void> {
    const query = db
      .select({ passwordHash: accounts.passwordHash })
      .from(accounts)
      .where(eq(accounts.id, ticket.accountId));
    const [account] = await (options.lock ? query.for('share') : query);
    if (!account || this.credentialRef(account.passwordHash) !== ticket.credentialRef) {
      throw invalid();
    }
  }
}
