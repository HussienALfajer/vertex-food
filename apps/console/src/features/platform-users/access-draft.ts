import {
  type ConsolePermission,
  type ConsoleRole,
  consolePermissions,
  consolePresets,
  effectiveConsolePermissions,
  isWithinConsoleLimit,
} from '@vertex-food/contracts';

/**
 * What a platform user may do, as the access dialog edits it (spec S02 screen 16, rule 42): a role
 * and the permissions the user holds. Saving turns it back into the role's preset plus grants
 * minus revocations, only within the role's limits, so the API never answers
 * `PERMISSION_NOT_GRANTABLE` for a choice the dialog offered.
 */
export type AccessDraft = { role: ConsoleRole; held: ReadonlySet<ConsolePermission> };

/** How a permission stands for a role: from the role, added, removed, or outside the limits. */
export type PermissionState = 'fromRole' | 'added' | 'removed' | 'notHeld' | 'outsideLimits';

export function accessDraft(user: {
  role: ConsoleRole;
  grantedPermissions: readonly ConsolePermission[];
  revokedPermissions: readonly ConsolePermission[];
}): AccessDraft {
  return {
    role: user.role,
    held: new Set(
      effectiveConsolePermissions(user.role, user.grantedPermissions, user.revokedPermissions),
    ),
  };
}

/**
 * Another role: the permissions held stay held where the new role may hold them, and the new
 * role's preset is held in full unless it was removed before.
 */
export function withRole(draft: AccessDraft, role: ConsoleRole): AccessDraft {
  const removed = consolePresets[draft.role].filter((permission) => !draft.held.has(permission));
  const held = new Set<ConsolePermission>(
    [...consolePresets[role], ...draft.held].filter(
      (permission) => isWithinConsoleLimit(role, permission) && !removed.includes(permission),
    ),
  );
  return { role, held };
}

export function permissionState(
  draft: AccessDraft,
  permission: ConsolePermission,
): PermissionState {
  if (!isWithinConsoleLimit(draft.role, permission)) return 'outsideLimits';
  const preset = consolePresets[draft.role].includes(permission);
  const held = draft.held.has(permission);
  if (preset) return held ? 'fromRole' : 'removed';
  return held ? 'added' : 'notHeld';
}

/** The role, grants and revocations to send (`updatePlatformUserSchema`). */
export function accessChange(draft: AccessDraft): {
  role: ConsoleRole;
  grantedPermissions: ConsolePermission[];
  revokedPermissions: ConsolePermission[];
} {
  const states = consolePermissions.map(
    (permission) => [permission, permissionState(draft, permission)] as const,
  );
  return {
    role: draft.role,
    grantedPermissions: states.filter(([, state]) => state === 'added').map(([key]) => key),
    revokedPermissions: states.filter(([, state]) => state === 'removed').map(([key]) => key),
  };
}

/** Whether the draft says the same as the user's saved access. */
export function sameAccess(
  draft: AccessDraft,
  user: {
    role: ConsoleRole;
    grantedPermissions: readonly ConsolePermission[];
    revokedPermissions: readonly ConsolePermission[];
  },
): boolean {
  const saved = accessDraft(user);
  return (
    draft.role === saved.role &&
    draft.held.size === saved.held.size &&
    [...draft.held].every((permission) => saved.held.has(permission))
  );
}
