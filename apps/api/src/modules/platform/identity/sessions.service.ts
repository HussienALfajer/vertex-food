import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type ErrorCode,
  type OpenSession,
  ownerReadAccessEndsAt,
  type SessionTokens,
  type StaffSessionEndReason,
  staffSessionPolicy,
  type TenantStatus,
} from '@vertex-food/contracts';
import {
  type Database,
  devices,
  personalDevices,
  staffSessions,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, eq } from 'drizzle-orm';
import type { DeviceActor, StaffActor, Ticket } from '../../../core/access/actor.js';
import type { SessionVerifier } from '../../../core/access/session-verifier.js';
import { audit } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import { inScope, type Membership, permissionsOf, readMembership } from '../access/index.js';
import { accountById } from './accounts.js';
import { closeTenantAccess } from './device-access.js';
import { tenantStatusAt } from './member-lists.js';
import { checkOnlinePin, currentPin } from './pins.js';
import { SignInLock } from './sign-in-lock.js';
import { endSessions, SessionIssuer } from './staff-sessions.js';
import { Tickets } from './tickets.js';
import { TokenSigner } from './tokens.js';

const MINUTE_MS = 60_000;

/** A refusal decided inside a transaction whose writes (ending a session) must still commit. */
class Refusal {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
  ) {}
}

function throwIfRefused<T>(outcome: T | Refusal): T {
  if (outcome instanceof Refusal) throw new DomainError(outcome.code, outcome.message);
  return outcome;
}

/** Why a member may not open or keep a session on a PC of `branchId` (rules 6, 24, 33). */
function memberRefusal(member: Membership | undefined, branchId: string): ErrorCode | undefined {
  if (member?.status !== 'active') return 'MEMBERSHIP_INACTIVE';
  if (!inScope(member, branchId)) return 'BRANCH_NOT_IN_SCOPE';
  return undefined;
}

const endReasonOf: Partial<Record<ErrorCode, StaffSessionEndReason>> = {
  MEMBERSHIP_INACTIVE: 'member_deactivated',
  BRANCH_NOT_IN_SCOPE: 'branch_left',
  DEVICE_REVOKED: 'device_revoked',
};

function actorOf(
  member: Membership,
  tenantStatus: TenantStatus,
  session: typeof staffSessions.$inferSelect,
  branchId: string | null,
): StaffActor {
  return {
    kind: 'staff',
    tenantId: member.tenantId,
    tenantStatus,
    accountId: member.accountId,
    membershipId: member.id,
    sessionId: session.id,
    sessionKind: session.kind as StaffActor['sessionKind'],
    deviceId: session.deviceId,
    branchId,
    roles: member.roles,
    permissions: permissionsOf(member),
    allBranches: member.allBranches,
    branchIds: member.branchIds,
    passwordVerifiedAt: session.passwordVerifiedAt,
  };
}

/**
 * Staff sessions (spec S02 rules 22–27, 34, 35): opening one on a registered PC with a PIN (or, for
 * an owner or manager who forgot theirs, with a password ticket from this PC), refreshing it,
 * ending it, re-entering the password; and the session verifier of the authentication step, which
 * rechecks the session, PC, membership, branch scope and tenant status on every request.
 */
