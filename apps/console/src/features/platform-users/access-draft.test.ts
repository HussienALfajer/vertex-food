import {
  assertConsoleAdjustmentsAllowed,
  type ConsolePermission,
  consolePermissions,
  consoleRoles,
  effectiveConsolePermissions,
} from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { accessChange, accessDraft, permissionState, sameAccess, withRole } from './access-draft';

const admin = { role: 'admin' as const, grantedPermissions: [], revokedPermissions: [] };

describe('accessDraft', () => {
  it("holds the role's preset, without the revoked permissions", () => {
    const draft = accessDraft({ ...admin, revokedPermissions: ['console.tenants.status'] });
    expect(permissionState(draft, 'console.tenants.status')).toBe('removed');
    expect(permissionState(draft, 'console.users.manage')).toBe('fromRole');
  });

  it('marks what the role may never hold', () => {
    const draft = accessDraft({ ...admin, role: 'support' });
    expect(permissionState(draft, 'console.accounts.recover')).toBe('fromRole');
    expect(permissionState(draft, 'console.users.manage')).toBe('outsideLimits');
  });
});

describe('accessChange', () => {
  it('sends only adjustments the API accepts, for every role and every choice', () => {
    for (const role of consoleRoles) {
      // Every subset of the catalog, as a person could tick it.
      for (let mask = 0; mask < 2 ** consolePermissions.length; mask += 1) {
        const ticked = consolePermissions.filter((_, index) => mask & (1 << index));
        const held = new Set<ConsolePermission>(ticked);
        const change = accessChange({ role, held });
        expect(() =>
          assertConsoleAdjustmentsAllowed(
            role,
            change.grantedPermissions,
            change.revokedPermissions,
          ),
        ).not.toThrow();
        // What the server computes is what the dialog showed, within the limits.
        expect(
          effectiveConsolePermissions(role, change.grantedPermissions, change.revokedPermissions),
        ).toEqual(
          ticked.filter(
            (permission) => permissionState({ role, held }, permission) !== 'outsideLimits',
          ),
        );
      }
    }
  });
});

describe('withRole', () => {
  it("keeps a removed preset permission removed and drops what the new role can't hold", () => {
    const draft = accessDraft({ ...admin, revokedPermissions: ['console.accounts.recover'] });
    const support = withRole(draft, 'support');
    expect(permissionState(support, 'console.accounts.recover')).toBe('removed');
    // Support's own preset (console.messaging.read, S03; console.agreements.read, S05) stays;
    // admin's other permissions go.
    expect([...support.held].sort()).toEqual(['console.agreements.read', 'console.messaging.read']);
    expect(accessChange(support)).toEqual({
      role: 'support',
      grantedPermissions: [],
      revokedPermissions: ['console.accounts.recover'],
    });
  });

  it("gives the new role's preset in full", () => {
    expect([...withRole(accessDraft({ ...admin, role: 'support' }), 'admin').held].sort()).toEqual(
      [...consolePermissions].sort(),
    );
  });
});

describe('sameAccess', () => {
  it('compares the role and the permissions held', () => {
    const draft = accessDraft(admin);
    expect(sameAccess(draft, admin)).toBe(true);
    expect(sameAccess(withRole(draft, 'sales'), admin)).toBe(false);
    const fewer = new Set(draft.held);
    fewer.delete('console.users.manage');
    expect(sameAccess({ ...draft, held: fewer }, admin)).toBe(false);
  });
});
