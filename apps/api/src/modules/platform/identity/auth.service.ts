import { Inject, Injectable } from '@nestjs/common';
import {
  assertPasswordStrong,
  DomainError,
  type Me,
  type OtpChallenge,
  type OtpDelivery,
  type OtpRequest,
  type OtpVerified,
  type OtpVerify,
  ownerReadAccessEndsAt,
  type SetPassword,
  type SignIn,
  type SignInResult,
  staffSessionPolicy,
  type TenantOptions,
} from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import {
  accounts,
  branches,
  type Database,
  devices,
  enterTenant,
  personalDevices,
  staffSessions,
  withTenant,
} from '@vertex-food/db';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Ticket } from '../../../core/access/actor.js';
import {
  PERSONAL_DEVICE_COOKIE,
  STAFF_SESSION_COOKIE,
} from '../../../core/access/session-verifier.js';
import { audit, auditPlatform } from '../../../core/audit/audit.js';
import type { CookieJar } from '../../../core/cookies/cookies.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import {
  inScope,
  linkedTenantIds,
  type Membership,
  permissionsOf,
  readMembership,
} from '../access/index.js';
import { accountById, accountByPhone, resetOpen } from './accounts.js';
import { DecoyLocks } from './decoy-locks.js';
import { KEYED_HASH } from './devices.service.js';
import { MeService } from './me.service.js';
import { tenantStatusAt } from './member-lists.js';
import { OtpChallenges } from './otp-challenges.js';
import { PersonalDeviceStore } from './personal-devices.js';
import { ProofOfWork } from './proof-of-work.js';
import { hashPassword } from './secrets.js';
import { SignInLock } from './sign-in-lock.js';
import { endSessions, SessionIssuer } from './staff-sessions.js';
import { Tickets } from './tickets.js';
import { TokenSigner } from './tokens.js';

const MINUTE_MS = 60_000;

/** The personal-device cookie lives under the sign-in routes, 90 days (rule 12). */
export const PERSONAL_DEVICE_COOKIE_PATH = '/api/auth/';
const PERSONAL_DEVICE_COOKIE_SECONDS = 90 * 86_400;

const invalidCredentials = () =>
  new DomainError('INVALID_CREDENTIALS', 'Unknown phone or wrong password');

/** Rule 13: who receives a first-sign-in OTP: members who sign in online. */
function signsInOnline(member: Membership): boolean {
  if (member.status !== 'active') return false;
  const permissions = permissionsOf(member);
  return (
    permissions.includes('backoffice.remote') ||
    permissions.includes('devices.manage') ||
    member.roles.includes('driver')
  );
}

/**
 * Accounts and signing in (spec S02 rules 10–14, 18, 34): proof of work, password sign-in with its
 * lock, OTPs, sign-in tickets, passwords, the tenants a ticket may continue to, and personal-device
 * sessions. Every answer to a phone that has no account, or no password, is the answer to a wrong
 * password, after the same work (no account enumeration). Copied from Vertex Shifa and adapted.
 */
