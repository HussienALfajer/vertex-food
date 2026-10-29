import { describe, expect, it } from 'vitest';
import {
  assertAdjustmentsAllowed,
  assertConsoleAdjustmentsAllowed,
  type ConsolePermission,
  type ConsoleRole,
  consolePermissions,
  consoleRoles,
  effectiveConsolePermissions,
  effectivePermissions,
  grantablePermissions,
  isWithinLimit,
  managerAssignableRoles,
  ownerLockedPermissions,
  permissionCatalog,
  type StaffPermission,
  type StaffRole,
  staffPermissions,
  staffRoles,
} from './access.js';
import { DomainError } from './errors.js';

// The two tables of spec S02 ("Permission catalog and role presets", "Console permissions and
// presets") and spec S04's and S05's permissions ("Access and entitlements"), written out so a change to either is a visible change to this test.

const presetTable: Record<StaffPermission, { roles: StaffRole[]; limit: StaffRole[] }> = {
  'tenant.view': {
    roles: ['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver'],
    limit: [...staffRoles],
  },
  'tenant.profile.edit': { roles: ['owner'], limit: ['owner'] },
  'branch.settings.edit': { roles: ['owner'], limit: ['owner', 'manager'] },
  'branch.hours.edit': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'branch.security.edit': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'staff.view': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'staff.manage': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'staff.permissions.adjust': { roles: ['owner'], limit: ['owner'] },
  'devices.manage': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'backoffice.remote': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  // S04
  'hub.manage': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'sync.attention.resolve': { roles: ['owner', 'manager'], limit: ['owner', 'manager'] },
  'sync.quarantine.review': { roles: ['owner'], limit: ['owner'] },
  // S05
  'agreement.view': { roles: ['owner'], limit: ['owner'] },
};

const branchScoped: StaffPermission[] = [
  'tenant.view',
  'branch.settings.edit',
  'branch.hours.edit',
  'branch.security.edit',
  'staff.view',
  'staff.manage',
  'devices.manage',
  'hub.manage',
  'sync.attention.resolve',
];

const consoleTable: Record<ConsolePermission, ConsoleRole[]> = {
  'console.tenants.manage': ['admin', 'sales'],
  'console.tenants.status': ['admin', 'finance'],
  'console.users.manage': ['admin'],
  'console.accounts.recover': ['admin', 'support'],
  'console.messaging.read': ['admin', 'support'],
  'console.messaging.manage': ['admin'],
  // S05
  'console.agreements.read': ['admin', 'sales', 'finance', 'support'],
  'console.agreements.draft': ['admin', 'sales'],
  'console.agreements.approve': ['admin', 'finance'],
  'console.entitlements.override': ['admin', 'finance'],
  'console.catalog.manage': ['admin'],
};

