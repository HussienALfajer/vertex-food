import { DomainError } from '@vertex-food/contracts';
import { type Database, type Transaction, usedTokens } from '@vertex-food/db';
import { and, eq } from 'drizzle-orm';
import { randomToken } from './secrets.js';

export type TokenKind = 'ticket' | 'console_step' | 'proof_of_work';

/**
 * Uses up a single-use token (a ticket, a proof-of-work challenge) in `db`, which is the
 * transaction of the step the token authorizes, so the use commits or rolls back with that step
 * and survives a restart. False when it was already used: a concurrent use of the same token waits
 * here for the other transaction and loses once that one commits (the unique key of `used_tokens`).
 */
export async function useToken(
  db: Database | Transaction,
  kind: TokenKind,
  tokenId: string,
  expiresAt: Date,
): Promise<boolean> {
  const inserted = await db
    .insert(usedTokens)
    .values({ kind, tokenId, expiresAt })
    .onConflictDoNothing({ target: [usedTokens.kind, usedTokens.tokenId] })
    .returning({ id: usedTokens.id });
  return inserted.length === 1;
}

/** Whether the token was used, by a committed step: an early refusal; `useToken` decides. */
export async function isTokenUsed(db: Database, kind: TokenKind, tokenId: string) {
  const [row] = await db
    .select({ id: usedTokens.id })
    .from(usedTokens)
    .where(and(eq(usedTokens.kind, kind), eq(usedTokens.tokenId, tokenId)));
  return row !== undefined;
}

/**
 * Server nonces a device or a member signs (spec S02 rule 44): single use, valid 60 seconds, bound
 * to what they were issued for (`device:<tenant>:<device>`), in this process's memory. Unlike
 * tokens, nonces fail safe on a restart: the server forgets the ones it issued, so it refuses them
 * all, and the device asks for a new one.
 */
export class Nonces {
  private readonly pending = new Map<string, { binding: string; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  issue(binding: string): { nonce: string; expiresAt: Date } {
    const now = this.now();
    for (const [nonce, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(nonce);
    }
    const nonce = randomToken(24);
    const expiresAt = now + this.ttlMs;
    this.pending.set(nonce, { binding, expiresAt });
    return { nonce, expiresAt: new Date(expiresAt) };
  }

  /** Uses up `nonce`, or refuses with `SIGNATURE_INVALID` when unknown, expired, used or bound elsewhere. */
  take(nonce: string, binding: string): void {
    const entry = this.pending.get(nonce);
    this.pending.delete(nonce);
    if (!entry || entry.binding !== binding || entry.expiresAt <= this.now()) {
      throw new DomainError('SIGNATURE_INVALID', 'Unknown or expired nonce');
    }
  }
}
