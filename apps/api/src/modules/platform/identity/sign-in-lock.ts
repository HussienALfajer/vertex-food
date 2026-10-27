import { signInPolicy } from '@vertex-food/contracts';
import { accounts, type Database, type Transaction } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { auditPlatform } from '../../../core/audit/audit.js';
import { accountById } from './accounts.js';
import { signInLocked } from './decoy-locks.js';

const MINUTE_MS = 60_000;

/**
 * Rule 11: five wrong passwords in a row lock password sign-in for 15 minutes. Each attempt is
 * counted before its password is checked, under the account's row lock, so concurrent attempts
 * never get more than five guesses; a correct password clears the count. Copied from Vertex Shifa.
 */
export class SignInLock {
  constructor(private readonly db: Database) {}

  async claim(accountId: string, now: Date): Promise<void> {
    const lockedUntil = await this.db.transaction(async (tx) => {
      const row = await accountById(tx, accountId, { lock: 'update' });
      if (!row) return undefined;
      if (row.signInLockedUntil && row.signInLockedUntil > now) return row.signInLockedUntil;
      if (row.failedSignIns >= signInPolicy.maxFailures) return this.lock(tx, accountId, now);
      await tx
        .update(accounts)
        .set({ failedSignIns: row.failedSignIns + 1, signInLockedUntil: null, updatedAt: now })
        .where(eq(accounts.id, accountId));
      return undefined;
    });
    if (lockedUntil) throw signInLocked(lockedUntil);
  }

  /** A wrong password: the fifth in a row locks the account. */
  async failed(accountId: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await accountById(tx, accountId, { lock: 'update' });
      if (row && row.failedSignIns >= signInPolicy.maxFailures && !row.signInLockedUntil) {
        await this.lock(tx, accountId, now);
      }
    });
  }

  async succeeded(accountId: string): Promise<void> {
    await this.db
      .update(accounts)
      .set({ failedSignIns: 0, signInLockedUntil: null, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
  }

  private async lock(tx: Transaction, accountId: string, now: Date): Promise<Date> {
    const until = new Date(now.getTime() + signInPolicy.lockMinutes * MINUTE_MS);
    await tx
      .update(accounts)
      .set({ failedSignIns: 0, signInLockedUntil: until, updatedAt: now })
      .where(eq(accounts.id, accountId));
    await auditPlatform(
      tx,
      { kind: 'system', name: 'identity/sign-in' },
      {
        action: 'account.sign_in_locked',
        entityType: 'account',
        entityId: accountId,
      },
    );
    return until;
  }
}
