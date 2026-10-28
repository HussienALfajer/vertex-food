import { isNull, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAt,
  createdAt,
  id,
  idIsUuidV7,
  tenantId,
  timestamptz,
  updatedAt,
} from './columns.js';
import { accounts } from './identity.js';
import { branches, tenants } from './tenancy.js';

// Staff roles of `staffRoles` in @vertex-food/contracts (spec S02).
const ROLES = ['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver'];

/**
 * Which tenants an account belongs to, so sign-in can offer them before any tenant context exists
 * (spec S02). Holds no roles: every decision reads `staff_memberships` under the tenant's RLS.
 * Written in the same transaction as the membership it mirrors.
 */
export const accountTenantLinks = pgTable(
  'account_tenant_links',
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    linkedTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('account_tenant_links', t.id),
    unique('account_tenant_links_account_tenant_unique').on(t.accountId, t.linkedTenantId),
    index('account_tenant_links_tenant_idx').on(t.linkedTenantId),
  ],
);

/**
 * A person's place in a tenant (a "staff member", ADR 0005, spec S02): roles, branch scope and the
 * owner's permission adjustments. Effective permissions are computed by `effectivePermissions` in
 * `packages/contracts`; the catalog grows with later specs, so the keys are checked there, not
 * here. One row per account and tenant: a deactivated member is reactivated, never added twice.
 */
export const staffMemberships = pgTable(
  'staff_memberships',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    /** The account (platform table). */
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    status: text().notNull().default('active'),
    roles: text().array().notNull(),
    /** True for owners; otherwise the branches are in `staff_membership_branches`. */
    allBranches: boolean().notNull().default(false),
    grantedPermissions: text().array().notNull().default(sql`'{}'::text[]`),
    revokedPermissions: text().array().notNull().default(sql`'{}'::text[]`),
    /** The name typed when the member was added; lists show `accounts.name_ar` once set. */
    displayName: text().notNull(),
    /** Null for the owner Vertex creates with the tenant. */
    addedByMembershipId: uuid(),
    deactivatedAt: timestamptz(),
    deactivationReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('staff_memberships', t.id),
    // Parent of composite keys from other tenant tables, `(tenant_id, membership_id)`.
    unique('staff_memberships_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('staff_memberships_tenant_account_unique').on(t.tenantId, t.accountId),
    foreignKey({
      name: 'staff_memberships_added_by_fk',
      columns: [t.tenantId, t.addedByMembershipId],
      foreignColumns: [t.tenantId, t.id] as [AnyPgColumn, AnyPgColumn],
    }),
    check('staff_memberships_status', sql`${t.status} in ('active', 'deactivated')`),
    // 1–6 distinct roles of the list: as many as the known roles they contain.
    check(
      'staff_memberships_roles',
      sql`cardinality(${t.roles}) between 1 and 6 and ${t.roles} <@ array[${sql.raw(ROLES.map((role) => `'${role}'`).join(', '))}] and cardinality(${t.roles}) = ${sql.raw(ROLES.map((role) => `('${role}' = any(roles))::int`).join(' + '))}`,
    ),
    check(
      'staff_memberships_owner_all_branches',
      sql`not ('owner' = any(${t.roles})) or ${t.allBranches}`,
    ),
    check(
      'staff_memberships_adjustments_disjoint',
      sql`not (${t.grantedPermissions} && ${t.revokedPermissions})`,
    ),
    check(
      'staff_memberships_display_name',
      sql`char_length(${t.displayName}) between 2 and 100 and ${t.displayName} = btrim(${t.displayName})`,
    ),
    check(
      'staff_memberships_deactivated',
      sql`(${t.status} = 'deactivated') = (${t.deactivatedAt} is not null) and (${t.status} = 'deactivated') = (${t.deactivationReason} is not null)`,
    ),
    check(
      'staff_memberships_deactivation_reason',
      sql`char_length(${t.deactivationReason}) between 1 and 200`,
    ),
    index('staff_memberships_tenant_status_idx').on(t.tenantId, t.status),
    index('staff_memberships_tenant_added_by_idx').on(t.tenantId, t.addedByMembershipId),
  ],
);

/** The branches of a member whose `all_branches` is false (at least one, checked by the API). */
export const staffMembershipBranches = pgTable(
  'staff_membership_branches',
  {
    id: id(),
    tenantId: tenantId(),
    membershipId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('staff_membership_branches', t.id),
    foreignKey({
      name: 'staff_membership_branches_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'staff_membership_branches_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    uniqueIndex('staff_membership_branches_current_idx')
      .on(t.tenantId, t.membershipId, t.branchId)
      .where(isNull(t.archivedAt)),
    index('staff_membership_branches_membership_idx').on(t.tenantId, t.membershipId),
    index('staff_membership_branches_branch_idx').on(t.tenantId, t.branchId),
  ],
);

/**
 * A member's access as it stood from `effective_from` (spec S04, ADR 0035): every S02 access
 * change appends one in its transaction, so the server checks a command against the access its
 * member held at the command's effective time. `permissions` are the effective ones of that
 * release's presets, kept as they were.
 */
export const membershipAccessSnapshots = pgTable(
  'membership_access_snapshots',
  {
    id: id(),
    tenantId: tenantId(),
    membershipId: uuid().notNull(),
    status: text().notNull(),
    roles: text().array().notNull(),
    allBranches: boolean().notNull(),
    branchIds: uuid().array().notNull(),
    permissions: text().array().notNull(),
    effectiveFrom: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('membership_access_snapshots', t.id),
    foreignKey({
      name: 'membership_access_snapshots_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check('membership_access_snapshots_status', sql`${t.status} in ('active', 'deactivated')`),
    check(
      'membership_access_snapshots_roles',
      sql`cardinality(${t.roles}) between 1 and 6 and ${t.roles} <@ array[${sql.raw(ROLES.map((role) => `'${role}'`).join(', '))}]`,
    ),
    check(
      'membership_access_snapshots_scope',
      sql`not ${t.allBranches} or cardinality(${t.branchIds}) = 0`,
    ),
    index('membership_access_snapshots_tenant_membership_idx').on(
      t.tenantId,
      t.membershipId,
      t.effectiveFrom,
    ),
  ],
);
