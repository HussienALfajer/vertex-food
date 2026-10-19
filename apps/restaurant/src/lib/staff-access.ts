import { type StaffPermission, staffPermissions } from '@vertex-food/contracts';
import { createContext, useContext } from 'react';

/**
 * What the signed-in staff member may do, for hiding what they cannot (cosmetic: the API decides,
 * ADR 0005). `branchIds` is the member's branch scope, `null` for the whole tenant.
 */
export type StaffAccess = {
  permissions: ReadonlySet<StaffPermission>;
  branchIds: readonly string[] | null;
};

/** The owner's access: every permission on every branch. */
export const ownerAccess: StaffAccess = {
  permissions: new Set(staffPermissions),
  branchIds: null,
};

/** Whether the member holds `permission`, on `branchId` when the action is a branch's. */
export function can(access: StaffAccess, permission: StaffPermission, branchId?: string): boolean {
  if (!access.permissions.has(permission)) return false;
  return !branchId || access.branchIds === null || access.branchIds.includes(branchId);
}

/**
 * The signed-in member's access. Sessions arrive with S02, which provides the member's own; until
 * then the app has no session (the API refuses every staff route) and shows the owner's screens.
 */
export const StaffAccessContext = createContext<StaffAccess>(ownerAccess);

export function useStaffAccess(): StaffAccess {
  return useContext(StaffAccessContext);
}
