import { inactiveMemberDecision, type StaffPermission } from '@vertex-food/contracts';
import { membershipAccessSnapshots, type Transaction } from '@vertex-food/db';
import { asc, eq } from 'drizzle-orm';

// A command is checked against the access its member held when it was made (spec S04 rules 8,
// 16, ADR 0035): the membership's access snapshots, appended by every S02 access change, say what
// was in force at the command's effective time and when the member stopped being able to act in
// the branch.

export type AccessSnapshot = {
  status: string;
  allBranches: boolean;
  branchIds: readonly string[];
  permissions: readonly string[];
  effectiveFrom: Date;
};

/** A membership's access snapshots, oldest first. */
export function accessHistory(tx: Transaction, membershipId: string): Promise<AccessSnapshot[]> {
  return tx
    .select({
      status: membershipAccessSnapshots.status,
      allBranches: membershipAccessSnapshots.allBranches,
      branchIds: membershipAccessSnapshots.branchIds,
      permissions: membershipAccessSnapshots.permissions,
      effectiveFrom: membershipAccessSnapshots.effectiveFrom,
    })
    .from(membershipAccessSnapshots)
    .where(eq(membershipAccessSnapshots.membershipId, membershipId))
    .orderBy(asc(membershipAccessSnapshots.effectiveFrom), asc(membershipAccessSnapshots.id));
}

/** The member may act in the branch: active, with the branch in scope (S02 rule 33). */
function activeIn(snapshot: AccessSnapshot, branchId: string): boolean {
  return (
    snapshot.status === 'active' && (snapshot.allBranches || snapshot.branchIds.includes(branchId))
  );
}

/** The index of the snapshot in force at `at`, or -1 before the first. */
function indexAt(history: readonly AccessSnapshot[], at: Date): number {
  let found = -1;
  for (let i = 0; i < history.length; i++) {
    if ((history[i] as AccessSnapshot).effectiveFrom.getTime() > at.getTime()) break;
    found = i;
  }
  return found;
}

/**
 * When the member stopped being able to act in the branch, as seen from `at`: the start of the
 * inactive stretch in force then, or the first change after it that made them inactive; null when
 * neither happened, and `never` when they could never act there before.
 */
function inactiveSince(
  history: readonly AccessSnapshot[],
  index: number,
  branchId: string,
): Date | null | 'never' {
  const current = history[index] as AccessSnapshot;
  if (!activeIn(current, branchId)) {
    let start = index;
    while (start > 0 && !activeIn(history[start - 1] as AccessSnapshot, branchId)) start--;
    return start === 0 ? 'never' : (history[start] as AccessSnapshot).effectiveFrom;
  }
  for (let i = index + 1; i < history.length; i++) {
    const later = history[i] as AccessSnapshot;
    if (!activeIn(later, branchId)) return later.effectiveFrom;
  }
  return null;
}

export type MemberDecision =
  | { kind: 'allowed' }
  | { kind: 'rejected'; reason: 'member_inactive' | 'permission_missing' }
  | { kind: 'quarantine' };

/**
 * Rules 8 and 16 for the member who made a command: the access in force at its effective time
 * decides the permission; a member who stopped being able to act in the branch within 10 minutes
 * of the command, or at any time after a command with an uncertain clock, sends it to the
 * quarantine; one who never could act there is rejected `member_inactive`. A command the owner accepted from the quarantine (`accepted`) is checked against the
 * member's last access in the branch before it, so the owner's decision is not quarantined again.
 */
export function memberDecision(
  history: readonly AccessSnapshot[],
  input: {
    branchId: string;
    permission: StaffPermission;
    effectiveTime: Date;
    clockSuspect: boolean;
    accepted: boolean;
  },
): MemberDecision {
  let index = indexAt(history, input.effectiveTime);
  if (index < 0) return { kind: 'rejected', reason: 'member_inactive' };
  if (input.accepted) {
    while (index >= 0 && !activeIn(history[index] as AccessSnapshot, input.branchId)) index--;
    if (index < 0) return { kind: 'rejected', reason: 'member_inactive' };
  } else {
    const since = inactiveSince(history, index, input.branchId);
    if (since === 'never') return { kind: 'rejected', reason: 'member_inactive' };
    if (
      since &&
      inactiveMemberDecision({
        effectiveTime: input.effectiveTime,
        inactiveSince: since,
        clockSuspect: input.clockSuspect,
      }) === 'quarantine'
    ) {
      return { kind: 'quarantine' };
    }
  }
  const snapshot = history[index] as AccessSnapshot;
  return snapshot.permissions.includes(input.permission)
    ? { kind: 'allowed' }
    : { kind: 'rejected', reason: 'permission_missing' };
}

/** Rule 8 for the approver (S02 rule 27): active in the branch with the permission at the time. */
export function approverAllowed(
  history: readonly AccessSnapshot[],
  input: { branchId: string; permission: StaffPermission; effectiveTime: Date },
): boolean {
  const index = indexAt(history, input.effectiveTime);
  if (index < 0) return false;
  const snapshot = history[index] as AccessSnapshot;
  return activeIn(snapshot, input.branchId) && snapshot.permissions.includes(input.permission);
}
