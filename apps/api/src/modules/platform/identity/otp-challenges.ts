import { randomInt } from 'node:crypto';
import {
  DomainError,
  type ErrorCode,
  type OtpDeliveryStatus,
  type OtpPurpose,
  otpPolicy,
} from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import { accounts, type Database, otpChallenges } from '@vertex-food/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { OtpSender } from './otp-sender.js';

const HOUR_MS = 3_600_000;

/** What a challenge's state says about a code (shared by real challenges and decoys). */
type ChallengeState = { expiresAt: number; attempts: number; consumed: boolean };

function judge(state: ChallengeState, now: number): ErrorCode | undefined {
  if (state.consumed) return 'OTP_INVALID';
  if (state.expiresAt <= now) return 'OTP_EXPIRED';
  if (state.attempts >= otpPolicy.maxAttempts) return 'OTP_ATTEMPTS_EXCEEDED';
  return undefined;
}

/** A code sent to a phone: when, and whether it starts the resend cooldown. */
type Send = { at: number; startsCooldown: boolean };

/**
 * A new-device code whose delivery failed (spec S03 rule 19): it expires at once and starts no
 * cooldown, so the person may ask again at once. A first sign-in or a reset stays quiet instead
 * (S02 rule 13): it keeps its expiry and cooldown, as a decoy's would.
 */
const failedNewDevice = (row: { purpose: string; deliveryStatus: string }) =>
  row.purpose === 'new_device' && row.deliveryStatus === 'failed';

/** The cooldown between two sends and the hourly limit per phone (ADR 0012). */
function assertSendAllowed(sends: Send[], now: number, cooldownCode: ErrorCode) {
  const recent = sends.filter((send) => now - send.at < HOUR_MS);
  const last = Math.max(
    Number.NEGATIVE_INFINITY,
    ...recent.filter((send) => send.startsCooldown).map((send) => send.at),
  );
  if (now - last < otpPolicy.resendCooldownSeconds * 1000) {
    throw new DomainError(cooldownCode, 'An OTP was sent less than a minute ago');
  }
  if (recent.length >= otpPolicy.maxPerHour) {
    throw new DomainError('RATE_LIMITED', 'Too many OTPs for this phone this hour');
  }
}

const refused = (code: ErrorCode) => new DomainError(code, 'OTP refused');

/** A phone that gets no code: it answers exactly as a real challenge would (no enumeration). */
type Decoy = ChallengeState & { phoneKey: string; purpose: OtpPurpose; createdAt: number };

/**
 * OTP challenges (spec S02 rule 12, ADR 0012): six digits, 5 minutes, 5 attempts, 60 seconds
 * between sends, 3 an hour per phone; only a keyed hash of the code is stored. A request for a
 * phone that may not receive a code makes a decoy in memory under the same limits, so the answers
 * never tell whether the phone has an account.
 */
export class OtpChallenges {
  private readonly decoys = new Map<string, Decoy>();
  private readonly decoySends = new Map<string, number[]>();

