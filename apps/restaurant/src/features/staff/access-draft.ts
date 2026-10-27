import {
  type BranchScope,
  effectivePermissions,
  isWithinLimit,
  ownerLockedPermissions,
  rolePresets,
  type StaffMember,
  type StaffPermission,
  type StaffRole,
  staffRoles,
} from '@vertex-food/contracts';

/**
 * A member's access as the staff screens edit it (spec S02 screen 10, rules 4–7): roles, branch
 * scope and the owner's permission adjustments. Pure, so the rules the screens show are unit-tested;
 * the API checks every one of them again.
 */
export type AccessDraft = {
  roles: StaffRole[];
  allBranches: boolean;
  branchIds: string[];
  granted: StaffPermission[];
  revoked: StaffPermission[];
};

export const emptyAccess: AccessDraft = {
  roles: [],
  allBranches: false,
  branchIds: [],
  granted: [],
  revoked: [],
};

export function accessOfMember(member: StaffMember): AccessDraft {
  return {
    roles: [...member.roles],
    allBranches: member.allBranches,
    branchIds: member.allBranches ? [] : [...member.branchIds],
    granted: [...member.grantedPermissions],
    revoked: [...member.revokedPermissions],
  };
}

/** Roles in catalog order, so a draft compares equal whatever order they were ticked in. */
export function withRole(draft: AccessDraft, role: StaffRole, on: boolean): AccessDraft {
  const roles = staffRoles.filter((item) => (item === role ? on : draft.roles.includes(item)));
  // Owners hold every branch (rule 4).
  return roles.includes('owner')
    ? { ...draft, roles, allBranches: true, branchIds: [] }
    : { ...draft, roles };
}

export function withBranch(draft: AccessDraft, branchId: string, on: boolean): AccessDraft {
  const branchIds = on
    ? [...new Set([...draft.branchIds, branchId])]
    : draft.branchIds.filter((id) => id !== branchId);
  return { ...draft, branchIds };
}

/** Where a permission comes from, as screen 10 shows it next to each one. */
export type PermissionSource = 'role' | 'added' | 'removed' | 'none';

export function permissionSource(
  draft: AccessDraft,
  permission: StaffPermission,
): PermissionSource {
  if (draft.granted.includes(permission)) return 'added';
  if (draft.revoked.includes(permission)) return 'removed';
  return draft.roles.some((role) => rolePresets[role].includes(permission)) ? 'role' : 'none';
}

export function heldPermissions(draft: AccessDraft): StaffPermission[] {
  return effectivePermissions(draft.roles, draft.granted, draft.revoked);
}

/**
 * Why a permission cannot be changed for these roles, or null: outside the roles' limits, or kept
 * by every owner (`ownerLockedPermissions`).
 */
export function lockedReason(
  draft: AccessDraft,
  permission: StaffPermission,
): 'outsideLimits' | 'ownerLocked' | null {
  if (draft.roles.length === 0 || !isWithinLimit(draft.roles, permission)) return 'outsideLimits';
  if (draft.roles.includes('owner') && ownerLockedPermissions.includes(permission)) {
    return 'ownerLocked';
  }
  return null;
}

/** Turns a permission on or off: an adjustment only where the roles' presets differ. */
export function withPermission(
  draft: AccessDraft,
  permission: StaffPermission,
  on: boolean,
): AccessDraft {
  const fromRole = draft.roles.some((role) => rolePresets[role].includes(permission));
  const granted = draft.granted.filter((item) => item !== permission);
  const revoked = draft.revoked.filter((item) => item !== permission);
  if (on && !fromRole) granted.push(permission);
  if (!on && fromRole) revoked.push(permission);
  return { ...draft, granted, revoked };
}

/**
 * The adjustments the roles still allow (rule 5): a role change drops grants outside the new
 * roles' limits and revocations an owner cannot have, so the API never refuses what the screen
 * no longer shows.
 */
export function prunedAdjustments(draft: AccessDraft): Pick<AccessDraft, 'granted' | 'revoked'> {
  const owner = draft.roles.includes('owner');
  return {
    granted: draft.granted.filter(
      (permission) =>
        isWithinLimit(draft.roles, permission) &&
        !draft.roles.some((role) => rolePresets[role].includes(permission)),
    ),
    revoked: draft.revoked.filter(
      (permission) =>
        isWithinLimit(draft.roles, permission) &&
        !(owner && ownerLockedPermissions.includes(permission)) &&
        draft.roles.some((role) => rolePresets[role].includes(permission)),
    ),
  };
}

export function scopeOf(draft: AccessDraft): BranchScope {
  return draft.allBranches
    ? { allBranches: true }
    : { allBranches: false, branchIds: [...draft.branchIds] };
}

export type AccessErrors = { roles?: 'required'; branches?: 'required' };

/** At least one role and one branch (rule 1, edge case 5). */
export function accessErrors(draft: AccessDraft): AccessErrors {
  const errors: AccessErrors = {};
  if (draft.roles.length === 0) errors.roles = 'required';
  if (!draft.allBranches && draft.branchIds.length === 0) errors.branches = 'required';
  return errors;
}
