import { Inject, Injectable } from '@nestjs/common';
import {
  type ConsoleAccount,
  DomainError,
  effectiveStatus,
  passwordResetHours,
} from '@vertex-food/contracts';
import {
  accounts,
  type Database,
  enterTenant,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import type { PlatformOperator } from '../../../core/access/actor.js';
import { type AuditRecord, audit, auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { linkedTenantIds, readMembership } from '../access/index.js';
import { readTenant, statusState } from '../tenancy/index.js';
import { accountById, accountByPhone } from './accounts.js';

const HOUR_MS = 3_600_000;

const notFound = () => new DomainError('NOT_FOUND', 'No such account');

/**
 * Owner recovery by Vertex support (spec S02 rule 15, ADR 0005): finding an account by phone with
 * its restaurants and roles, authorizing a password reset (rule 14) and changing the account's
 * phone, each with a reason, in the platform audit and in the audit of every tenant where the
 * account is an owner. The console routes and the CLI call the same service.
 */
@Injectable()
export class ConsoleAccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async lookup(phone: string): Promise<ConsoleAccount> {
    const account = await accountByPhone(this.db, phone);
    if (!account) throw notFound();
    return this.view(account.id);
  }

  async lookupId(phone: string): Promise<string> {
    const account = await accountByPhone(this.db, phone);
    if (!account) throw notFound();
    return account.id;
  }

  /** Rule 15: the account may set a new password through an OTP for 72 hours. */
  async authorizePasswordReset(
    operator: PlatformOperator,
    accountId: string,
    reason: string,
  ): Promise<{ accountId: string; passwordResetAuthorizedUntil: string }> {
    const now = new Date();
    const until = new Date(now.getTime() + passwordResetHours * HOUR_MS);
    await this.db.transaction(async (tx) => {
      const account = await accountById(tx, accountId, { lock: 'update' });
      if (!account) throw notFound();
      await tx
        .update(accounts)
        .set({ passwordResetAuthorizedUntil: until, updatedAt: now })
        .where(eq(accounts.id, accountId));
      await this.record(tx, operator, accountId, {
        action: 'account.password_reset_authorized',
        entityType: 'account',
        entityId: accountId,
        reason,
        details: { hours: passwordResetHours },
      });
    });
    return { accountId, passwordResetAuthorizedUntil: until.toISOString() };
  }

  /**
   * Rule 15, edge case 10: the account's new phone. Memberships, PINs and personal devices stay;
   * the next OTP goes to the new phone, which counts as unverified until then.
   */
  async changePhone(
    operator: PlatformOperator,
    accountId: string,
    phone: string,
    reason: string,
  ): Promise<ConsoleAccount> {
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const account = await accountById(tx, accountId, { lock: 'update' });
        if (!account) throw notFound();
        if (account.phone === phone) return;
        await tx
          .update(accounts)
          .set({ phone, phoneVerifiedAt: null, updatedAt: now })
          .where(eq(accounts.id, accountId));
        await this.record(tx, operator, accountId, {
          action: 'account.phone_changed',
          entityType: 'account',
          entityId: accountId,
          reason,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'accounts_phone_unique')) {
        throw new DomainError('ALREADY_MEMBER', 'Another account has this phone');
      }
      throw error;
    }
    return this.view(accountId);
  }

  /** The platform audit, and the audit of every tenant where the account is an owner (rule 15). */
  private async record(
    tx: Transaction,
    operator: PlatformOperator,
    accountId: string,
    entry: AuditRecord,
  ): Promise<void> {
    await auditPlatform(tx, operator, entry);
    for (const tenantId of await linkedTenantIds(tx, accountId)) {
      await enterTenant(tx, tenantId);
      const member = await readMembership(tx, { accountId });
      if (!member?.roles.includes('owner')) continue;
      // The reason is support's own note: the tenant's entry keeps ids only.
      await audit(tx, tenantId, operator, { ...entry, reason: null });
    }
  }

  private async view(accountId: string): Promise<ConsoleAccount> {
    const account = await accountById(this.db, accountId);
    if (!account) throw notFound();
    const memberships: ConsoleAccount['memberships'] = [];
    for (const tenantId of await linkedTenantIds(this.db, accountId)) {
      const entry = await withTenant(this.db, tenantId, async (tx) => {
        const member = await readMembership(tx, { accountId });
        if (!member) return undefined;
        const tenant = await readTenant(tx, tenantId);
        return {
          tenantId,
          tenantNameAr: tenant.nameAr,
          tenantStatus: effectiveStatus(statusState(tenant), new Date()),
          membershipId: member.id,
          status: member.status,
          roles: member.roles,
        };
      });
      if (entry) memberships.push(entry);
    }
    return {
      id: account.id,
      phone: account.phone,
      nameAr: account.nameAr,
      hasPassword: account.passwordHash !== null,
      passwordResetAuthorizedUntil: account.passwordResetAuthorizedUntil?.toISOString() ?? null,
      signInLockedUntil: account.signInLockedUntil?.toISOString() ?? null,
      memberships,
    };
  }
}
