import { z } from 'zod';
import {
  managerAssignableRoles,
  permissionGroupSchema,
  type StaffRole,
  staffPermissionSchema,
  staffRoleSchema,
  staffRoles,
} from './access.js';
import { DomainError } from './errors.js';
import { mobilePhoneNumberSchema } from './phone.js';
import { idSchema, instantSchema, listQuerySchema, pageSchema } from './primitives.js';

/**
 * Staff memberships (spec S02, ADR 0005): a person's place in a tenant, with roles, a branch scope
 * and permission adjustments, and the pure rules of who may manage whom.
 */

export const membershipStatusSchema = z
  .enum(['active', 'deactivated'])
  .meta({ id: 'MembershipStatus' });

export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const displayNameSchema = z.string().trim().min(2).max(100);

const staffRolesSchema = z
  .array(staffRoleSchema)
  .min(1)
  .max(staffRoles.length)
  .refine((roles) => new Set(roles).size === roles.length, 'Roles must be distinct');

/** All branches (every owner), or at least one branch. */
export const branchScopeSchema = z
  .discriminatedUnion('allBranches', [
    z.object({ allBranches: z.literal(true) }),
    z.object({ allBranches: z.literal(false), branchIds: z.array(idSchema).min(1).max(100) }),
  ])
  .meta({ id: 'BranchScope' });

export type BranchScope = z.infer<typeof branchScopeSchema>;

const permissionListSchema = z.array(staffPermissionSchema).max(50);

export const staffMemberSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    phone: z.string(),
    displayName: z.string(),
    /** The name the person set at first sign-in; the display name until then. */
    nameAr: z.string().nullable(),
    roles: z.array(staffRoleSchema),
    allBranches: z.boolean(),
    branchIds: z.array(idSchema),
    grantedPermissions: z.array(staffPermissionSchema),
    revokedPermissions: z.array(staffPermissionSchema),
    effectivePermissions: z.array(staffPermissionSchema),
    status: membershipStatusSchema,
    hasPassword: z.boolean(),
    pinSet: z.boolean(),
    pinDisabled: z.boolean(),
    deactivatedAt: instantSchema.nullable(),
    deactivationReason: z.string().nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'StaffMember' });

export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffMemberPageSchema = pageSchema(staffMemberSchema).meta({ id: 'StaffMemberPage' });

export const listStaffQuerySchema = listQuerySchema(['displayName', 'createdAt'])
  .extend({ status: membershipStatusSchema.optional(), branchId: idSchema.optional() })
  .meta({ id: 'ListStaffQuery' });

export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

export const addStaffMemberSchema = z
  .object({
    phone: mobilePhoneNumberSchema,
    displayName: displayNameSchema,
    roles: staffRolesSchema,
    branchScope: branchScopeSchema,
    grantedPermissions: permissionListSchema.default([]),
    revokedPermissions: permissionListSchema.default([]),
  })
  .meta({ id: 'AddStaffMember' });

export type AddStaffMember = z.infer<typeof addStaffMemberSchema>;

/** Rule 9: carries the `updatedAt` the client read. */
export const changeStaffAccessSchema = z
  .object({
    roles: staffRolesSchema,
    branchScope: branchScopeSchema,
    grantedPermissions: permissionListSchema,
    revokedPermissions: permissionListSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'ChangeStaffAccess' });

export type ChangeStaffAccess = z.infer<typeof changeStaffAccessSchema>;

export const deactivateStaffMemberSchema = z
  .object({ reason: z.string().trim().min(1).max(200) })
  .meta({ id: 'DeactivateStaffMember' });

export type DeactivateStaffMember = z.infer<typeof deactivateStaffMemberSchema>;

/** `GET /api/access/catalog`: what the staff screens show and allow for the caller. */
export const accessCatalogSchema = z
  .object({
    permissions: z.array(
      z.object({
        key: staffPermissionSchema,
        group: permissionGroupSchema,
        branchScoped: z.boolean(),
        limit: z.array(staffRoleSchema),
      }),
    ),
    presets: z.array(
      z.object({ role: staffRoleSchema, permissions: z.array(staffPermissionSchema) }),
    ),
    ownerLockedPermissions: z.array(staffPermissionSchema),
    /** The roles the caller may assign (rule 7). */
    assignableRoles: z.array(staffRoleSchema),
    /** Owners only (`staff.permissions.adjust`). */
    mayAdjustPermissions: z.boolean(),
  })
  .meta({ id: 'AccessCatalog' });

export type AccessCatalog = z.infer<typeof accessCatalogSchema>;

// Rules.

/** Owners hold every branch (rule 4); a member holds at least one branch (edge case 5). */
export function assertMembershipShape(roles: readonly StaffRole[], scope: BranchScope): void {
  if (roles.includes('owner') && !scope.allBranches) {
    throw new DomainError('VALIDATION_FAILED', 'An owner holds every branch');
  }
  if (!scope.allBranches && scope.branchIds.length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'A member holds at least one branch');
  }
}

/** The roles a member with `roles` may assign: an owner any, a manager only rule 7's. */
export function assignableRoles(roles: readonly StaffRole[]): StaffRole[] {
  if (roles.includes('owner')) return [...staffRoles];
  if (roles.includes('manager')) return [...managerAssignableRoles];
  return [];
}

/** A member's roles and branches, as rule 7 compares them. */
export type MemberReach = {
  roles: readonly StaffRole[];
  allBranches: boolean;
  branchIds: readonly string[];
};

function branchesWithin(inner: MemberReach, outer: MemberReach): boolean {
  if (outer.allBranches) return true;
  if (inner.allBranches) return false;
  return inner.branchIds.every((branchId) => outer.branchIds.includes(branchId));
}

/**
 * Rule 7: an owner manages anyone; a manager manages members whose roles are all among
 * `managerAssignableRoles` and whose branches are all within the manager's. The caller checks
 * `staff.manage` itself. Applies to the member as stored and, on a change, as requested.
 */
export function mayManageMember(manager: MemberReach, target: MemberReach): boolean {
  if (manager.roles.includes('owner')) return true;
  if (!manager.roles.includes('manager')) return false;
  return (
    target.roles.every((role) => managerAssignableRoles.includes(role)) &&
    branchesWithin(target, manager)
  );
}

/** The scope as stored: `branchIds` empty for all branches. */
export function reachOf(roles: readonly StaffRole[], scope: BranchScope): MemberReach {
  return scope.allBranches
    ? { roles, allBranches: true, branchIds: [] }
    : { roles, allBranches: false, branchIds: scope.branchIds };
}
