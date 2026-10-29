import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { staffMembershipBranches, staffMemberships } from '../schema/access.js';
import { accounts } from '../schema/identity.js';
import { branches } from '../schema/tenancy.js';
import { byPages, EXPORT_PAGE_SIZE, type ExportDataset } from './dataset.js';

// The restaurant's team (module `access`, spec S02): one row per membership, current and former,
// with what the staff list shows of its account (name and phone, platform data read through the
// membership).

export const staffDataset: ExportDataset = {
  stem: 'staff',
  tables: ['staff_memberships', 'staff_membership_branches'],
  reads: ['accounts', 'branches'],
  columns: [
    { name: 'membership_id', kind: 'text' },
    { name: 'account_id', kind: 'text' },
    { name: 'name', kind: 'text' },
    { name: 'phone', kind: 'text' },
    { name: 'roles', kind: 'list' },
    { name: 'all_branches', kind: 'boolean' },
    { name: 'branches', kind: 'list' },
    { name: 'granted_permissions', kind: 'list' },
    { name: 'revoked_permissions', kind: 'list' },
    { name: 'status', kind: 'text' },
    { name: 'added_at', kind: 'instant' },
    { name: 'deactivated_at', kind: 'instant' },
    { name: 'deactivation_reason', kind: 'text' },
    { name: 'updated_at', kind: 'instant' },
  ],
  async *rows(tx) {
    const pages = byPages((after) =>
      tx
        .select({
          id: staffMemberships.id,
          membership: staffMemberships,
          accountName: accounts.nameAr,
          phone: accounts.phone,
        })
        .from(staffMemberships)
        .innerJoin(accounts, eq(accounts.id, staffMemberships.accountId))
        .where(after === null ? undefined : gt(staffMemberships.id, after))
        .orderBy(asc(staffMemberships.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const { membership, accountName, phone } of pages) {
      const scope = await tx
        .select({ code: branches.code })
        .from(staffMembershipBranches)
        .innerJoin(branches, eq(branches.id, staffMembershipBranches.branchId))
        .where(
          and(
            eq(staffMembershipBranches.membershipId, membership.id),
            isNull(staffMembershipBranches.archivedAt),
          ),
        )
        .orderBy(asc(branches.code));
      yield {
        membership_id: membership.id,
        account_id: membership.accountId,
        // The staff list shows the account's name once the person set it (spec S02).
        name: accountName ?? membership.displayName,
        phone,
        roles: membership.roles,
        all_branches: membership.allBranches,
        branches: membership.allBranches ? [] : scope.map((row) => row.code),
        granted_permissions: membership.grantedPermissions,
        revoked_permissions: membership.revokedPermissions,
        status: membership.status,
        added_at: membership.createdAt,
        deactivated_at: membership.deactivatedAt,
        deactivation_reason: membership.deactivationReason,
        updated_at: membership.updatedAt,
      };
    }
  },
};
