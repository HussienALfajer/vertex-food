import { effectivePermissions, type StaffPermission, type StaffRole } from '@vertex-food/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from './client.js';
import {
  membershipAccessSnapshots,
  staffMembershipBranches,
  staffMemberships,
} from './schema/access.js';

// Access history (spec S04, ADR 0035): S02's promise that a command is checked against the access
// its member held when it was made. Every write path that changes a membership's status, roles,
// branch scope or adjustments calls this in its own transaction, after the change.

/**
 * Appends the membership's access as it now stands, effective from the transaction's start, with
 * the permissions this release's presets give it (`effectivePermissions`). Called inside the
 * tenant's `withTenant`.
 */
export async function appendAccessSnapshot(tx: Transaction, membershipId: string): Promise<void> {
  const [membership] = await tx
    .select({
      tenantId: staffMemberships.tenantId,
      status: staffMemberships.status,
      roles: staffMemberships.roles,
      allBranches: staffMemberships.allBranches,
      grantedPermissions: staffMemberships.grantedPermissions,
      revokedPermissions: staffMemberships.revokedPermissions,
    })
    .from(staffMemberships)
    .where(eq(staffMemberships.id, membershipId));
  if (!membership) throw new Error(`membership ${membershipId} not found`);
  const branches = membership.allBranches
    ? []
    : await tx
        .select({ branchId: staffMembershipBranches.branchId })
        .from(staffMembershipBranches)
        .where(
          and(
            eq(staffMembershipBranches.membershipId, membershipId),
            isNull(staffMembershipBranches.archivedAt),
          ),
        );
  const roles = membership.roles as StaffRole[];
  await tx.insert(membershipAccessSnapshots).values({
    tenantId: membership.tenantId,
    membershipId,
    status: membership.status,
    roles,
    allBranches: membership.allBranches,
    branchIds: branches.map((branch) => branch.branchId).sort(),
    permissions: effectivePermissions(
      roles,
      membership.grantedPermissions as StaffPermission[],
      membership.revokedPermissions as StaffPermission[],
    ),
    // The transaction's start: the change and its snapshot take effect together.
    effectiveFrom: sql`now()`,
  });
}
