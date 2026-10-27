import { Inject, Injectable } from '@nestjs/common';
import {
  assertPasswordStrong,
  assertPinStrong,
  type ChangePassword,
  type ChangePin,
  DomainError,
  type Me,
  mayManageMember,
  type PersonalDevice,
  reauthMinutes,
  type StaffSessionKind,
} from '@vertex-food/contracts';
import {
  accounts,
  type Database,
  personalDevices,
  staffSessions,
  withTenant,
} from '@vertex-food/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { StaffActor } from '../../../core/access/actor.js';
import { audit, auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { emit } from '../../../core/events/outbox.js';
import { permissionsOf, reach, readMembership } from '../access/index.js';
import { accountById } from './accounts.js';
import { tenantStatusAt } from './member-lists.js';
import { PersonalDeviceStore } from './personal-devices.js';
import { currentPin, replacePin } from './pins.js';
import { hashPassword, hashPin, verifyPassword } from './secrets.js';
import { SignInLock } from './sign-in-lock.js';

const MINUTE_MS = 60_000;

const invalidCredentials = () => new DomainError('INVALID_CREDENTIALS', 'Wrong password');

/**
 * The signed-in member's own account (spec S02 rules 10, 22, 35): who they are, their password,
 * their PIN on this PC, their personal devices; and the PIN a manager sets for a member they may
 * manage (rule 22).
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PersonalDeviceStore) private readonly personalDevices: PersonalDeviceStore,
    @Inject(SignInLock) private readonly signInLock: SignInLock,
  ) {}

  me(actor: StaffActor): Promise<Me> {
    return this.describe(actor);
  }

  /** The member of a session, as `GET /api/me` answers. */
  async describe(session: {
    tenantId: string;
    accountId: string;
    sessionKind: StaffSessionKind;
    deviceId: string | null;
    branchId: string | null;
  }): Promise<Me> {
    const account = await accountById(this.db, session.accountId);
    if (!account) throw new DomainError('UNAUTHENTICATED', 'The account is gone');
    return withTenant(this.db, session.tenantId, async (tx) => {
      const tenant = await tenantStatusAt(tx, session.tenantId, new Date());
      const member = await readMembership(tx, { accountId: session.accountId });
      if (!member) throw new DomainError('UNAUTHENTICATED', 'No membership');
      const pin = await currentPin(tx, member.id);
      return {
        account: {
          id: account.id,
          phone: account.phone,
          nameAr: account.nameAr,
          hasPassword: account.passwordHash !== null,
        },
        tenant: { id: tenant.row.id, nameAr: tenant.row.nameAr, status: tenant.status },
        membershipId: member.id,
        displayName: member.displayName,
        roles: member.roles,
        allBranches: member.allBranches,
        branchIds: member.branchIds,
        permissions: permissionsOf(member),
        sessionKind: session.sessionKind,
        deviceId: session.deviceId,
        branchId: session.branchId,
        pinSet: pin !== undefined,
      };
    });
  }

  /** The member's own password; a wrong current password counts toward the lock (rule 11). */
  async changePassword(actor: StaffActor, input: ChangePassword): Promise<void> {
    const now = new Date();
    const account = await accountById(this.db, actor.accountId);
    if (!account?.passwordHash) throw invalidCredentials();
    await this.signInLock.claim(account.id, now);
    if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
      await this.signInLock.failed(account.id, now);
      throw invalidCredentials();
    }
    await this.signInLock.succeeded(account.id);
    assertPasswordStrong(input.newPassword, account.phone);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      const locked = await accountById(tx, account.id, { lock: 'update' });
      // Changed meanwhile (another change, a reset): the new password replaces nothing.
      if (locked?.passwordHash !== account.passwordHash) throw invalidCredentials();
      await tx
        .update(accounts)
        .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
        .where(eq(accounts.id, account.id));
      await auditPlatform(tx, actor, {
        action: 'account.password_set',
        entityType: 'account',
        entityId: account.id,
      });
    });
  }

  /**
   * Rule 22: the member's own PIN on a registered PC: the current PIN, or none when they have no
   * PIN yet or, for an owner or manager who forgot theirs, the password entered in the last
   * 5 minutes.
   */
  async changePin(actor: StaffActor, input: ChangePin): Promise<void> {
    const deviceId = this.registeredPc(actor);
    const account = await accountById(this.db, actor.accountId);
    if (!account) throw new DomainError('UNAUTHENTICATED', 'The account is gone');
    assertPinStrong(input.newPin, account.phone);
    const pin = await withTenant(this.db, actor.tenantId, (tx) =>
      currentPin(tx, actor.membershipId),
    );
    if (pin) {
      if (input.currentPin !== undefined) {
        if (pin.disabledAt) throw new DomainError('PIN_DISABLED', 'The PIN is disabled');
        if (!(await verifyPassword(input.currentPin, pin.verifier))) {
          throw new DomainError('INVALID_PIN', 'Wrong current PIN');
        }
      } else {
        const ownerOrManager = actor.roles.some((role) => role === 'owner' || role === 'manager');
        const enteredAt = actor.passwordVerifiedAt?.getTime() ?? 0;
        if (!ownerOrManager) throw new DomainError('INVALID_PIN', 'The current PIN is needed');
        if (Date.now() - enteredAt > reauthMinutes * MINUTE_MS) {
          throw new DomainError('REAUTH_REQUIRED', 'Enter the password again');
        }
      }
    }
    const verifier = await hashPin(input.newPin);
    await withTenant(this.db, actor.tenantId, async (tx) => {
      await replacePin(
        tx,
        {
          tenantId: actor.tenantId,
          membershipId: actor.membershipId,
          verifier,
          deviceId,
          setByMembershipId: actor.membershipId,
        },
        new Date(),
      );
      await audit(tx, actor.tenantId, actor, {
        action: 'staff_pin.set',
        entityType: 'staff_membership',
        entityId: actor.membershipId,
        details: { by: 'member' },
      });
      await emit(tx, actor.tenantId, 'staff.access_changed.v1', {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
      });
    });
  }

  /**
   * Rule 22: a manager or owner, on a registered PC of the member's branch, sets the PIN the member
   * types there: a new member's first PIN, or a reset of a forgotten or disabled one (rule 7).
   */
  async setMemberPin(actor: StaffActor, membershipId: string, pin: string): Promise<void> {
    const deviceId = this.registeredPc(actor);
    const branchId = actor.branchId as string;
    const target = await withTenant(this.db, actor.tenantId, async (tx) => {
      const manager = await readMembership(tx, { id: actor.membershipId });
      const member = await readMembership(tx, { id: membershipId });
      if (!member) throw new DomainError('NOT_FOUND', 'No such member');
      if (!manager || !mayManageMember(reach(manager), reach(member))) {
        throw new DomainError('FORBIDDEN', 'The member is outside the manager reach');
      }
      if (member.status !== 'active') {
        throw new DomainError('MEMBERSHIP_INACTIVE', 'The member is deactivated');
      }
      if (!member.allBranches && !member.branchIds.includes(branchId)) {
        throw new DomainError('BRANCH_NOT_IN_SCOPE', 'The member does not work in this branch');
      }
      return member;
    });
    const account = await accountById(this.db, target.accountId);
    if (!account) throw new Error('A member without an account');
    assertPinStrong(pin, account.phone);
    const verifier = await hashPin(pin);
    await withTenant(this.db, actor.tenantId, async (tx) => {
      await replacePin(
        tx,
        {
          tenantId: actor.tenantId,
          membershipId,
          verifier,
          deviceId,
          setByMembershipId: actor.membershipId,
        },
        new Date(),
      );
      await audit(tx, actor.tenantId, actor, {
        action: 'staff_pin.set',
        entityType: 'staff_membership',
        entityId: membershipId,
        details: { by: membershipId === actor.membershipId ? 'member' : 'manager' },
      });
      await emit(tx, actor.tenantId, 'staff.access_changed.v1', {
        tenantId: actor.tenantId,
        membershipId,
      });
    });
  }

  async listPersonalDevices(actor: StaffActor): Promise<PersonalDevice[]> {
    return this.personalDevices.list(
      this.db,
      actor.accountId,
      await this.currentPersonalDevice(actor),
    );
  }

  /** Rule 35: the person revokes one of their personal devices; its sessions stop working. */
  async revokePersonalDevice(actor: StaffActor, id: string): Promise<PersonalDevice[]> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(personalDevices)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(personalDevices.id, id),
            eq(personalDevices.accountId, actor.accountId),
            isNull(personalDevices.revokedAt),
          ),
        )
        .returning({ id: personalDevices.id });
      if (!row) throw new DomainError('NOT_FOUND', 'No such personal device');
      await auditPlatform(tx, actor, {
        action: 'personal_device.revoked',
        entityType: 'personal_device',
        entityId: id,
      });
    });
    return this.listPersonalDevices(actor);
  }

  private registeredPc(actor: StaffActor): string {
    if (actor.sessionKind !== 'device' || !actor.deviceId) {
      throw new DomainError('DEVICE_REQUIRED', 'Only on a registered PC');
    }
    return actor.deviceId;
  }

  private async currentPersonalDevice(actor: StaffActor): Promise<string | null> {
    if (actor.sessionKind !== 'personal') return null;
    const [session] = await withTenant(this.db, actor.tenantId, (tx) =>
      tx
        .select({ personalDeviceId: staffSessions.personalDeviceId })
        .from(staffSessions)
        .where(eq(staffSessions.id, actor.sessionId)),
    );
    return session?.personalDeviceId ?? null;
  }
}