  constructor(
    private readonly db: Database,
    private readonly hashes: KeyedHash,
    private readonly sender: OtpSender,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Sends a new code to the account in the challenge's transaction (spec S03 rule 18);
   * `cooldownCode` is what a send within the cooldown answers. Answers the challenge id, or
   * refuses with `OTP_DELIVERY_UNAVAILABLE` when the sender failed, unless `quietFailure`: then
   * the id comes back as for a decoy (an OTP request must not tell an eligible phone from another,
   * rule 13). A failed send is kept as a `failed` challenge, which counts toward the hourly limit.
   */
  async start(
    account: { id: string; phone: string },
    purpose: OtpPurpose,
    cooldownCode: ErrorCode,
    options: { quietFailure?: boolean } = {},
  ): Promise<string> {
    const now = this.now();
    const id = uuidv7();
    const code = String(randomInt(0, 10 ** otpPolicy.digits)).padStart(otpPolicy.digits, '0');
    const failed = await this.db.transaction(async (tx) => {
      // Serializes the sends of one account, so two requests never both pass the limits.
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .for('update');
      const sent = await tx
        .select({
          createdAt: otpChallenges.createdAt,
          purpose: otpChallenges.purpose,
          deliveryStatus: otpChallenges.deliveryStatus,
        })
        .from(otpChallenges)
        .where(
          and(
            eq(otpChallenges.accountId, account.id),
            gt(otpChallenges.createdAt, new Date(now - HOUR_MS)),
          ),
        )
        .orderBy(desc(otpChallenges.createdAt));
      assertSendAllowed(
        sent.map((row) => ({ at: row.createdAt.getTime(), startsCooldown: !failedNewDevice(row) })),
        now,
        cooldownCode,
      );
      await tx.insert(otpChallenges).values({
        id,
        accountId: account.id,
        purpose,
        codeHash: this.hashes.hash('otp', `${id}:${code}`),
        expiresAt: new Date(now + otpPolicy.ttlSeconds * 1000),
        deliveryStatus: this.sender.deliveryStatus,
        createdAt: new Date(now),
      });
      try {
        // A savepoint: a failed send leaves nothing of its own behind, the challenge stays.
        await tx.transaction((send) =>
          this.sender.send(send, {
            challengeId: id,
            accountId: account.id,
            phone: account.phone,
            code,
            purpose,
          }),
        );
        return false;
      } catch {
        // A quiet failure keeps the normal expiry: wrong codes then count attempts as a decoy's do.
        await tx
          .update(otpChallenges)
          .set({
            deliveryStatus: 'failed',
            ...(options.quietFailure ? {} : { expiresAt: new Date(now) }),
            updatedAt: new Date(),
          })
          .where(eq(otpChallenges.id, id));
        return true;
      }
    });
    if (failed && !options.quietFailure) {
      throw new DomainError('OTP_DELIVERY_UNAVAILABLE', 'The OTP could not be sent');
    }
    return id;
  }

  /** A decoy for `phoneKey` (a keyed hash of the phone), under the same limits as a send. */
  startDecoy(phoneKey: string, purpose: OtpPurpose, cooldownCode: ErrorCode): string {
    const now = this.now();
    this.sweep(now);
    const sent = this.decoySends.get(phoneKey) ?? [];
    assertSendAllowed(
      sent.map((at) => ({ at, startsCooldown: true })),
      now,
      cooldownCode,
    );
    this.decoySends.set(phoneKey, [...sent, now]);
    const id = uuidv7();
    this.decoys.set(id, {
      phoneKey,
      purpose,
      createdAt: now,
      expiresAt: now + otpPolicy.ttlSeconds * 1000,
      attempts: 0,
      consumed: false,
    });
    return id;
  }

  /** A new code for the challenge's account and purpose; the old code stops working. */
  async resend(challengeId: string): Promise<string> {
    const now = this.now();
    const [row] = await this.db
      .select({
        accountId: otpChallenges.accountId,
        purpose: otpChallenges.purpose,
        consumedAt: otpChallenges.consumedAt,
        createdAt: otpChallenges.createdAt,
        phone: accounts.phone,
      })
      .from(otpChallenges)
      .innerJoin(accounts, eq(accounts.id, otpChallenges.accountId))
      .where(eq(otpChallenges.id, challengeId));
    if (!row) {
      const decoy = this.decoys.get(challengeId);
      if (!decoy || decoy.consumed || now - decoy.createdAt >= HOUR_MS)
        throw refused('OTP_EXPIRED');
      const id = this.startDecoy(decoy.phoneKey, decoy.purpose, 'OTP_COOLDOWN');
      decoy.expiresAt = Math.min(decoy.expiresAt, now);
      return id;
    }
    if (row.consumedAt || now - row.createdAt.getTime() >= HOUR_MS) throw refused('OTP_EXPIRED');
    const purpose = row.purpose as OtpPurpose;
    // A first sign-in or a reset never tells an eligible phone apart, even when sending fails.
    const id = await this.start({ id: row.accountId, phone: row.phone }, purpose, 'OTP_COOLDOWN', {
      quietFailure: purpose !== 'new_device',
    });
    await this.db
      .update(otpChallenges)
      .set({ expiresAt: new Date(now), updatedAt: new Date() })
      .where(and(eq(otpChallenges.id, challengeId), gt(otpChallenges.expiresAt, new Date(now))));
    return id;
  }

  /**
   * Checks a code: answers the account and purpose and uses the challenge up, or refuses with
   * `OTP_INVALID` (a wrong code counts an attempt), `OTP_EXPIRED` or `OTP_ATTEMPTS_EXCEEDED`.
   */
  async verify(
    challengeId: string,
    code: string,
  ): Promise<{ accountId: string; purpose: OtpPurpose }> {
    const now = this.now();
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.id, challengeId))
        .for('update');
      if (!row) return undefined;
      const state = {
        // A new-device code the gateway could not deliver expires at once (spec S03 rule 19).
        expiresAt: failedNewDevice(row) ? 0 : row.expiresAt.getTime(),
        attempts: row.attempts,
        consumed: row.consumedAt !== null,
      };
      const refusal = judge(state, now);
      if (refusal) return { refusal };
      if (!this.hashes.matches('otp', `${row.id}:${code}`, row.codeHash)) {
        await tx
          .update(otpChallenges)
          .set({ attempts: row.attempts + 1, updatedAt: new Date() })
          .where(eq(otpChallenges.id, row.id));
        return { refusal: 'OTP_INVALID' as const };
      }
      await tx
        .update(otpChallenges)
        .set({ consumedAt: new Date(now), updatedAt: new Date() })
        .where(eq(otpChallenges.id, row.id));
      return { accountId: row.accountId, purpose: row.purpose as OtpPurpose };
    });
    if (outcome === undefined) {
      // A decoy never matches; it counts attempts and expires like a real challenge. A forgotten
      // decoy (after an hour, or a restart) answers as an old real challenge does.
      const decoy = this.decoys.get(challengeId);
      if (!decoy) throw refused('OTP_EXPIRED');
      const refusal = judge(decoy, now);
      if (refusal) throw refused(refusal);
      decoy.attempts += 1;
      throw refused('OTP_INVALID');
    }
    if ('refusal' in outcome) throw refused(outcome.refusal);
    return outcome;
  }

  /**
   * Where a new-device code is (spec S03 rule 21): its challenge's delivery status. Every other
   * purpose, a decoy or an unknown id answers `unknown`, so the answer never tells an account
   * from a decoy (S02 rule 13); a new-device code follows a correct password and has no decoy.
   */
  async deliveryStatus(challengeId: string): Promise<OtpDeliveryStatus> {
    const [row] = await this.db
      .select({ purpose: otpChallenges.purpose, deliveryStatus: otpChallenges.deliveryStatus })
      .from(otpChallenges)
      .where(eq(otpChallenges.id, challengeId));
    if (row?.purpose !== 'new_device') return 'unknown';
    return row.deliveryStatus as OtpDeliveryStatus;
  }

  /** Forgets decoys and decoy sends older than an hour. */
  private sweep(now: number) {
    for (const [id, decoy] of this.decoys) {
      if (now - decoy.createdAt >= HOUR_MS) this.decoys.delete(id);
    }
    for (const [key, sent] of this.decoySends) {
      const recent = sent.filter((time) => now - time < HOUR_MS);
      if (recent.length === 0) this.decoySends.delete(key);
      else this.decoySends.set(key, recent);
    }
  }
}