@Injectable()
export class AuthService {
  /** Sign-in, OTP requests and resends: 30 per 10 minutes per address (rule 12). */
  private readonly perAddress = new RateLimiter(30, 10 * MINUTE_MS);
  private readonly challengesPerAddress = new RateLimiter(60, 10 * MINUTE_MS);
  private readonly verificationsPerAddress = new RateLimiter(60, 10 * MINUTE_MS);
  /** The sign-in screen polls a code's delivery every 2 s for up to 60 s (spec S03). */
  private readonly deliveryReadsPerAddress = new RateLimiter(120, 10 * MINUTE_MS);
  /** Sign-in failures of phones without an account, locked like accounts (rule 11). */
  private readonly decoys = new DecoyLocks();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KEYED_HASH) private readonly hashes: KeyedHash,
    @Inject(ProofOfWork) private readonly pow: ProofOfWork,
    @Inject(OtpChallenges) private readonly otps: OtpChallenges,
    @Inject(Tickets) private readonly tickets: Tickets,
    @Inject(TokenSigner) private readonly tokens: TokenSigner,
    @Inject(SessionIssuer) private readonly issuer: SessionIssuer,
    @Inject(PersonalDeviceStore) private readonly personalDevices: PersonalDeviceStore,
    @Inject(MeService) private readonly me: MeService,
    @Inject(SignInLock) private readonly signInLock: SignInLock,
  ) {}

  proofOfWork(address: string) {
    this.challengesPerAddress.take(this.hashes.hash('address', address));
    return this.pow.issue();
  }

  /**
   * Rules 11, 12: phone and password. On a registered PC of the person's tenant (its device token)
   * or a known personal device (its cookie) the answer is a ticket; elsewhere an OTP follows.
   */
  async signIn(
    input: SignIn,
    address: string,
    known: { deviceToken?: string | undefined; personalDeviceToken?: string | undefined },
    cookies: CookieJar,
  ): Promise<SignInResult> {
    this.perAddress.take(this.hashes.hash('address', address));
    await this.pow.verify(input.proofOfWork);
    const now = new Date();
    const account = await accountByPhone(this.db, input.phone);
    if (!account) {
      await this.decoys.fail(this.hashes.hash('phone', input.phone), input.password, now);
      throw invalidCredentials();
    }
    // One lock per account on every path (sign-in, re-entry, password change), with or without a
    // password, so no sequence of attempts tells the two apart (rules 1, 11).
    if (!(await this.signInLock.check(account, input.password, now))) throw invalidCredentials();
    if (input.intent === 'register_device') {
      const device = known.deviceToken
        ? this.tokens.verify(known.deviceToken, 'device')
        : undefined;
      if (device && (await this.isMemberOnDevice(device.tid, device.did, account.id))) {
        return {
          step: 'done',
          ticket: this.tickets.issue('signed_in', input.intent, account, {
            device: { tenantId: device.tid, deviceId: device.did },
          }),
        };
      }
    } else {
      const personalDeviceId = await this.personalDevices.recognize(
        this.db,
        account.id,
        known.personalDeviceToken,
        now,
      );
      if (personalDeviceId && known.personalDeviceToken) {
        // Its 90 days start again in the database (`recognize`), so in the browser too.
        cookies.set(
          PERSONAL_DEVICE_COOKIE,
          known.personalDeviceToken,
          PERSONAL_DEVICE_COOKIE_PATH,
          PERSONAL_DEVICE_COOKIE_SECONDS,
        );
        return {
          step: 'done',
          ticket: this.tickets.issue('signed_in', input.intent, account, { personalDeviceId }),
        };
      }
    }
    return {
      step: 'otp',
      challengeId: await this.otps.start(account, 'new_device', 'OTP_COOLDOWN'),
    };
  }

  /**
   * Rules 13, 14: a code for a first sign-in (no password yet, a member who signs in online) or an
   * authorized password reset. Any other phone gets a decoy challenge and the same answer.
   */
  async requestOtp(input: OtpRequest, address: string): Promise<OtpChallenge> {
    this.perAddress.take(this.hashes.hash('address', address));
    await this.pow.verify(input.proofOfWork);
    const now = new Date();
    const account = await accountByPhone(this.db, input.phone);
    const eligible =
      account !== undefined &&
      (input.purpose === 'first_sign_in'
        ? account.passwordHash === null && (await this.firstSignInName(account.id)) !== undefined
        : account.passwordHash !== null && resetOpen(account, now));
    const challengeId =
      eligible && account
        ? await this.otps.start(account, input.purpose, 'OTP_COOLDOWN', { quietFailure: true })
        : this.otps.startDecoy(
            this.hashes.hash('phone', input.phone),
            input.purpose,
            'OTP_COOLDOWN',
          );
    return { challengeId };
  }

  async resendOtp(challengeId: string, address: string): Promise<OtpChallenge> {
    this.perAddress.take(this.hashes.hash('address', address));
    return { challengeId: await this.otps.resend(challengeId) };
  }

  /** Spec S03 rule 21: a new-device code's delivery; `unknown` for any other challenge id. */
  async otpDelivery(challengeId: string, address: string): Promise<OtpDelivery> {
    this.deliveryReadsPerAddress.take(this.hashes.hash('address', address));
    return { status: await this.otps.deliveryStatus(challengeId) };
  }

  /**
   * A verified code gives a ticket for the next step: set a password, or act signed in. On a
   * personal device it also makes the device known (rule 12), in a cookie.
   */
  async verifyOtp(
    input: OtpVerify,
    address: string,
    userAgent: string | undefined,
    cookies: CookieJar,
  ): Promise<OtpVerified> {
    this.verificationsPerAddress.take(this.hashes.hash('address', address));
    const { accountId, purpose } = await this.otps.verify(input.challengeId, input.code);
    const now = new Date();
    const account = await accountById(this.db, accountId);
    if (!account) throw new DomainError('OTP_INVALID', 'The account is gone');
    let suggestedName = account.nameAr;
    if (purpose === 'first_sign_in') {
      const name = await this.firstSignInName(account.id);
      if (account.passwordHash !== null || name === undefined) {
        throw new DomainError('OTP_EXPIRED', 'A first sign-in is no longer possible');
      }
      suggestedName ??= name;
    }
    if (purpose === 'password_reset' && !resetOpen(account, now)) {
      throw new DomainError('OTP_EXPIRED', 'The password reset is no longer authorized');
    }
    const personalDeviceId = await this.db.transaction(async (tx) => {
      // The code reached the phone: it is verified (rule 13).
      await tx
        .update(accounts)
        .set({ phoneVerifiedAt: sql`coalesce(${accounts.phoneVerifiedAt}, now())`, updatedAt: now })
        .where(eq(accounts.id, account.id));
      if (input.intent !== 'personal') return null;
      const device = await this.personalDevices.create(tx, account.id, userAgent, now);
      await auditPlatform(
        tx,
        { kind: 'system', name: 'identity/sign-in' },
        {
          action: 'personal_device.added',
          entityType: 'personal_device',
          entityId: device.id,
          details: { accountId: account.id },
        },
      );
      cookies.set(
        PERSONAL_DEVICE_COOKIE,
        device.token,
        PERSONAL_DEVICE_COOKIE_PATH,
        PERSONAL_DEVICE_COOKIE_SECONDS,
      );
      return device.id;
    });
    const needsPassword = purpose !== 'new_device';
    return {
      ticket: this.tickets.issue(
        needsPassword ? 'set_password' : 'signed_in',
        input.intent,
        account,
        { personalDeviceId },
      ),
      needsPassword,
      needsName: account.nameAr === null,
      suggestedName,
    };
  }

  /**
   * The first password (rule 13) or a new one after an authorized reset (rule 14: the account's
   * staff sessions end in every tenant and its other personal devices are revoked; PINs stay).
   */
  async setPassword(ticket: Ticket, input: SetPassword): Promise<{ ticket: string }> {
    const now = new Date();
    const account = await accountById(this.db, ticket.accountId);
    if (!account) throw new DomainError('TICKET_INVALID', 'The account is gone');
    assertPasswordStrong(input.password, account.phone);
    const reset = account.passwordHash !== null;
    const allowed = reset
      ? resetOpen(account, now)
      : (await this.firstSignInName(account.id)) !== undefined;
    if (!allowed) throw new DomainError('TICKET_INVALID', 'No password may be set now');
    const nameAr = input.name ?? account.nameAr;
    if (!nameAr) throw new DomainError('VALIDATION_FAILED', 'Invalid fields: name');
    const passwordHash = await hashPassword(input.password);
    await this.db.transaction(async (tx) => {
      // Locked and rechecked: another ticket used meanwhile already set the password.
      const locked = await accountById(tx, account.id, { lock: 'update' });
      const stillAllowed = reset
        ? locked?.passwordHash !== null && locked !== undefined && resetOpen(locked, now)
        : locked?.passwordHash === null;
      if (!stillAllowed) throw new DomainError('TICKET_INVALID', 'No password may be set now');
      await this.tickets.consume(tx, ticket);
      await tx
        .update(accounts)
        .set({
          nameAr,
          passwordHash,
          passwordChangedAt: now,
          passwordResetAuthorizedUntil: null,
          failedSignIns: 0,
          signInLockedUntil: null,
          updatedAt: now,
        })
        .where(eq(accounts.id, account.id));
      await auditPlatform(
        tx,
        { kind: 'system', name: 'identity/sign-in' },
        {
          action: 'account.password_set',
          entityType: 'account',
          entityId: account.id,
          details: { reset },
        },
      );
      if (!reset) return;
      await tx
        .update(personalDevices)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(personalDevices.accountId, account.id),
            isNull(personalDevices.revokedAt),
            ticket.personalDeviceId ? ne(personalDevices.id, ticket.personalDeviceId) : undefined,
          ),
        );
      for (const tenantId of await linkedTenantIds(tx, account.id)) {
        await enterTenant(tx, tenantId);
        const member = await readMembership(tx, { accountId: account.id });
        if (member) {
          await endSessions(tx, eq(staffSessions.membershipId, member.id), 'password_reset', now);
        }
      }
    });
    return {
      ticket: this.tickets.issue(
        'signed_in',
        ticket.intent,
        { id: account.id, passwordHash },
        {
          personalDeviceId: ticket.personalDeviceId,
        },
      ),
    };
  }

  /**
   * Rules 18, 34: for `register_device`, the tenants not closed where the member has
   * `devices.manage` in an active branch, with those branches; for `personal`, the tenants where
   * they hold `backoffice.remote` (a closed one for its owners, 90 days).
   */
  async tenantOptions(ticket: Ticket): Promise<TenantOptions> {
    const now = new Date();
    const tenants: TenantOptions['tenants'] = [];
    for (const tenantId of await linkedTenantIds(this.db, ticket.accountId)) {
      const option = await withTenant(this.db, tenantId, async (tx) => {
        const tenant = await tenantStatusAt(tx, tenantId, now);
        const member = await readMembership(tx, { accountId: ticket.accountId });
        if (member?.status !== 'active') return undefined;
        const permissions = permissionsOf(member);
        const active = await tx
          .select({ id: branches.id, nameAr: branches.nameAr })
          .from(branches)
          .where(isNull(branches.archivedAt));
        const inMemberScope = active.filter((branch) => inScope(member, branch.id));
        if (ticket.intent === 'register_device') {
          if (tenant.status === 'closed' || !permissions.includes('devices.manage'))
            return undefined;
          if (inMemberScope.length === 0) return undefined;
        } else if (!this.mayUsePersonalSession(member, tenant)) {
          return undefined;
        }
        return {
          tenantId,
          nameAr: tenant.row.nameAr,
          status: tenant.status,
          logoFileId: tenant.row.logoFileId,
          branches: inMemberScope,
        };
      });
      if (option) tenants.push(option);
    }
    return { intent: ticket.intent, tenants };
  }

  /** Rule 34: a back-office session on a personal device, in a cookie. */
  async openPersonalSession(ticket: Ticket, tenantId: string, cookies: CookieJar): Promise<Me> {
    if (ticket.intent !== 'personal' || !ticket.personalDeviceId) {
      throw new DomainError('TICKET_INVALID', 'Not a personal-device ticket');
    }
    const personalDeviceId = ticket.personalDeviceId;
    const now = new Date();
    const session = await withTenant(this.db, tenantId, async (tx) => {
      const tenant = await tenantStatusAt(tx, tenantId, now);
      const member = await readMembership(tx, { accountId: ticket.accountId }, { lock: 'share' });
      // One answer whatever the cause: not a member, no `backoffice.remote`, a closed tenant.
      if (member?.status !== 'active' || !this.mayUsePersonalSession(member, tenant)) {
        throw new DomainError(
          tenant.status === 'closed' && member?.roles.includes('owner')
            ? 'TENANT_CLOSED'
            : 'FORBIDDEN',
          'No back-office access from a personal device',
        );
      }
      await this.tickets.consume(tx, ticket);
      const opened = await this.issuer.openPersonal(
        tx,
        { tenantId, membershipId: member.id, personalDeviceId },
        now,
      );
      await audit(
        tx,
        tenantId,
        { kind: 'system', name: 'identity/sign-in' },
        {
          action: 'staff_session.started',
          entityType: 'staff_session',
          entityId: opened.sessionId,
          details: { kind: 'personal', membershipId: member.id },
        },
      );
      return opened;
    });
    cookies.set(STAFF_SESSION_COOKIE, session.token, '/api/', staffSessionPolicy.maxHours * 3600);
    return this.me.describe({
      tenantId,
      accountId: ticket.accountId,
      sessionKind: 'personal',
      deviceId: null,
      branchId: null,
    });
  }

  // Shared steps.

  private mayUsePersonalSession(
    member: Membership,
    tenant: Awaited<ReturnType<typeof tenantStatusAt>>,
  ): boolean {
    if (!permissionsOf(member).includes('backoffice.remote')) return false;
    if (tenant.status !== 'closed') return true;
    const closedAt = tenant.row.closedAt ?? new Date();
    return member.roles.includes('owner') && ownerReadAccessEndsAt(closedAt) > new Date();
  }

  /**
   * The display name of the account in a tenant where it would receive a first-sign-in OTP
   * (rule 13), or undefined when there is none.
   */
  private async firstSignInName(accountId: string): Promise<string | undefined> {
    for (const tenantId of await linkedTenantIds(this.db, accountId)) {
      const name = await withTenant(this.db, tenantId, async (tx) => {
        const member = await readMembership(tx, { accountId });
        return member && signsInOnline(member) ? member.displayName : undefined;
      });
      if (name) return name;
    }
    return undefined;
  }

  /** Whether the account is an active member of the PC's tenant and branch, the PC active. */
  private isMemberOnDevice(tenantId: string, deviceId: string, accountId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
      if (device?.status !== 'active') return false;
      const member = await readMembership(tx, { accountId });
      return member?.status === 'active' && inScope(member, device.branchId);
    });
  }
}
