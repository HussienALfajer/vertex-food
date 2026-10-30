import { passwordResetHours } from '@vertex-food/contracts';
import { accounts, type Database, type Transaction } from '@vertex-food/db';
import { eq, inArray } from 'drizzle-orm';
import type { Actor, StaffActor } from '../../../core/access/actor.js';
import { auditPlatform } from '../../../core/audit/audit.js';
import type { StaffAccounts } from '../access/index.js';

export type AccountRow = typeof accounts.$inferSelect;

/** The account of a phone (E.164), or undefined. */
export async function accountByPhone(
  db: Database | Transaction,
  phone: string,
): Promise<AccountRow | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.phone, phone));
  return row;
}

export async function accountById(
  db: Database | Transaction,
  id: string,
  options: { lock?: 'update' } = {},
): Promise<AccountRow | undefined> {
  const query = db.select().from(accounts).where(eq(accounts.id, id));
  const [row] = await (options.lock ? query.for(options.lock) : query);
  return row;
}

/**
 * The names people set on their accounts, by id (null before they set one): the platform audit
 * names an account acting on itself (spec S06 rule 18).
 */
export async function accountNames(
  db: Database | Transaction,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: accounts.id, nameAr: accounts.nameAr })
    .from(accounts)
    .where(inArray(accounts.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.nameAr]));
}

/** Whether an authorized password reset is open for the account (rule 14). */
export function resetOpen(account: AccountRow, now: Date): boolean {
  return (account.passwordResetAuthorizedUntil?.getTime() ?? 0) > now.getTime();
}

/**
 * Accounts as staff management reaches them (spec S02 rules 1 and 14), behind access's
 * `STAFF_ACCOUNTS` port: the accounts table is identity's alone.
 */
export class StaffAccountsStore implements StaffAccounts {
  async findOrCreate(tx: Transaction, phone: string, actor: Actor): Promise<string> {
    const [created] = await tx
      .insert(accounts)
      .values({ phone })
      .onConflictDoNothing({ target: accounts.phone })
      .returning({ id: accounts.id });
    if (created) {
      await auditPlatform(tx, actor, {
        action: 'account.created',
        entityType: 'account',
        entityId: created.id,
      });
      return created.id;
    }
    const existing = await accountByPhone(tx, phone);
    if (!existing) throw new Error('An account neither inserted nor found');
    return existing.id;
  }

  async profiles(tx: Transaction, accountIds: string[]) {
    const profiles = new Map<
      string,
      { phone: string; nameAr: string | null; hasPassword: boolean }
    >();
    if (accountIds.length === 0) return profiles;
    const rows = await tx
      .select({
        id: accounts.id,
        phone: accounts.phone,
        nameAr: accounts.nameAr,
        passwordHash: accounts.passwordHash,
      })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    for (const row of rows) {
      profiles.set(row.id, {
        phone: row.phone,
        nameAr: row.nameAr,
        hasPassword: row.passwordHash !== null,
      });
    }
    return profiles;
  }

  async authorizePasswordReset(
    tx: Transaction,
    accountId: string,
    actor: StaffActor,
    until: Date,
  ): Promise<void> {
    await tx
      .update(accounts)
      .set({ passwordResetAuthorizedUntil: until, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
    await auditPlatform(tx, actor, {
      action: 'account.password_reset_authorized',
      entityType: 'account',
      entityId: accountId,
      details: { hours: passwordResetHours, tenantId: actor.tenantId },
    });
  }
}
