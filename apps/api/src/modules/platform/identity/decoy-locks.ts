import { DomainError, signInPolicy } from '@vertex-food/contracts';
import { decoyPasswordHash, verifyPassword } from './secrets.js';

const MINUTE_MS = 60_000;

/** The answer to a locked sign-in, saying when to retry (spec S02 rule 11). */
export const signInLocked = (until: Date) =>
  new DomainError('RATE_LIMITED', `Sign-in locked until ${until.toISOString()}`);

/**
 * Sign-in failures of phones that cannot sign in (no account, no password, a disabled console
 * user), in this process's memory, keyed by a keyed hash of the phone. Each failure costs the same
 * password check as a real one, and five in a row lock the phone as they would lock a real account
 * (rule 11), so neither the answer nor its timing tells whether the phone exists.
 */
export class DecoyLocks {
  private readonly entries = new Map<string, { failures: number; lockedUntil: number }>();

  /** Counts a failed sign-in of `phoneKey` after a decoy password check; throws when locked. */
  async fail(phoneKey: string, password: string, now: Date): Promise<void> {
    // As the attempts of real accounts: counted before the slow check, with no wait in between, so
    // concurrent guesses lock a phone without an account exactly as they lock an account.
    for (const [key, entry] of this.entries) {
      if (entry.failures === 0 && entry.lockedUntil <= now.getTime()) this.entries.delete(key);
    }
    const entry = this.entries.get(phoneKey) ?? { failures: 0, lockedUntil: 0 };
    this.entries.set(phoneKey, entry);
    if (entry.lockedUntil > now.getTime()) throw signInLocked(new Date(entry.lockedUntil));
    const lock = () => {
      entry.failures = 0;
      entry.lockedUntil = now.getTime() + signInPolicy.lockMinutes * MINUTE_MS;
      return new Date(entry.lockedUntil);
    };
    if (entry.failures >= signInPolicy.maxFailures) throw signInLocked(lock());
    entry.failures += 1;
    await verifyPassword(password, await decoyPasswordHash());
    if (entry.failures >= signInPolicy.maxFailures && entry.lockedUntil <= now.getTime()) lock();
  }
}
