import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assertPasswordStrong,
  type ChangePassword,
  type ConsoleMe,
  type ConsolePermission,
  type ConsoleRole,
  type ConsoleSetUp,
  type ConsoleSetup,
  type ConsoleSignIn,
  type ConsoleSignInResult,
  type ConsoleTotp,
  consolePolicy,
  DomainError,
  type ErrorCode,
  effectiveConsolePermissions,
  idSchema,
  signInPolicy,
  ticketTtlSeconds,
} from '@vertex-food/contracts';
import {
  type Database,
  platformSessions,
  platformUserRecoveryCodes,
  platformUsers,
  type Transaction,
} from '@vertex-food/db';
import { and, count, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { PlatformActor } from '../../../core/access/actor.js';
import type { ConsoleRequest } from '../../../core/access/session-verifier.js';
import { auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import { readTenant } from '../tenancy/index.js';
import { type KeyedHash, SECRET_BOX, type SecretBox } from './crypto.js';
import { DecoyLocks, signInLocked } from './decoy-locks.js';
import { KEYED_HASH } from './devices.service.js';
import { ProofOfWork } from './proof-of-work.js';
import { decoyPasswordHash, hashPassword, randomToken, verifyPassword } from './secrets.js';
import { isTokenUsed, useToken } from './single-use.js';
import { TokenSigner } from './tokens.js';
import { matchingStep, newTotpSecret, totpUri, typedCode } from './totp.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type PlatformUserRow = typeof platformUsers.$inferSelect;
type SessionRow = typeof platformSessions.$inferSelect;
type EndReason = NonNullable<SessionRow['endReason']>;

/** Keyed-hash purposes of the console's secrets: one never matches another. */
export const CONSOLE_HASH = {
  setupCode: 'platform_setup_code',
  recoveryCode: 'platform_recovery_code',
  session: 'platform_session',
  step: 'platform_step',
} as const;

/** The sealing context of a user's TOTP secret, so a secret copied to another row never opens. */
export const totpContext = (userId: string) => `platform_user:${userId}:totp`;

const invalidCredentials = () => new DomainError('INVALID_CREDENTIALS', 'Invalid credentials');
const invalidTicket = () => new DomainError('TICKET_INVALID', 'Invalid or used console step');
const totpInvalid = () => new DomainError('TOTP_INVALID', 'Invalid code');

/** A refusal decided inside a transaction whose writes (ending a session, its audit) commit. */
class Refusal {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
  ) {}
}

export function permissionsOfUser(user: PlatformUserRow): ConsolePermission[] {
  return effectiveConsolePermissions(
    user.role as ConsoleRole,
    user.grantedPermissions as ConsolePermission[],
    user.revokedPermissions as ConsolePermission[],
  );
}

export async function platformUserById(
  db: Database | Transaction,
  id: string,
  options: { lock?: 'update' } = {},
): Promise<PlatformUserRow | undefined> {
  const query = db.select().from(platformUsers).where(eq(platformUsers.id, id));
  const [row] = await (options.lock ? query.for(options.lock) : query);
  return row;
}

/** Ends the user's open sessions (all, or all but `exceptId`). */
export async function endPlatformSessions(
  tx: Transaction,
  userId: string,
  reason: EndReason,
  now: Date,
  exceptId?: string,
): Promise<void> {
  await tx
    .update(platformSessions)
    .set({ endedAt: now, endReason: reason, updatedAt: now })
    .where(
      and(
        eq(platformSessions.platformUserId, userId),
        isNull(platformSessions.endedAt),
        exceptId ? ne(platformSessions.id, exceptId) : undefined,
      ),
    );
}

/** Archives the user's recovery codes (a new enrollment, a reset). */
export async function archiveRecoveryCodes(tx: Transaction, userId: string, now: Date) {
  await tx
    .update(platformUserRecoveryCodes)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(platformUserRecoveryCodes.platformUserId, userId),
        isNull(platformUserRecoveryCodes.archivedAt),
      ),
    );
}

/** A new one-time setup code, valid 24 hours (rule 38), and the columns that store it. */
export function newSetupCode(hashes: KeyedHash, now: Date) {
  const code = typedCode(3);
  const expiresAt = new Date(now.getTime() + consolePolicy.setupCodeHours * HOUR_MS);
  return {
    code,
    expiresAt,
    columns: {
      setupCodeHash: hashes.hash(CONSOLE_HASH.setupCode, code),
      setupCodeExpiresAt: expiresAt,
    },
  };
}

