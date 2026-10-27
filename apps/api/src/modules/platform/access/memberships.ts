import {
  effectivePermissions,
  type MemberReach,
  type MembershipStatus,
  type StaffPermission,
  type StaffRole,
} from '@vertex-food/contracts';
import {
  accountTenantLinks,
  type Database,
  staffMembershipBranches,
  staffMemberships,
  type Transaction,
} from '@vertex-food/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Staff memberships as sign-in, devices and sessions read them (spec S02). Functions run in the
 * caller's tenant transaction (`withTenant`), so RLS keeps them to that tenant; the link table is
 * read outside any tenant, only to offer an account's tenants, and every choice is rechecked here.
 * Copied from Vertex Shifa and adapted.
 */

export type Membership = {
  id: string;
  tenantId: string;
  accountId: string;
  status: MembershipStatus;
  roles: StaffRole[];
  allBranches: boolean;
  /** The member's branches when `allBranches` is false. */
  branchIds: string[];
  granted: StaffPermission[];
  revoked: StaffPermission[];
  displayName: string;
  addedByMembershipId: string | null;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The member's effective permissions (`effectivePermissions`, spec S02 rule 5). */
export function permissionsOf(member: Membership): StaffPermission[] {
  return effectivePermissions(member.roles, member.granted, member.revoked);
}

/** Whether a PC of `branchId` is in the member's scope (rule 6). */
export function inScope(member: Membership, branchId: string): boolean {
  return member.allBranches || member.branchIds.includes(branchId);
}

/** The member's roles and branches, as rule 7 compares them. */
export function reach(member: Membership): MemberReach {
  return { roles: member.roles, allBranches: member.allBranches, branchIds: member.branchIds };
}

type MembershipRow = typeof staffMemberships.$inferSelect;

/** A membership row with the branches of its scope. */
function toMembership(row: MembershipRow, branchIds: string[]): Membership {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    status: row.status as MembershipStatus,
    roles: row.roles as StaffRole[],
    allBranches: row.allBranches,
    branchIds: row.allBranches ? [] : branchIds,
    granted: row.grantedPermissions as StaffPermission[],
    revoked: row.revokedPermissions as StaffPermission[],
    displayName: row.displayName,
    addedByMembershipId: row.addedByMembershipId,
    deactivatedAt: row.deactivatedAt,
    deactivationReason: row.deactivationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The current branches of members of the transaction's tenant, by membership id. */
async function branchesOf(tx: Transaction, ids: string[]): Promise<Map<string, string[]>> {
  const byMember = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byMember;
  const rows = await tx
    .select({
      membershipId: staffMembershipBranches.membershipId,
      branchId: staffMembershipBranches.branchId,
    })
    .from(staffMembershipBranches)
    .where(
      and(
        inArray(staffMembershipBranches.membershipId, ids),
        isNull(staffMembershipBranches.archivedAt),
      ),
    );
  for (const row of rows) byMember.get(row.membershipId)?.push(row.branchId);
  return byMember;
}

/**
 * A membership of the transaction's tenant, by id or by account. With `lock`, the row is locked
 * for update (every access change and session opening takes it first, rule 8).
 */
export async function readMembership(
  tx: Transaction,
  by: { id: string } | { accountId: string },
  options: { lock?: 'update' | 'share' } = {},
): Promise<Membership | undefined> {
  const query = tx
    .select()
    .from(staffMemberships)
    .where(
      'id' in by ? eq(staffMemberships.id, by.id) : eq(staffMemberships.accountId, by.accountId),
    );
  const [row] = await (options.lock ? query.for(options.lock) : query);
  if (!row) return undefined;
  const branches = await branchesOf(tx, [row.id]);
  return toMembership(row, branches.get(row.id) ?? []);
}

/** Memberships of the transaction's tenant, with their branches; every one when `ids` is absent. */
export async function readMemberships(tx: Transaction, ids?: string[]): Promise<Membership[]> {
  const rows = await tx
    .select()
    .from(staffMemberships)
    .where(ids ? inArray(staffMemberships.id, ids) : undefined);
  const branches = await branchesOf(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toMembership(row, branches.get(row.id) ?? []));
}

/** The tenants an account is linked to (not archived), to offer at sign-in (rules 18, 34). */
export async function linkedTenantIds(
  db: Database | Transaction,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ tenantId: accountTenantLinks.linkedTenantId })
    .from(accountTenantLinks)
    .where(and(eq(accountTenantLinks.accountId, accountId), isNull(accountTenantLinks.archivedAt)));
  return rows.map((row) => row.tenantId);
}

/** Links the account to the tenant in the membership's transaction, so sign-in can offer it. */
export async function linkAccount(
  tx: Transaction,
  accountId: string,
  tenantId: string,
  now: Date,
): Promise<void> {
  await tx
    .insert(accountTenantLinks)
    .values({ accountId, linkedTenantId: tenantId })
    .onConflictDoUpdate({
      target: [accountTenantLinks.accountId, accountTenantLinks.linkedTenantId],
      set: { archivedAt: null, updatedAt: now },
    });
}

/**
 * Sets the member's branch scope (rule 6): archives the branches that left it and inserts the new
 * ones; answers the branches that left, whose devices end the member's sessions (rule 8).
 */
export async function replaceBranches(
  tx: Transaction,
  member: { id: string; tenantId: string; branchIds: string[] },
  branchIds: string[],
  now: Date,
): Promise<string[]> {
  const left = member.branchIds.filter((id) => !branchIds.includes(id));
  const added = branchIds.filter((id) => !member.branchIds.includes(id));
  if (left.length > 0) {
    await tx
      .update(staffMembershipBranches)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(staffMembershipBranches.membershipId, member.id),
          inArray(staffMembershipBranches.branchId, left),
          isNull(staffMembershipBranches.archivedAt),
        ),
      );
  }
  if (added.length > 0) {
    await tx
      .insert(staffMembershipBranches)
      .values(
        added.map((branchId) => ({ tenantId: member.tenantId, membershipId: member.id, branchId })),
      );
  }
  return left;
}
