import { describe, expect, it } from 'vitest';
import {
  type AccessDraft,
  accessErrors,
  emptyAccess,
  heldPermissions,
  lockedReason,
  permissionSource,
  prunedAdjustments,
  scopeOf,
  withBranch,
  withPermission,
  withRole,
} from './access-draft';

const manager: AccessDraft = { ...emptyAccess, roles: ['manager'], branchIds: ['b1'] };

describe('access draft (spec S02 screen 10)', () => {
  it('keeps roles in catalog order and gives owners every branch (rule 4)', () => {
    const draft = withRole(withRole(manager, 'cashier', true), 'owner', true);
    expect(draft.roles).toEqual(['owner', 'manager', 'cashier']);
    expect(scopeOf(draft)).toEqual({ allBranches: true });
    expect(withRole(draft, 'manager', false).roles).toEqual(['owner', 'cashier']);
  });

  it('adds and removes branches without duplicates', () => {
    const draft = withBranch(withBranch(manager, 'b2', true), 'b2', true);
    expect(draft.branchIds).toEqual(['b1', 'b2']);
    expect(scopeOf(withBranch(draft, 'b1', false))).toEqual({
      allBranches: false,
      branchIds: ['b2'],
    });
  });

  it('records an adjustment only where the role presets differ', () => {
    const removed = withPermission(manager, 'devices.manage', false);
    expect(removed.revoked).toEqual(['devices.manage']);
    expect(permissionSource(removed, 'devices.manage')).toBe('removed');
    expect(heldPermissions(removed)).not.toContain('devices.manage');
    // Turned back on: the preset again, no grant.
    const back = withPermission(removed, 'devices.manage', true);
    expect(back).toMatchObject({ granted: [], revoked: [] });
    expect(permissionSource(back, 'devices.manage')).toBe('role');

    const added = withPermission(manager, 'branch.settings.edit', true);
    expect(added.granted).toEqual(['branch.settings.edit']);
    expect(permissionSource(added, 'branch.settings.edit')).toBe('added');
    expect(withPermission(added, 'branch.settings.edit', false).granted).toEqual([]);
  });

  it('locks permissions outside the limits and those every owner keeps (rule 5)', () => {
    const cashier: AccessDraft = { ...emptyAccess, roles: ['cashier'], branchIds: ['b1'] };
    expect(lockedReason(cashier, 'staff.view')).toBe('outsideLimits');
    expect(lockedReason(cashier, 'tenant.view')).toBeNull();
    expect(lockedReason(manager, 'tenant.profile.edit')).toBe('outsideLimits');
    const owner = withRole(manager, 'owner', true);
    expect(lockedReason(owner, 'staff.manage')).toBe('ownerLocked');
    expect(lockedReason(owner, 'branch.security.edit')).toBeNull();
    expect(lockedReason(emptyAccess, 'tenant.view')).toBe('outsideLimits');
  });

  it('drops adjustments a role change no longer allows', () => {
    const adjusted = withPermission(
      withPermission(manager, 'branch.settings.edit', true),
      'staff.manage',
      false,
    );
    const demoted = withRole(withRole(adjusted, 'manager', false), 'cashier', true);
    expect(prunedAdjustments(demoted)).toEqual({ granted: [], revoked: [] });
    const promoted = withRole(adjusted, 'owner', true);
    // The owner preset holds both, and an owner keeps `staff.manage`.
    expect(prunedAdjustments(promoted)).toEqual({ granted: [], revoked: [] });
    expect(prunedAdjustments(adjusted)).toEqual({
      granted: ['branch.settings.edit'],
      revoked: ['staff.manage'],
    });
  });

  it('needs a role and a branch (rule 1, edge case 5)', () => {
    expect(accessErrors(emptyAccess)).toEqual({ roles: 'required', branches: 'required' });
    expect(accessErrors(manager)).toEqual({});
    expect(accessErrors(withBranch(manager, 'b1', false))).toEqual({ branches: 'required' });
  });
});