/**
 * Signing in to the console and its sessions (spec S02 rules 38–43): phone and password (or the
 * one-time setup code), then a TOTP code or a recovery code; setup with the first password, the
 * TOTP enrollment and ten recovery codes; TOTP re-authentication; and the verification of every
 * console request, written to the platform audit. Answers to unknown phones and disabled users are
 * those of a wrong password, after the same work (no enumeration). Copied from Vertex Shifa and
 * adapted.
 */
@Injectable()
export class ConsoleAuthService {
  private readonly logger = new Logger('ConsoleSessions');
  /** Sign-in steps: 30 per 10 minutes per address, as the staff sign-in (rule 12). */
  private readonly perAddress = new RateLimiter(30, 10 * MINUTE_MS);
  private readonly reauthsPerSession = new RateLimiter(5, 15 * MINUTE_MS);
  /** Sign-in failures of phones that cannot sign in, locked like users (rule 11). */
  private readonly decoys = new DecoyLocks();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KEYED_HASH) private readonly hashes: KeyedHash,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(ProofOfWork) private readonly pow: ProofOfWork,
    @Inject(TokenSigner) private readonly tokens: TokenSigner,
  ) {}

  /** Rules 38, 39: phone and password, or the setup code of a new or reset user. */
  async signIn(input: ConsoleSignIn, address: string): Promise<ConsoleSignInResult> {
    this.perAddress.take(this.hashes.hash('address', address));
    await this.pow.verify(input.proofOfWork);
    const now = new Date();
    const secret = input.password ?? input.setupCode ?? '';
    const [user] = await this.db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.phone, input.phone));
    if (!user || user.status === 'disabled') {
      // The answer and the work of a wrong password; a disabled user's attempt is still audited
      // (rule 43), an unknown phone's never.
      try {
        await this.decoys.fail(this.hashes.hash('platform_phone', input.phone), secret, now);
      } finally {
        if (user) {
          await auditPlatform(
            this.db,
            { kind: 'platform', userId: user.id },
            {
              action: 'platform_user.sign_in_failed',
              entityType: 'platform_user',
              entityId: user.id,
            },
          );
        }
      }
      throw invalidCredentials();
    }
    await this.claim(user.id, now);
    let passed: boolean;
    if (input.setupCode !== undefined) {
      // The same Argon2id work as a password, so a setup code costs what a password costs.
      await verifyPassword(secret, await decoyPasswordHash());
      passed =
        user.status === 'pending_setup' &&
        user.setupCodeHash !== null &&
        (user.setupCodeExpiresAt?.getTime() ?? 0) > now.getTime() &&
        this.hashes.matches(CONSOLE_HASH.setupCode, input.setupCode, user.setupCodeHash);
    } else {
      passed =
        user.status === 'active' &&
        (await verifyPassword(secret, user.passwordHash ?? (await decoyPasswordHash())));
    }
    if (!passed) {
      await this.failed(user.id, now, 'platform_user.sign_in_failed');
      throw invalidCredentials();
    }
    // The password passed: only its own claim is taken back. TOTP and recovery-code guesses share
    // the count, so only a passed second factor (or setup) clears it, and a known password never
    // buys more guesses.
    await this.db
      .update(platformUsers)
      .set({ failedSignIns: sql`greatest(${platformUsers.failedSignIns} - 1, 0)`, updatedAt: now })
      .where(eq(platformUsers.id, user.id));
    if (input.setupCode !== undefined) {
      const totpSecret = newTotpSecret();
      const sealed = this.box.seal(`${totpContext(user.id)}:setup`, totpSecret);
      return {
        step: 'setup',
        ticket: this.stepTicket(user, 'setup', sealed),
        totpSecret,
        totpUri: totpUri(totpSecret, user.name),
      };
    }
    return { step: 'totp', ticket: this.stepTicket(user, 'totp', null) };
  }

  /** Rule 38: the first password and the TOTP enrollment, confirmed by a code of the new secret. */
  async setup(input: ConsoleSetup, address: string): Promise<{ me: ConsoleSetUp; token: string }> {
    this.perAddress.take(this.hashes.hash('address', address));
    const { claims, user } = await this.readStep(input.ticket, 'setup');
    assertPasswordStrong(input.password, user.phone);
    const now = new Date();
    const totpSecret = claims.sec
      ? this.box.open(`${totpContext(user.id)}:setup`, claims.sec)
      : undefined;
    if (!totpSecret) throw invalidTicket();
    await this.claim(user.id, now);
    const step = matchingStep(totpSecret, input.code, now, null);
    if (step === undefined) {
      await this.failed(user.id, now, 'platform_user.totp_failed');
      throw totpInvalid();
    }
    const passwordHash = await hashPassword(input.password);
    const recoveryCodes = Array.from({ length: consolePolicy.recoveryCodes }, () => typedCode(2));
    const outcome = await this.db.transaction(async (tx) => {
      if (!(await useToken(tx, 'console_step', claims.jti, this.stepExpiry())))
        throw invalidTicket();
      const current = await platformUserById(tx, user.id, { lock: 'update' });
      // Disabled meanwhile, or set up by a concurrent request: the ticket no longer applies.
      if (current?.status !== 'pending_setup' || this.stepRef(current, 'setup') !== claims.ref) {
        throw invalidTicket();
      }
      await tx
        .update(platformUsers)
        .set({
          status: 'active',
          passwordHash,
          totpSecret: this.box.seal(totpContext(user.id), totpSecret),
          totpLastStep: step,
          setupCodeHash: null,
          setupCodeExpiresAt: null,
          failedSignIns: 0,
          signInLockedUntil: null,
          updatedAt: now,
        })
        .where(eq(platformUsers.id, user.id));
      await archiveRecoveryCodes(tx, user.id, now);
      await tx.insert(platformUserRecoveryCodes).values(
        recoveryCodes.map((code) => ({
          platformUserId: user.id,
          codeHash: this.hashes.hash(CONSOLE_HASH.recoveryCode, code),
        })),
      );
      const ref = { kind: 'platform' as const, userId: user.id };
      await auditPlatform(tx, ref, {
        action: 'platform_user.setup_completed',
        entityType: 'platform_user',
        entityId: user.id,
      });
      return this.openSession(tx, user.id, now, now, 'setup');
    });
    if (outcome instanceof DomainError) throw outcome;
    const me = await this.me(outcome.actor);
    return { me: { ...me, recoveryCodes }, token: outcome.token };
  }

  /** Rule 39: the second step, a TOTP code (a used step refused) or a single-use recovery code. */
  async totp(input: ConsoleTotp, address: string): Promise<{ me: ConsoleMe; token: string }> {
    this.perAddress.take(this.hashes.hash('address', address));
    const { claims, user } = await this.readStep(input.ticket, 'totp');
    const now = new Date();
    await this.claim(user.id, now);
    const isTotp = /^\d{6}$/.test(input.code);
    const outcome = await this.db.transaction(async (tx) => {
      const current = await platformUserById(tx, user.id, { lock: 'update' });
      if (current?.status !== 'active' || this.stepRef(current, 'totp') !== claims.ref) {
        throw invalidTicket();
      }
      const passed = isTotp
        ? await this.useTotp(tx, current, input.code, now)
        : await this.useRecoveryCode(tx, user.id, input.code, now);
      if (!passed) return totpInvalid();
      if (!(await useToken(tx, 'console_step', claims.jti, this.stepExpiry())))
        throw invalidTicket();
      return this.openSession(
        tx,
        user.id,
        now,
        isTotp ? now : null,
        isTotp ? 'totp' : 'recovery_code',
      );
    });
    if (outcome instanceof DomainError) {
      if (outcome.code === 'TOTP_INVALID')
        await this.failed(user.id, now, 'platform_user.totp_failed');
      throw outcome;
    }
    await this.succeeded(user.id);
    return { me: await this.me(outcome.actor), token: outcome.token };
  }

  /** Rule 40: a TOTP code, for the sensitive actions of the next 5 minutes. */
  async reauthenticate(
    actor: PlatformActor,
    code: string,
  ): Promise<{ reauthenticatedUntil: string }> {
    this.reauthsPerSession.take(actor.sessionId);
    const now = new Date();
    await this.claim(actor.userId, now);
    const passed = await this.db.transaction(async (tx) => {
      const user = await platformUserById(tx, actor.userId, { lock: 'update' });
      if (!user || !(await this.useTotp(tx, user, code, now))) return false;
      await tx
        .update(platformSessions)
        .set({ reauthenticatedAt: now, updatedAt: now })
        .where(eq(platformSessions.id, actor.sessionId));
      await auditPlatform(tx, actor, {
        action: 'platform_user.reauthenticated',
        entityType: 'platform_session',
        entityId: actor.sessionId,
      });
      return true;
    });
    if (!passed) {
      if (await this.failed(actor.userId, now, 'platform_user.totp_failed')) {
        // Guessing in a stolen session costs the session.
        await this.db.transaction((tx) =>
          tx
            .update(platformSessions)
            .set({ endedAt: now, endReason: 'reauth_failed', updatedAt: now })
            .where(and(eq(platformSessions.id, actor.sessionId), isNull(platformSessions.endedAt))),
        );
      }
      throw totpInvalid();
    }
    await this.succeeded(actor.userId);
    const until = new Date(now.getTime() + consolePolicy.reauthMinutes * MINUTE_MS);
    return { reauthenticatedUntil: until.toISOString() };
  }

  async signOut(actor: PlatformActor): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(platformSessions)
        .set({ endedAt: now, endReason: 'signed_out', updatedAt: now })
        .where(and(eq(platformSessions.id, actor.sessionId), isNull(platformSessions.endedAt)));
      await auditPlatform(tx, actor, {
        action: 'platform_user.signed_out',
        entityType: 'platform_session',
        entityId: actor.sessionId,
      });
    });
  }

  async me(actor: PlatformActor): Promise<ConsoleMe> {
    const user = await platformUserById(this.db, actor.userId);
    const [session] = await this.db
      .select()
      .from(platformSessions)
      .where(eq(platformSessions.id, actor.sessionId));
    if (!user || !session) throw new DomainError('SESSION_ENDED', 'The session has ended');
    const [codes] = await this.db
      .select({ remaining: count() })
      .from(platformUserRecoveryCodes)
      .where(
        and(
          eq(platformUserRecoveryCodes.platformUserId, user.id),
          isNull(platformUserRecoveryCodes.archivedAt),
          isNull(platformUserRecoveryCodes.usedAt),
        ),
      );
    const reauthUntil =
      (session.reauthenticatedAt?.getTime() ?? 0) + consolePolicy.reauthMinutes * MINUTE_MS;
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role as ConsoleRole,
      permissions: permissionsOfUser(user),
      recoveryCodesRemaining: codes?.remaining ?? 0,
      session: {
        expiresAt: session.expiresAt.toISOString(),
        reauthenticatedUntil: reauthUntil > Date.now() ? new Date(reauthUntil).toISOString() : null,
      },
    };
  }

  /** The user's own password; their other sessions end (`password_changed`). */
  async changePassword(actor: PlatformActor, input: ChangePassword): Promise<void> {
    const now = new Date();
    await this.claim(actor.userId, now);
    const user = await platformUserById(this.db, actor.userId);
    if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      await this.failed(actor.userId, now, 'platform_user.sign_in_failed');
      throw invalidCredentials();
    }
    await this.succeeded(actor.userId);
    assertPasswordStrong(input.newPassword, user.phone);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(platformUsers)
        .set({ passwordHash, updatedAt: now })
        .where(eq(platformUsers.id, actor.userId));
      await endPlatformSessions(tx, actor.userId, 'password_changed', now, actor.sessionId);
      await auditPlatform(tx, actor, {
        action: 'platform_user.password_changed',
        entityType: 'platform_user',
        entityId: actor.userId,
      });
    });
  }

  /**
   * The console verifier (rules 40–43): the session behind the cookie, its limits, the user, the
   * origin, the permissions and the re-auth window, in that order. Every request with a known
   * session writes one `console.request` entry with the outcome, refused or not; an unknown token
   * writes none, only a log line with the route.
   */
  async verify(sessionToken: string, request: ConsoleRequest): Promise<PlatformActor> {
    const tokenHash = this.hashes.hash(CONSOLE_HASH.session, sessionToken);
    const now = new Date();
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ session: platformSessions, user: platformUsers })
        .from(platformSessions)
        .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.platformUserId))
        .where(eq(platformSessions.tokenHash, tokenHash))
        .for('update', { of: platformSessions });
      if (!row) return undefined;
      const { session, user } = row;
      const decision = await this.decide(tx, session, user, request, now);
      const subjectTenantId = await this.existingTenant(tx, request.subjectTenantId);
      await auditPlatform(
        tx,
        { kind: 'platform', userId: user.id },
        {
          action: 'console.request',
          entityType: 'platform_session',
          entityId: session.id,
          subjectTenantId,
          requestRoute: request.route,
          details: {
            outcome: decision instanceof Refusal ? decision.code : 'allowed',
            params: request.params,
          },
        },
      );
      return decision;
    });
    if (!outcome) {
      this.logger.warn(`Console request refused: ${request.route} unknown_session`);
      throw new DomainError('UNAUTHENTICATED', 'No session');
    }
    if (outcome instanceof Refusal) throw new DomainError(outcome.code, outcome.message);
    return outcome;
  }

  // Shared steps.

  private async decide(
    tx: Transaction,
    session: SessionRow,
    user: PlatformUserRow,
    request: ConsoleRequest,
    now: Date,
  ): Promise<PlatformActor | Refusal> {
    if (session.endedAt) return new Refusal('SESSION_ENDED', 'The session has ended');
    const end = async (reason: EndReason) => {
      await tx
        .update(platformSessions)
        .set({ endedAt: now, endReason: reason, updatedAt: now })
        .where(eq(platformSessions.id, session.id));
      return new Refusal('SESSION_ENDED', `Session ended: ${reason}`);
    };
    if (session.expiresAt <= now) return end('expired');
    if (
      now.getTime() - session.lastSeenAt.getTime() >
      consolePolicy.sessionIdleMinutes * MINUTE_MS
    ) {
      return end('idle');
    }
    if (user.status !== 'active') return end('user_disabled');
    if (request.foreignOrigin) return new Refusal('FORBIDDEN', 'A write from another origin');
    const permissions = permissionsOfUser(user);
    if (
      request.permissions.length > 0 &&
      !request.permissions.some((p) => permissions.includes(p))
    ) {
      return new Refusal('FORBIDDEN', 'The user lacks the permission');
    }
    const reauthAge = now.getTime() - (session.reauthenticatedAt?.getTime() ?? 0);
    if (request.reauth && reauthAge > consolePolicy.reauthMinutes * MINUTE_MS) {
      return new Refusal('REAUTH_REQUIRED', 'Enter a TOTP code again');
    }
    await tx
      .update(platformSessions)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(platformSessions.id, session.id));
    return {
      kind: 'platform',
      userId: user.id,
      sessionId: session.id,
      permissions,
      reauthenticatedAt: session.reauthenticatedAt,
    };
  }

  /** The subject tenant of a request, when the parameter names one that exists (its foreign key). */
  private async existingTenant(tx: Transaction, id: string | null): Promise<string | null> {
    if (!id || !idSchema.safeParse(id).success) return null;
    try {
      return (await readTenant(tx, id)).id;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private async openSession(
    tx: Transaction,
    userId: string,
    now: Date,
    reauthenticatedAt: Date | null,
    method: 'setup' | 'totp' | 'recovery_code',
  ): Promise<{ actor: PlatformActor; token: string }> {
    const token = randomToken();
    const [session] = await tx
      .insert(platformSessions)
      .values({
        platformUserId: userId,
        tokenHash: this.hashes.hash(CONSOLE_HASH.session, token),
        expiresAt: new Date(now.getTime() + consolePolicy.sessionMaxHours * HOUR_MS),
        lastSeenAt: now,
        reauthenticatedAt,
      })
      .returning();
    if (!session) throw new Error('A session neither inserted nor returned');
    const actor: PlatformActor = {
      kind: 'platform',
      userId,
      sessionId: session.id,
      permissions: [],
      reauthenticatedAt,
    };
    await auditPlatform(tx, actor, {
      action: 'platform_user.signed_in',
      entityType: 'platform_session',
      entityId: session.id,
      details: { method },
    });
    return { actor, token };
  }

  /** Accepts a TOTP code of a step later than the last used one, recording the step. */
  private async useTotp(tx: Transaction, user: PlatformUserRow, code: string, now: Date) {
    const secret = user.totpSecret
      ? this.box.open(totpContext(user.id), user.totpSecret)
      : undefined;
    if (!secret) return false;
    const step = matchingStep(secret, code, now, user.totpLastStep);
    if (step === undefined) return false;
    const updated = await tx
      .update(platformUsers)
      .set({ totpLastStep: step, updatedAt: now })
      .where(
        and(
          eq(platformUsers.id, user.id),
          or(isNull(platformUsers.totpLastStep), lt(platformUsers.totpLastStep, step)),
        ),
      )
      .returning({ id: platformUsers.id });
    return updated.length === 1;
  }

  private async useRecoveryCode(tx: Transaction, userId: string, code: string, now: Date) {
    const used = await tx
      .update(platformUserRecoveryCodes)
      .set({ usedAt: now, updatedAt: now })
      .where(
        and(
          eq(platformUserRecoveryCodes.platformUserId, userId),
          eq(platformUserRecoveryCodes.codeHash, this.hashes.hash(CONSOLE_HASH.recoveryCode, code)),
          isNull(platformUserRecoveryCodes.archivedAt),
          isNull(platformUserRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: platformUserRecoveryCodes.id });
    return used.length === 1;
  }

  /**
   * A step ticket names the user and what the step rests on (the setup code, or the password),
   * so a reset or a password change voids the tickets issued before it.
   */
  private stepTicket(user: PlatformUserRow, step: 'totp' | 'setup', sealed: string | null) {
    return this.tokens.sign(
      'console_step',
      { jti: randomToken(16), uid: user.id, step, sec: sealed, ref: this.stepRef(user, step) },
      ticketTtlSeconds,
    ).token;
  }

  private stepRef(user: PlatformUserRow, step: 'totp' | 'setup'): string {
    const basis = step === 'setup' ? user.setupCodeHash : user.passwordHash;
    return this.hashes.hash(CONSOLE_HASH.step, `${step}:${basis ?? ''}`);
  }

  private stepExpiry() {
    return new Date(Date.now() + ticketTtlSeconds * 1000);
  }

  private async readStep(ticket: string, step: 'totp' | 'setup') {
    const claims = this.tokens.verify(ticket, 'console_step');
    if (!claims || claims.step !== step) throw invalidTicket();
    if (await isTokenUsed(this.db, 'console_step', claims.jti)) throw invalidTicket();
    const user = await platformUserById(this.db, claims.uid);
    const expected = step === 'setup' ? 'pending_setup' : 'active';
    if (user?.status !== expected || this.stepRef(user, step) !== claims.ref) throw invalidTicket();
    return { claims, user };
  }

  // The sign-in lock (rule 11 for platform users): each attempt counted before its check, under
  // the user's row lock, so concurrent attempts never get more than five guesses.

  private async claim(userId: string, now: Date): Promise<void> {
    const lockedUntil = await this.db.transaction(async (tx) => {
      const row = await platformUserById(tx, userId, { lock: 'update' });
      if (!row) return undefined;
      if (row.signInLockedUntil && row.signInLockedUntil > now) return row.signInLockedUntil;
      if (row.failedSignIns >= signInPolicy.maxFailures) return this.lock(tx, userId, now);
      await tx
        .update(platformUsers)
        .set({ failedSignIns: row.failedSignIns + 1, signInLockedUntil: null, updatedAt: now })
        .where(eq(platformUsers.id, userId));
      return undefined;
    });
    if (lockedUntil) throw signInLocked(lockedUntil);
  }

  /** A failed step, audited; true when it locked the user. */
  private async failed(
    userId: string,
    now: Date,
    action: 'platform_user.sign_in_failed' | 'platform_user.totp_failed',
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await auditPlatform(
        tx,
        { kind: 'platform', userId },
        { action, entityType: 'platform_user', entityId: userId },
      );
      const row = await platformUserById(tx, userId, { lock: 'update' });
      if (row && row.failedSignIns >= signInPolicy.maxFailures && !row.signInLockedUntil) {
        await this.lock(tx, userId, now);
        return true;
      }
      return false;
    });
  }

  private async succeeded(userId: string): Promise<void> {
    await this.db
      .update(platformUsers)
      .set({ failedSignIns: 0, signInLockedUntil: null, updatedAt: new Date() })
      .where(eq(platformUsers.id, userId));
  }

  private async lock(tx: Transaction, userId: string, now: Date): Promise<Date> {
    const until = new Date(now.getTime() + signInPolicy.lockMinutes * MINUTE_MS);
    await tx
      .update(platformUsers)
      .set({ failedSignIns: 0, signInLockedUntil: until, updatedAt: now })
      .where(eq(platformUsers.id, userId));
    return until;
  }
}
