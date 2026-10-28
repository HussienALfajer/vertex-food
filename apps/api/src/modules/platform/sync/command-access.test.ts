import { describe, expect, it } from 'vitest';
import { type AccessSnapshot, approverAllowed, memberDecision } from './command-access.js';

// Spec S04 rules 8 and 16 on a membership's access history: what was in force at the command's
// effective time, and how close to the member's deactivation it was made.

const MAIN = '01960000-0000-7000-8000-00000000000a';
const EAST = '01960000-0000-7000-8000-00000000000b';
const MINUTE = 60_000;
const t0 = new Date('2026-10-28T08:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * MINUTE);

const snapshot = (minutes: number, fields: Partial<AccessSnapshot> = {}): AccessSnapshot => ({
  status: 'active',
  allBranches: false,
  branchIds: [MAIN],
  permissions: ['tenant.view', 'hub.manage'],
  effectiveFrom: at(minutes),
  ...fields,
});

const decide = (
  history: AccessSnapshot[],
  minutes: number,
  options: { clockSuspect?: boolean; accepted?: boolean; branchId?: string } = {},
) =>
  memberDecision(history, {
    branchId: options.branchId ?? MAIN,
    permission: 'hub.manage',
    effectiveTime: at(minutes),
    clockSuspect: options.clockSuspect ?? false,
    accepted: options.accepted ?? false,
  });

describe('memberDecision (rules 8, 16)', () => {
  const deactivatedAt60 = [snapshot(0), snapshot(60, { status: 'deactivated' })];

  it('allows an active member with the permission, and rejects one without it', () => {
    expect(decide([snapshot(0)], 30)).toEqual({ kind: 'allowed' });
    expect(decide([snapshot(0, { permissions: ['tenant.view'] })], 30)).toEqual({
      kind: 'rejected',
      reason: 'permission_missing',
    });
  });

  it('rejects a command from before the membership existed', () => {
    expect(decide([snapshot(0)], -1)).toEqual({ kind: 'rejected', reason: 'member_inactive' });
  });

  it('runs a command made more than 10 minutes before a deactivation, else quarantines it', () => {
    expect(decide(deactivatedAt60, 49)).toEqual({ kind: 'allowed' });
    expect(decide(deactivatedAt60, 50)).toEqual({ kind: 'quarantine' });
    expect(decide(deactivatedAt60, 55)).toEqual({ kind: 'quarantine' });
    expect(decide(deactivatedAt60, 90)).toEqual({ kind: 'quarantine' });
  });

  it('quarantines a clock-suspect command of a member deactivated at any time after it', () => {
    expect(decide(deactivatedAt60, 10, { clockSuspect: true })).toEqual({ kind: 'quarantine' });
    expect(decide([snapshot(0)], 10, { clockSuspect: true })).toEqual({ kind: 'allowed' });
  });

  it('counts losing the branch as becoming inactive there (S02 rule 33)', () => {
    const moved = [snapshot(0), snapshot(60, { branchIds: [EAST] })];
    expect(decide(moved, 55)).toEqual({ kind: 'quarantine' });
    expect(decide(moved, 55, { branchId: EAST })).toEqual({
      kind: 'rejected',
      reason: 'member_inactive',
    });
  });

  it('measures from the start of the inactive stretch, and runs after a reactivation', () => {
    const history = [
      snapshot(0),
      snapshot(60, { status: 'deactivated' }),
      snapshot(70, { status: 'deactivated', permissions: [] }),
      snapshot(120),
    ];
    expect(decide(history, 75)).toEqual({ kind: 'quarantine' });
    expect(decide(history, 130)).toEqual({ kind: 'allowed' });
  });

  it('checks an accepted quarantined command against the member’s last access in the branch', () => {
    expect(decide(deactivatedAt60, 55, { accepted: true })).toEqual({ kind: 'allowed' });
    expect(decide(deactivatedAt60, 90, { accepted: true })).toEqual({ kind: 'allowed' });
    const never = [snapshot(0, { status: 'deactivated' })];
    expect(decide(never, 5, { accepted: true })).toEqual({
      kind: 'rejected',
      reason: 'member_inactive',
    });
  });
});

describe('approverAllowed (rule 8, S02 rule 27)', () => {
  it('needs the approver active in the branch with the permission at the time', () => {
    const history = [snapshot(0), snapshot(60, { status: 'deactivated' })];
    const input = { branchId: MAIN, permission: 'hub.manage' as const };
    expect(approverAllowed(history, { ...input, effectiveTime: at(30) })).toBe(true);
    expect(approverAllowed(history, { ...input, effectiveTime: at(61) })).toBe(false);
    expect(approverAllowed(history, { ...input, effectiveTime: at(-1) })).toBe(false);
    expect(
      approverAllowed(history, { ...input, permission: 'staff.manage', effectiveTime: at(30) }),
    ).toBe(false);
  });
});
