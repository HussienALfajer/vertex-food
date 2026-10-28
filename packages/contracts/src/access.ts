import { z } from 'zod';
import { DomainError } from './errors.js';

/**
 * Permissions (ADR 0005, spec S02). Each spec defines the permissions of its actions and their
 * preset defaults and limits here. Routes declare one with `@StaffRoute(permission)` or
 * `@ConsoleRoute(permission)`; the server checks them, the UI only hides what a person cannot do.
 * Role presets are code, not rows: a preset change in a later release reaches every member, and
 * their adjustments stay.
 */

// Staff roles and permissions.

export const staffRoles = ['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver'] as const;

export const staffRoleSchema = z.enum(staffRoles).meta({ id: 'StaffRole' });

export type StaffRole = z.infer<typeof staffRoleSchema>;

export const staffPermissions = [
  // S01 tenancy
  'tenant.view',
  'tenant.profile.edit',
  'branch.settings.edit',
  'branch.hours.edit',
  // S02 identity, access and devices
  'branch.security.edit',
  'staff.view',
  'staff.manage',
  'staff.permissions.adjust',
  'devices.manage',
  'backoffice.remote',
  // S04 sync and the branch hub
  'hub.manage',
  'sync.attention.resolve',
  'sync.quarantine.review',
] as const;

export const staffPermissionSchema = z.enum(staffPermissions).meta({ id: 'StaffPermission' });

export type StaffPermission = z.infer<typeof staffPermissionSchema>;

export const permissionGroupSchema = z
  .enum(['tenant', 'branch', 'staff', 'devices', 'sync'])
  .meta({ id: 'PermissionGroup' });

export type PermissionGroup = z.infer<typeof permissionGroupSchema>;

export type PermissionDefinition = {
  group: PermissionGroup;
  /** Applies only in the member's branches (rule 6). */
  branchScoped: boolean;
  /** The roles that may hold it, by preset or by grant (rule 5). */
  limit: readonly StaffRole[];
};

const anyRole = staffRoles;
const ownerManager = ['owner', 'manager'] as const;
const ownerOnly = ['owner'] as const;

export const permissionCatalog: Record<StaffPermission, PermissionDefinition> = {
  'tenant.view': { group: 'tenant', branchScoped: true, limit: anyRole },
  'tenant.profile.edit': { group: 'tenant', branchScoped: false, limit: ownerOnly },
  'branch.settings.edit': { group: 'branch', branchScoped: true, limit: ownerManager },
  'branch.hours.edit': { group: 'branch', branchScoped: true, limit: ownerManager },
  'branch.security.edit': { group: 'branch', branchScoped: true, limit: ownerManager },
  'staff.view': { group: 'staff', branchScoped: true, limit: ownerManager },
  'staff.manage': { group: 'staff', branchScoped: true, limit: ownerManager },
  'staff.permissions.adjust': { group: 'staff', branchScoped: false, limit: ownerOnly },
  'devices.manage': { group: 'devices', branchScoped: true, limit: ownerManager },
  'backoffice.remote': { group: 'devices', branchScoped: false, limit: ownerManager },
  'hub.manage': { group: 'sync', branchScoped: true, limit: ownerManager },
  'sync.attention.resolve': { group: 'sync', branchScoped: true, limit: ownerManager },
  'sync.quarantine.review': { group: 'sync', branchScoped: false, limit: ownerOnly },
};

/** What each role holds without adjustments. */
export const rolePresets: Record<StaffRole, readonly StaffPermission[]> = {
  owner: staffPermissions,
  manager: [
    'tenant.view',
    'branch.hours.edit',
    'branch.security.edit',
    'staff.view',
    'staff.manage',
    'devices.manage',
    'backoffice.remote',
    'hub.manage',
    'sync.attention.resolve',
  ],
  cashier: ['tenant.view'],
  waiter: ['tenant.view'],
  kitchen: ['tenant.view'],
  driver: ['tenant.view'],
};

/** An owner keeps these whatever is stored, so a tenant is never left unmanageable. */
export const ownerLockedPermissions: readonly StaffPermission[] = [
  'tenant.view',
  'tenant.profile.edit',
  'staff.view',
  'staff.manage',
  'staff.permissions.adjust',
  'devices.manage',
  'backoffice.remote',
];

/** The roles a manager may assign, and the only roles of the members they manage (rule 7). */
export const managerAssignableRoles: readonly StaffRole[] = [
  'cashier',
  'waiter',
  'kitchen',
  'driver',
];

/** Whether a member with `roles` may hold `permission` (its limit). */
export function isWithinLimit(roles: readonly StaffRole[], permission: StaffPermission): boolean {
  return permissionCatalog[permission].limit.some((role) => roles.includes(role));
}

/** The permissions a member with `roles` may be granted, in catalog order. */
export function grantablePermissions(roles: readonly StaffRole[]): StaffPermission[] {
  return staffPermissions.filter((permission) => isWithinLimit(roles, permission));
}

