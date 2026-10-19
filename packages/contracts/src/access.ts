import { z } from 'zod';

/**
 * Permissions (ADR 0005). Each spec defines the permissions of its actions; S02 maps them to the
 * role presets (owner, manager, cashier, waiter, kitchen, driver) and to Vertex staff accounts.
 * Routes declare one with `@StaffRoute(permission)` or `@ConsoleRoute(permission)`; the server
 * checks them, the UI only hides what a person cannot do.
 */
export const staffPermissions = [
  // S01 tenancy
  'tenant.view',
  'tenant.profile.edit',
  'branch.settings.edit',
  'branch.hours.edit',
] as const;

export const staffPermissionSchema = z.enum(staffPermissions).meta({ id: 'StaffPermission' });

export type StaffPermission = z.infer<typeof staffPermissionSchema>;

/** Permissions of Vertex staff accounts in the console (S02 adds the accounts, with TOTP). */
export const consolePermissions = [
  // S01 tenancy
  'console.tenants.manage',
  'console.tenants.status',
] as const;

export const consolePermissionSchema = z.enum(consolePermissions).meta({ id: 'ConsolePermission' });

export type ConsolePermission = z.infer<typeof consolePermissionSchema>;