function refusedCode(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('staff permission catalog', () => {
  it('describes every permission, with its scope and limit', () => {
    expect(Object.keys(permissionCatalog).sort()).toEqual([...staffPermissions].sort());
    for (const permission of staffPermissions) {
      expect(permissionCatalog[permission].branchScoped).toBe(branchScoped.includes(permission));
      expect([...permissionCatalog[permission].limit].sort()).toEqual(
        [...presetTable[permission].limit].sort(),
      );
    }
  });

  it('gives each role its preset', () => {
    for (const role of staffRoles) {
      const expected = staffPermissions.filter((p) => presetTable[p].roles.includes(role));
      expect(effectivePermissions([role], [], [])).toEqual(expected);
    }
  });

  it('keeps every preset within the limits', () => {
    for (const permission of staffPermissions) {
      for (const role of presetTable[permission].roles) {
        expect(isWithinLimit([role], permission)).toBe(true);
      }
    }
  });
});

describe('effectivePermissions', () => {
  it('is the union of the roles plus grants minus revocations', () => {
    expect(effectivePermissions(['cashier', 'kitchen'], [], [])).toEqual(['tenant.view']);
    expect(effectivePermissions(['manager'], ['branch.settings.edit'], ['devices.manage'])).toEqual(
      [
        'tenant.view',
        'branch.settings.edit',
        'branch.hours.edit',
        'branch.security.edit',
        'staff.view',
        'staff.manage',
        'backoffice.remote',
        'hub.manage',
        'sync.attention.resolve',
      ],
    );
  });

  it('drops grants outside the limits, so a demoted manager loses them at once', () => {
    expect(effectivePermissions(['cashier'], ['branch.settings.edit', 'staff.view'], [])).toEqual([
      'tenant.view',
    ]);
  });

  it('keeps the owner-locked permissions of an owner whatever is stored', () => {
    const held = effectivePermissions(['owner'], [], [...ownerLockedPermissions]);
    for (const permission of ownerLockedPermissions) expect(held).toContain(permission);
    expect(effectivePermissions(['owner'], [], ['branch.hours.edit'])).not.toContain(
      'branch.hours.edit',
    );
  });

  it('answers in catalog order without duplicates', () => {
    const held = effectivePermissions(['owner', 'manager'], ['staff.view'], []);
    expect(held).toEqual([...staffPermissions]);
  });
});

describe('grantablePermissions and adjustments', () => {
  it('offers only what the limits allow', () => {
    expect(grantablePermissions(['cashier'])).toEqual(['tenant.view']);
    expect(grantablePermissions(['manager'])).not.toContain('tenant.profile.edit');
    expect(grantablePermissions(['manager'])).not.toContain('staff.permissions.adjust');
    expect(grantablePermissions(['owner'])).toEqual([...staffPermissions]);
  });

  it('refuses grants and revocations outside the limits', () => {
    expect(refusedCode(() => assertAdjustmentsAllowed(['cashier'], ['staff.manage'], []))).toBe(
      'PERMISSION_NOT_GRANTABLE',
    );
    expect(
      refusedCode(() => assertAdjustmentsAllowed(['manager'], ['tenant.profile.edit'], [])),
    ).toBe('PERMISSION_NOT_GRANTABLE');
    expect(refusedCode(() => assertAdjustmentsAllowed(['waiter'], [], ['staff.view']))).toBe(
      'PERMISSION_NOT_GRANTABLE',
    );
    expect(
      refusedCode(() => assertAdjustmentsAllowed(['manager'], ['branch.settings.edit'], [])),
    ).toBe(undefined);
  });

  it('refuses revoking an owner-locked permission from an owner', () => {
    for (const permission of ownerLockedPermissions) {
      expect(refusedCode(() => assertAdjustmentsAllowed(['owner'], [], [permission]))).toBe(
        'PERMISSION_NOT_GRANTABLE',
      );
    }
    expect(refusedCode(() => assertAdjustmentsAllowed(['owner'], [], ['branch.hours.edit']))).toBe(
      undefined,
    );
  });

  it('refuses a permission both granted and revoked', () => {
    expect(
      refusedCode(() =>
        assertAdjustmentsAllowed(['manager'], ['branch.settings.edit'], ['branch.settings.edit']),
      ),
    ).toBe('PERMISSION_NOT_GRANTABLE');
  });

  it('lets managers assign only the floor roles', () => {
    expect([...managerAssignableRoles].sort()).toEqual(['cashier', 'driver', 'kitchen', 'waiter']);
  });
});

describe('console permissions', () => {
  it('follow the console table for every role', () => {
    for (const role of consoleRoles) {
      const expected = consolePermissions.filter((p) => consoleTable[p].includes(role));
      expect(effectiveConsolePermissions(role, [], [])).toEqual(expected);
    }
  });

  it('apply grants and revocations within the limits only', () => {
    expect(effectiveConsolePermissions('sales', ['console.tenants.status'], [])).toEqual([
      'console.tenants.manage',
      'console.agreements.read',
      'console.agreements.draft',
    ]);
    expect(effectiveConsolePermissions('admin', [], ['console.tenants.status'])).toEqual([
      'console.tenants.manage',
      'console.users.manage',
      'console.accounts.recover',
      'console.messaging.read',
      'console.messaging.manage',
      'console.agreements.read',
      'console.agreements.draft',
      'console.agreements.approve',
      'console.entitlements.override',
      'console.catalog.manage',
    ]);
    expect(effectiveConsolePermissions('dispatch', [], [])).toEqual([]);
  });

  it('refuse adjustments outside the limits', () => {
    expect(
      refusedCode(() => assertConsoleAdjustmentsAllowed('sales', ['console.users.manage'], [])),
    ).toBe('PERMISSION_NOT_GRANTABLE');
    expect(
      refusedCode(() => assertConsoleAdjustmentsAllowed('admin', [], ['console.accounts.recover'])),
    ).toBe(undefined);
    expect(
      refusedCode(() =>
        assertConsoleAdjustmentsAllowed(
          'admin',
          ['console.accounts.recover'],
          ['console.accounts.recover'],
        ),
      ),
    ).toBe('PERMISSION_NOT_GRANTABLE');
  });
});