@Injectable()
export class SessionsService implements SessionVerifier {
  private readonly opensPerDevice = new RateLimiter(60, 10 * MINUTE_MS);
  private readonly reauthsPerSession = new RateLimiter(5, 15 * MINUTE_MS);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TokenSigner) private readonly tokens: TokenSigner,
    @Inject(Tickets) private readonly tickets: Tickets,
    @Inject(SessionIssuer) private readonly issuer: SessionIssuer,
    @Inject(SignInLock) private readonly signInLock: SignInLock,
  ) {}

  /** Rule 24: a member's PIN on this PC, checked online; ten wrong ones disable it everywhere. */
  async open(device: DeviceActor, input: OpenSession): Promise<SessionTokens> {
    this.opensPerDevice.take(device.deviceId);
    const ticket = 'ticket' in input ? await this.tickets.verify(input.ticket, 'signed_in') : null;
    const now = new Date();
    const outcome = await withTenant(this.db, device.tenantId, async (tx) => {
      const member = await this.lockMemberOnDevice(tx, device, input.membershipId);
      if (member instanceof Refusal) return member;
      if (ticket) {
        // Rule 22: an owner or manager replacing a forgotten PIN, with the password just entered
        // on this PC.
        if (
          ticket.intent !== 'register_device' ||
          ticket.deviceId !== device.deviceId ||
          ticket.accountId !== member.accountId
        ) {
          return new Refusal('TICKET_INVALID', 'The ticket is not for this member on this PC');
        }
        if (!member.roles.some((role) => role === 'owner' || role === 'manager')) {
          return new Refusal('FORBIDDEN', 'Only owners and managers open a session by password');
        }
        await this.tickets.consume(tx, ticket);
        return this.start(tx, device, member, now, now);
      }
      const pin = await currentPin(tx, member.id, { lock: 'update' });
      const refusal = await checkOnlinePin(tx, pin, (input as { pin: string }).pin, device, now);
      if (refusal) return new Refusal(refusal, 'PIN refused');
      return this.start(tx, device, member, now, null);
    });
    return throwIfRefused(outcome);
  }

  /**
   * New tokens for an open session of this PC, rechecked like an opening. Reusing a refresh token
   * that was already replaced ends the session (rule 44).
   */
  async refresh(device: DeviceActor, refreshToken: string): Promise<SessionTokens> {
    const parsed = this.issuer.parse('device', refreshToken);
    if (parsed?.tenantId !== device.tenantId) {
      throw new DomainError('SESSION_ENDED', 'The session has ended');
    }
    const now = new Date();
    const outcome = await withTenant(this.db, device.tenantId, async (tx) => {
      const [session] = await tx
        .select()
        .from(staffSessions)
        .where(
          and(eq(staffSessions.id, parsed.sessionId), eq(staffSessions.deviceId, device.deviceId)),
        )
        .for('update');
      if (!session || session.endedAt) return new Refusal('SESSION_ENDED', 'Ended');
      const end = async (reason: StaffSessionEndReason, code: ErrorCode) => {
        await endSessions(tx, eq(staffSessions.id, session.id), reason, now);
        return new Refusal(code, `Session ended: ${reason}`);
      };
      if (!this.issuer.matchesStored('device', refreshToken, session.refreshTokenHash)) {
        return end('refresh_reused', 'SESSION_ENDED');
      }
      if (session.expiresAt <= now) return end('expired', 'SESSION_ENDED');
      const member = await readMembership(tx, { id: session.membershipId });
      const refusal = memberRefusal(member, device.branchId);
      if (refusal) return end(endReasonOf[refusal] ?? 'expired', refusal);
      return this.issuer.refreshDevice(
        tx,
        {
          tenantId: device.tenantId,
          membershipId: session.membershipId,
          deviceId: device.deviceId,
          sessionId: session.id,
          expiresAt: session.expiresAt,
        },
        now,
      );
    });
    return throwIfRefused(outcome);
  }

  /** Signing out, locking or the idle lock (rule 32) ends the session; twice changes nothing. */
  async end(actor: StaffActor, reason: 'signed_out' | 'locked' | 'idle'): Promise<void> {
    await withTenant(this.db, actor.tenantId, (tx) =>
      endSessions(tx, eq(staffSessions.id, actor.sessionId), reason, new Date()),
    );
  }

  /**
   * Rule 26: the password again, for the sensitive actions of the next 5 minutes. A wrong one
   * counts toward the account's sign-in lock (rule 11), as at sign-in, so new PIN sessions never
   * give more guesses.
   */
  async reauthenticate(actor: StaffActor, password: string): Promise<void> {
    this.reauthsPerSession.take(actor.sessionId);
    const now = new Date();
    const account = await accountById(this.db, actor.accountId);
    if (!account || !(await this.signInLock.check(account, password, now))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Wrong password');
    }
    await withTenant(this.db, actor.tenantId, async (tx) => {
      await tx
        .update(staffSessions)
        .set({ passwordVerifiedAt: now, updatedAt: now })
        .where(eq(staffSessions.id, actor.sessionId));
      await audit(tx, actor.tenantId, actor, {
        action: 'staff_session.reauthenticated',
        entityType: 'staff_session',
        entityId: actor.sessionId,
      });
    });
  }

  // The session verifier of the authentication step.

  async staff(accessToken: string): Promise<StaffActor> {
    const claims = this.tokens.verify(accessToken, 'access');
    if (!claims) throw new DomainError('UNAUTHENTICATED', 'Invalid or expired access token');
    const now = new Date();
    const outcome = await withTenant(this.db, claims.tid, async (tx) => {
      const [row] = await tx
        .select({ session: staffSessions, device: devices })
        .from(staffSessions)
        .innerJoin(devices, eq(devices.id, staffSessions.deviceId))
        .where(eq(staffSessions.id, claims.sid));
      const session = row?.session;
      if (
        !row ||
        !session ||
        session.endedAt ||
        session.expiresAt <= now ||
        session.membershipId !== claims.mid ||
        session.deviceId !== claims.did
      ) {
        return new Refusal('SESSION_ENDED', 'The session has ended');
      }
      const tenant = await tenantStatusAt(tx, claims.tid, now);
      if (tenant.status === 'closed') {
        await closeTenantAccess(tx, claims.tid, now);
        return new Refusal('DEVICE_REVOKED', 'The restaurant was closed');
      }
      if (row.device.status !== 'active') return new Refusal('DEVICE_REVOKED', 'Revoked PC');
      const member = await readMembership(tx, { id: claims.mid });
      const refusal = memberRefusal(member, row.device.branchId);
      if (refusal || !member) {
        const code = refusal ?? 'MEMBERSHIP_INACTIVE';
        await endSessions(
          tx,
          eq(staffSessions.id, session.id),
          endReasonOf[code] ?? 'expired',
          now,
        );
        return new Refusal(code, 'The member may not use this PC');
      }
      return actorOf(member, tenant.status, session, row.device.branchId);
    });
    return throwIfRefused(outcome);
  }

  async personal(sessionToken: string): Promise<StaffActor> {
    const parsed = this.issuer.parse('personal', sessionToken);
    if (!parsed) throw new DomainError('UNAUTHENTICATED', 'Invalid session cookie');
    const now = new Date();
    const outcome = await withTenant(this.db, parsed.tenantId, async (tx) => {
      const [session] = await tx
        .select()
        .from(staffSessions)
        .where(and(eq(staffSessions.id, parsed.sessionId), eq(staffSessions.kind, 'personal')));
      if (
        !session ||
        session.endedAt ||
        !this.issuer.matchesStored('personal', sessionToken, session.refreshTokenHash)
      ) {
        return new Refusal('SESSION_ENDED', 'The session has ended');
      }
      const end = async (reason: StaffSessionEndReason, code: ErrorCode) => {
        await endSessions(tx, eq(staffSessions.id, session.id), reason, now);
        return new Refusal(code, `Session ended: ${reason}`);
      };
      if (session.expiresAt <= now) return end('expired', 'SESSION_ENDED');
      const idleSince = now.getTime() - session.lastRefreshedAt.getTime();
      if (idleSince > staffSessionPolicy.personalIdleMinutes * MINUTE_MS) {
        return end('idle', 'SESSION_ENDED');
      }
      const [personalDevice] = await tx
        .select({ revokedAt: personalDevices.revokedAt })
        .from(personalDevices)
        .where(eq(personalDevices.id, session.personalDeviceId ?? ''));
      if (!personalDevice || personalDevice.revokedAt) return end('signed_out', 'SESSION_ENDED');
      const member = await readMembership(tx, { id: session.membershipId });
      if (member?.status !== 'active') return end('member_deactivated', 'MEMBERSHIP_INACTIVE');
      // Edge case 4: a member who lost `backoffice.remote` loses their personal sessions at once.
      if (!permissionsOf(member).includes('backoffice.remote')) {
        return end('access_lost', 'FORBIDDEN');
      }
      const tenant = await tenantStatusAt(tx, parsed.tenantId, now);
      if (tenant.status === 'closed') {
        // Rule 37: only owners, read only, for 90 days after the closure.
        const closedAt = tenant.row.closedAt ?? now;
        if (!member.roles.includes('owner') || ownerReadAccessEndsAt(closedAt) <= now) {
          return end('tenant_closed', 'TENANT_CLOSED');
        }
      }
      await tx
        .update(staffSessions)
        .set({ lastRefreshedAt: now, updatedAt: now })
        .where(eq(staffSessions.id, session.id));
      return actorOf(member, tenant.status, session, null);
    });
    return throwIfRefused(outcome);
  }

  async device(deviceToken: string, options: { allowRevoked: boolean }): Promise<DeviceActor> {
    const claims = this.tokens.verify(deviceToken, 'device');
    if (!claims) throw new DomainError('UNAUTHENTICATED', 'Invalid or expired device token');
    const now = new Date();
    const outcome = await withTenant(this.db, claims.tid, async (tx) => {
      const [row] = await tx.select().from(devices).where(eq(devices.id, claims.did));
      if (!row) return new Refusal('DEVICE_UNKNOWN', 'Unknown device');
      let status = row.status;
      if (status === 'active' && (await tenantStatusAt(tx, claims.tid, now)).status === 'closed') {
        await closeTenantAccess(tx, claims.tid, now);
        status = 'revoked';
      }
      if (status !== 'active' && !options.allowRevoked) {
        return new Refusal('DEVICE_REVOKED', 'The PC was removed');
      }
      return {
        kind: 'device' as const,
        tenantId: claims.tid,
        deviceId: claims.did,
        branchId: row.branchId,
        status: status as DeviceActor['status'],
      };
    });
    return throwIfRefused(outcome);
  }

  ticket(ticket: string, purpose: Ticket['purpose']): Promise<Ticket> {
    return this.tickets.verify(ticket, purpose);
  }

  // Shared steps.

  /**
   * The member, locked, if they may open a session on this PC now: the PC active, the member
   * active and in the PC's branch (rules 6, 24, 36). Locked in the writers' order (the member,
   * then the PIN), so a deactivation or a scope change meanwhile is seen here or waits.
   */
  private async lockMemberOnDevice(
    tx: Transaction,
    device: DeviceActor,
    membershipId: string,
  ): Promise<Membership | Refusal> {
    const [current] = await tx
      .select({ status: devices.status })
      .from(devices)
      .where(eq(devices.id, device.deviceId))
      .for('share');
    if (current?.status !== 'active') return new Refusal('DEVICE_REVOKED', 'The PC was removed');
    const member = await readMembership(tx, { id: membershipId }, { lock: 'share' });
    const refusal = memberRefusal(member, device.branchId);
    if (refusal || !member) {
      return new Refusal(refusal ?? 'MEMBERSHIP_INACTIVE', 'The member may not use this PC');
    }
    return member;
  }

  private async start(
    tx: Transaction,
    device: DeviceActor,
    member: Membership,
    now: Date,
    passwordVerifiedAt: Date | null,
  ): Promise<SessionTokens> {
    const session = await this.issuer.openDevice(
      tx,
      { tenantId: device.tenantId, membershipId: member.id, deviceId: device.deviceId },
      now,
      passwordVerifiedAt,
    );
    await audit(tx, device.tenantId, device, {
      action: 'staff_session.started',
      entityType: 'staff_session',
      entityId: session.sessionId,
      details: { kind: 'device', membershipId: member.id },
    });
    return session;
  }
}