/**
 * The permissions a member holds (rule 5): the union of their roles' presets, plus their grants,
 * minus their revocations, filtered by the limits; an owner keeps `ownerLockedPermissions`.
 * Applied on every read, so a member who loses a role loses what only that role allowed at once.
 */
export function effectivePermissions(
  roles: readonly StaffRole[],
  grants: readonly StaffPermission[],
  revokes: readonly StaffPermission[],
): StaffPermission[] {
  const held = new Set<StaffPermission>(roles.flatMap((role) => rolePresets[role]));
  for (const permission of grants) held.add(permission);
  for (const permission of revokes) held.delete(permission);
  if (roles.includes('owner'))
    for (const permission of ownerLockedPermissions) held.add(permission);
  return staffPermissions.filter(
    (permission) => held.has(permission) && isWithinLimit(roles, permission),
  );
}

/**
 * Refuses adjustments the limits do not allow (rule 5, `PERMISSION_NOT_GRANTABLE`): a grant or a
 * revocation of a permission outside the member's limits, a revocation of an owner-locked
 * permission from an owner, or the same permission both granted and revoked.
 */
export function assertAdjustmentsAllowed(
  roles: readonly StaffRole[],
  grants: readonly StaffPermission[],
  revokes: readonly StaffPermission[],
): void {
  for (const permission of [...grants, ...revokes]) {
    if (!isWithinLimit(roles, permission)) {
      throw new DomainError('PERMISSION_NOT_GRANTABLE', `${permission} is outside the limits`, {
        permission,
      });
    }
  }
  if (roles.includes('owner')) {
    const locked = revokes.find((permission) => ownerLockedPermissions.includes(permission));
    if (locked) {
      throw new DomainError(
        'PERMISSION_NOT_GRANTABLE',
        `${locked} cannot be revoked from an owner`,
        {
          permission: locked,
        },
      );
    }
  }
  const both = grants.find((permission) => revokes.includes(permission));
  if (both) {
    throw new DomainError('PERMISSION_NOT_GRANTABLE', `${both} is both granted and revoked`, {
      permission: both,
    });
  }
}

// Console roles and permissions.

export const consoleRoles = ['admin', 'sales', 'dispatch', 'finance', 'support'] as const;

export const consoleRoleSchema = z.enum(consoleRoles).meta({ id: 'ConsoleRole' });

export type ConsoleRole = z.infer<typeof consoleRoleSchema>;

/** Permissions of Vertex staff accounts in the console. */
export const consolePermissions = [
  // S01 tenancy
  'console.tenants.manage',
  'console.tenants.status',
  // S02 identity
  'console.users.manage',
  'console.accounts.recover',
  // S03 messaging
  'console.messaging.read',
  'console.messaging.manage',
] as const;

export const consolePermissionSchema = z.enum(consolePermissions).meta({ id: 'ConsolePermission' });

export type ConsolePermission = z.infer<typeof consolePermissionSchema>;

/** The console roles that may hold each permission. */
export const consolePermissionLimits: Record<ConsolePermission, readonly ConsoleRole[]> = {
  'console.tenants.manage': ['admin', 'sales'],
  'console.tenants.status': ['admin', 'finance'],
  'console.users.manage': ['admin'],
  'console.accounts.recover': ['admin', 'support'],
  'console.messaging.read': ['admin', 'support'],
  'console.messaging.manage': ['admin'],
};

export const consolePresets: Record<ConsoleRole, readonly ConsolePermission[]> = {
  admin: consolePermissions,
  sales: ['console.tenants.manage'],
  dispatch: [],
  finance: ['console.tenants.status'],
  support: ['console.accounts.recover', 'console.messaging.read'],
};

export function isWithinConsoleLimit(role: ConsoleRole, permission: ConsolePermission): boolean {
  return consolePermissionLimits[permission].includes(role);
}

/** The console permissions of a platform user: preset + grants − revocations, within the limits. */
export function effectiveConsolePermissions(
  role: ConsoleRole,
  grants: readonly ConsolePermission[],
  revokes: readonly ConsolePermission[],
): ConsolePermission[] {
  const held = new Set<ConsolePermission>([...consolePresets[role], ...grants]);
  for (const permission of revokes) held.delete(permission);
  return consolePermissions.filter(
    (permission) => held.has(permission) && isWithinConsoleLimit(role, permission),
  );
}

/** Refuses console adjustments outside the limits (rule 42, `PERMISSION_NOT_GRANTABLE`). */
export function assertConsoleAdjustmentsAllowed(
  role: ConsoleRole,
  grants: readonly ConsolePermission[],
  revokes: readonly ConsolePermission[],
): void {
  for (const permission of [...grants, ...revokes]) {
    if (!isWithinConsoleLimit(role, permission)) {
      throw new DomainError('PERMISSION_NOT_GRANTABLE', `${permission} is outside the limits`, {
        permission,
      });
    }
  }
  const both = grants.find((permission) => revokes.includes(permission));
  if (both) {
    throw new DomainError('PERMISSION_NOT_GRANTABLE', `${both} is both granted and revoked`, {
      permission: both,
    });
  }
}
