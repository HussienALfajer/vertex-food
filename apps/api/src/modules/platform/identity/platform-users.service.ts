import { Inject, Injectable } from '@nestjs/common';
import {
  assertAdminRemains,
  assertConsoleAdjustmentsAllowed,
  type ConsolePermission,
  type ConsoleRole,
  type CreatePlatformUser,
  DomainError,
  type PlatformUser,
  type PlatformUserSetup,
  type PlatformUserStatus,
  type UpdatePlatformUser,
} from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import { type Database, platformUsers, type Transaction } from '@vertex-food/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PlatformOperator } from '../../../core/access/actor.js';
import { auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import {
  archiveRecoveryCodes,
  endPlatformSessions,
  newSetupCode,
  type PlatformUserRow,
  permissionsOfUser,
  platformUserById,
} from './console-auth.service.js';
import { KEYED_HASH } from './devices.service.js';

export function toPlatformUser(row: PlatformUserRow): PlatformUser {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    role: row.role as ConsoleRole,
    grantedPermissions: row.grantedPermissions as ConsolePermission[],
    revokedPermissions: row.revokedPermissions as ConsolePermission[],
    effectivePermissions: permissionsOfUser(row),
    status: row.status as PlatformUserStatus,
    setupCodeExpiresAt: row.setupCodeExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** An admin in the sense of rule 42: active, and able to manage platform users. */
const isAdmin = (row: PlatformUserRow) =>
  row.status === 'active' && permissionsOfUser(row).includes('console.users.manage');

const notFound = () => new DomainError('NOT_FOUND', 'No such platform user');

/**
 * Platform users (spec S02 rules 38 and 42): created and reset with a one-time setup code shown
 * once, roles and adjustments within the console limits, disabled and enabled. An admin never
 * changes themself, and the last admin is never disabled or demoted (`LAST_ADMIN`); the CLI, as
 * the system, resets even the last admin's TOTP. Every change is in the platform audit and ends
 * the sessions it makes wrong.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KEYED_HASH) private readonly hashes: KeyedHash,
  ) {}

  async list(): Promise<PlatformUser[]> {
    const rows = await this.db
      .select()
      .from(platformUsers)
      .where(isNull(platformUsers.archivedAt))
      .orderBy(asc(platformUsers.createdAt));
    return rows.map(toPlatformUser);
  }

  async create(operator: PlatformOperator, input: CreatePlatformUser): Promise<PlatformUserSetup> {
    assertConsoleAdjustmentsAllowed(input.role, input.grantedPermissions, input.revokedPermissions);
    const now = new Date();
    const setup = newSetupCode(this.hashes, now);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(platformUsers)
          .values({
            phone: input.phone,
            name: input.name,
            role: input.role,
            grantedPermissions: input.grantedPermissions,
            revokedPermissions: input.revokedPermissions,
            status: 'pending_setup',
            ...setup.columns,
          })
          .returning();
        if (!row) throw new Error('A platform user neither inserted nor returned');
        await auditPlatform(tx, operator, {
          action: 'platform_user.created',
          entityType: 'platform_user',
          entityId: row.id,
          details: { role: input.role },
        });
        return {
          user: toPlatformUser(row),
          setupCode: setup.code,
          setupCodeExpiresAt: setup.expiresAt.toISOString(),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'platform_users_phone_unique')) {
        throw new DomainError('CONFLICT', 'A platform user has this phone', { field: 'phone' });
      }
      throw error;
    }
  }

  /** A role or adjustments change, disabling or enabling (rule 42). */
  async update(
    operator: PlatformOperator,
    id: string,
    input: UpdatePlatformUser,
  ): Promise<PlatformUser> {
    this.refuseSelf(operator, id);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Admins first, in one order, then the user: two admins demoting each other wait in turn.
      const admins = await this.lockAdmins(tx);
      const current = await platformUserById(tx, id, { lock: 'update' });
      if (!current || current.archivedAt) throw notFound();
      const role = input.role ?? (current.role as ConsoleRole);
      const granted =
        input.grantedPermissions ?? (current.grantedPermissions as ConsolePermission[]);
      const revoked =
        input.revokedPermissions ?? (current.revokedPermissions as ConsolePermission[]);
      assertConsoleAdjustmentsAllowed(role, granted, revoked);
      let status = current.status as PlatformUserStatus;
      if (input.disabled === true) status = 'disabled';
      if (input.disabled === false && status === 'disabled') {
        status = current.passwordHash && current.totpSecret ? 'active' : 'pending_setup';
      }
      const next: PlatformUserRow = {
        ...current,
        role,
        grantedPermissions: granted,
        revokedPermissions: revoked,
        status,
        updatedAt: now,
      };
      if (isAdmin(current) && !isAdmin(next)) {
        assertAdminRemains(admins.filter((admin) => admin.id !== id && isAdmin(admin)).length);
      }
      await this.assertOperatorActive(tx, operator);
      const [row] = await tx
        .update(platformUsers)
        .set({
          role,
          grantedPermissions: granted,
          revokedPermissions: revoked,
          status,
          updatedAt: now,
        })
        .where(eq(platformUsers.id, id))
        .returning();
      if (!row) throw notFound();
      if (status === 'disabled' && current.status !== 'disabled') {
        await endPlatformSessions(tx, id, 'user_disabled', now);
        await auditPlatform(tx, operator, {
          action: 'platform_user.disabled',
          entityType: 'platform_user',
          entityId: id,
        });
      }
      if (
        role !== current.role ||
        granted.join() !== current.grantedPermissions.join() ||
        revoked.join() !== current.revokedPermissions.join() ||
        (current.status === 'disabled' && status !== 'disabled')
      ) {
        await auditPlatform(tx, operator, {
          action: 'platform_user.updated',
          entityType: 'platform_user',
          entityId: id,
          details: { role, grantedPermissions: granted, revokedPermissions: revoked, status },
        });
      }
      return toPlatformUser(row);
    });
  }

  /**
   * Rule 42: a lost password or TOTP. The user starts over with a new setup code; their password,
   * TOTP, recovery codes and sessions go. A disabled user is enabled first. From the console the
   * last admin is never reset (`LAST_ADMIN`), so two admins resetting each other leave one; the
   * CLI, as the system, recovers even the last.
   */
  async reset(operator: PlatformOperator, id: string): Promise<PlatformUserSetup> {
    this.refuseSelf(operator, id);
    const now = new Date();
    const setup = newSetupCode(this.hashes, now);
    return this.db.transaction(async (tx) => {
      const admins = await this.lockAdmins(tx);
      const current = await platformUserById(tx, id, { lock: 'update' });
      if (!current || current.archivedAt) throw notFound();
      if (current.status === 'disabled') {
        throw new DomainError('INVALID_STATUS_TRANSITION', 'Enable the user before a reset');
      }
      if (operator.kind === 'platform' && isAdmin(current)) {
        assertAdminRemains(admins.filter((admin) => admin.id !== id && isAdmin(admin)).length);
      }
      await this.assertOperatorActive(tx, operator);
      const [row] = await tx
        .update(platformUsers)
        .set({
          status: 'pending_setup',
          passwordHash: null,
          totpSecret: null,
          totpLastStep: null,
          failedSignIns: 0,
          signInLockedUntil: null,
          ...setup.columns,
          updatedAt: now,
        })
        .where(eq(platformUsers.id, id))
        .returning();
      if (!row) throw notFound();
      await archiveRecoveryCodes(tx, id, now);
      await endPlatformSessions(tx, id, 'user_reset', now);
      await auditPlatform(tx, operator, {
        action: 'platform_user.reset',
        entityType: 'platform_user',
        entityId: id,
      });
      return {
        user: toPlatformUser(row),
        setupCode: setup.code,
        setupCodeExpiresAt: setup.expiresAt.toISOString(),
      };
    });
  }

  private refuseSelf(operator: PlatformOperator, id: string): void {
    if (operator.kind === 'platform' && operator.userId === id) {
      throw new DomainError('FORBIDDEN', 'An admin does not change or reset themself');
    }
  }

  /**
   * The operator as they are once the admins are locked: one whom a concurrent change just
   * disabled, reset or deprived of `console.users.manage` changes no one (BE-01).
   */
  private async assertOperatorActive(tx: Transaction, operator: PlatformOperator): Promise<void> {
    if (operator.kind !== 'platform') return;
    const row = await platformUserById(tx, operator.userId);
    if (!row || row.archivedAt || !isAdmin(row)) {
      throw new DomainError('FORBIDDEN', 'The operator may no longer manage platform users');
    }
  }

  private lockAdmins(tx: Transaction): Promise<PlatformUserRow[]> {
    return tx
      .select()
      .from(platformUsers)
      .where(and(eq(platformUsers.role, 'admin'), eq(platformUsers.status, 'active')))
      .orderBy(asc(platformUsers.id))
      .for('update');
  }
}
