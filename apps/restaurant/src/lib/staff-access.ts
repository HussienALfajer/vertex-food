import { type Me, type StaffPermission, staffPermissions } from '@vertex-food/contracts';
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

/** Nothing: no session. */
export const noAccess: StaffAccess = { permissions: new Set(), branchIds: [] };

/** The access `GET /api/me` answers for the session. */
export function accessOfMe(me: Me): StaffAccess {
  return {
    permissions: new Set(me.permissions),
    branchIds: me.allBranches ? null : me.branchIds,
  };
}

/** Whether the member holds `permission`, on `branchId` when the action is a branch's. */
export function can(access: StaffAccess, permission: StaffPermission, branchId?: string): boolean {
  if (!access.permissions.has(permission)) return false;
  return !branchId || access.branchIds === null || access.branchIds.includes(branchId);
}

/** The signed-in member's access, provided by the session gate (`features/session/`). */
export const StaffAccessContext = createContext<StaffAccess>(noAccess);

export function useStaffAccess(): StaffAccess {
  return useContext(StaffAccessContext);
}
