import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  addStaffMemberSchema,
  assertMembershipShape,
  assignableRoles,
  type MemberReach,
  mayManageMember,
  reachOf,
} from './staff.js';

const branchA = '0192c3a0-0000-7000-8000-00000000000a';
const branchB = '0192c3a0-0000-7000-8000-00000000000b';

const owner: MemberReach = { roles: ['owner'], allBranches: true, branchIds: [] };
const managerA: MemberReach = { roles: ['manager'], allBranches: false, branchIds: [branchA] };
const managerAll: MemberReach = { roles: ['manager'], allBranches: true, branchIds: [] };

describe('mayManageMember (rule 7)', () => {
  it('lets an owner manage anyone', () => {
    expect(mayManageMember(owner, owner)).toBe(true);
    expect(mayManageMember(owner, managerA)).toBe(true);
  });

  it('lets a manager manage floor staff of their branches only', () => {
    const cashierA = {
      roles: ['cashier', 'waiter'],
      allBranches: false,
      branchIds: [branchA],
    } as const;
    const cashierAB = { ...cashierA, branchIds: [branchA, branchB] };
    const cashierAll = { roles: ['cashier'], allBranches: true, branchIds: [] } as const;
    expect(mayManageMember(managerA, cashierA)).toBe(true);
    expect(mayManageMember(managerA, cashierAB)).toBe(false);
    expect(mayManageMember(managerA, cashierAll)).toBe(false);
    expect(mayManageMember(managerAll, cashierAB)).toBe(true);
    expect(mayManageMember(managerAll, cashierAll)).toBe(true);
  });

  it('never lets a manager manage a manager or an owner', () => {
    expect(mayManageMember(managerA, managerA)).toBe(false);
    expect(mayManageMember(managerAll, owner)).toBe(false);
    expect(
      mayManageMember(managerA, {
        roles: ['cashier', 'manager'],
        allBranches: false,
        branchIds: [branchA],
      }),
    ).toBe(false);
  });

  it('gives other roles no reach', () => {
    const cashier = { roles: ['cashier'], allBranches: false, branchIds: [branchA] } as const;
    expect(mayManageMember(cashier, cashier)).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('is every role for owners, the floor roles for managers, nothing otherwise', () => {
    expect(assignableRoles(['owner'])).toHaveLength(6);
    expect(assignableRoles(['manager', 'cashier']).sort()).toEqual([
      'cashier',
      'driver',
      'kitchen',
      'waiter',
    ]);
    expect(assignableRoles(['cashier'])).toEqual([]);
  });
});

describe('membership shape', () => {
  it('requires owners to hold every branch', () => {
    expect(() =>
      assertMembershipShape(['owner'], { allBranches: false, branchIds: [branchA] }),
    ).toThrow(DomainError);
    expect(() => assertMembershipShape(['owner'], { allBranches: true })).not.toThrow();
    expect(() => assertMembershipShape(['manager'], { allBranches: true })).not.toThrow();
  });

  it('maps a scope to the stored reach', () => {
    expect(reachOf(['cashier'], { allBranches: true })).toEqual({
      roles: ['cashier'],
      allBranches: true,
      branchIds: [],
    });
  });

  it('accepts a new member with distinct roles and a branch, in E.164', () => {
    const parsed = addStaffMemberSchema.parse({
      phone: '0944 123 456',
      displayName: ' أحمد ',
      roles: ['cashier'],
      branchScope: { allBranches: false, branchIds: [branchA] },
    });
    expect(parsed).toMatchObject({
      phone: '+963944123456',
      displayName: 'أحمد',
      grantedPermissions: [],
      revokedPermissions: [],
    });
    expect(
      addStaffMemberSchema.safeParse({ ...parsed, roles: ['cashier', 'cashier'] }).success,
    ).toBe(false);
    expect(addStaffMemberSchema.safeParse({ ...parsed, roles: [] }).success).toBe(false);
    expect(
      addStaffMemberSchema.safeParse({
        ...parsed,
        branchScope: { allBranches: false, branchIds: [] },
      }).success,
    ).toBe(false);
  });
});
