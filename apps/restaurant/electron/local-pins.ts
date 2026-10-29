import {
  approverCandidates,
  type DeviceMember,
  mayManageMember,
  mayOpenOfflineSession,
  type OfflineWindow,
  offlineWindow,
  pinPolicy,
  type StaffPermission,
} from '@vertex-food/contracts';
import type { DeviceRecord, LocalMember } from './device-store.js';

type Registered = Extract<DeviceRecord, { state: 'registered' }>;

/** Checks a PIN against an Argon2id verifier (`hash-wasm` in the app, any in tests). */
export type VerifyPin = (pin: string, verifier: string) => Promise<boolean>;

/** Why a PIN typed on this PC was refused offline (rules 25, 30). */
export type LocalRefusal =
  | 'INVALID_PIN'
  | 'PIN_DISABLED'
  | 'OFFLINE_WINDOW_EXPIRED'
  | 'MEMBERSHIP_INACTIVE'
  | 'APPROVER_NOT_ALLOWED'
  | 'FORBIDDEN';

export type LocalOutcome = { record: Registered } & (
  | { ok: true }
  | { ok: false; code: LocalRefusal }
);

const fresh: LocalMember = { failures: 0, disabled: false, firstSessionAt: null };

export function localMember(record: Registered, membershipId: string): LocalMember {
  return record.local[membershipId] ?? fresh;
}

/** The offline window at `now` (rules 30, 31). */
export function windowOf(record: Registered, now: Date): OfflineWindow {
  return offlineWindow({
    membersSyncedAt: new Date(record.membersSyncedAt),
    deviceNow: now,
    highestSeenAt: new Date(record.highestSeenAt),
  });
}

/** Keeps the later of the highest time seen and `seen` (rule 31). */
export function seeTime(record: Registered, seen: Date): Registered {
  return seen.getTime() > Date.parse(record.highestSeenAt)
    ? { ...record, highestSeenAt: seen.toISOString() }
    : record;
}

function withMember(record: Registered, membershipId: string, change: Partial<LocalMember>) {
  return {
    ...record,
    local: { ...record.local, [membershipId]: { ...localMember(record, membershipId), ...change } },
  };
}

/** Whether the member's PIN is refused on this PC: disabled online (rule 24) or here (rule 25). */
export function pinDisabledHere(record: Registered, member: DeviceMember): boolean {
  return member.pinDisabled || localMember(record, member.membershipId).disabled;
}

/** A wrong PIN on this PC: the fifth in a row disables the member's PIN here (rule 25). */
export function countFailure(record: Registered, membershipId: string): Registered {
  const failures = localMember(record, membershipId).failures + 1;
  return withMember(record, membershipId, {
    failures,
    disabled: failures >= pinPolicy.maxLocalFailures,
  });
}

/** A PIN session opened on this PC, online or offline: the failures start again (rules 25, 30). */
export function recordSession(record: Registered, membershipId: string, now: Date): Registered {
  const first = localMember(record, membershipId).firstSessionAt;
  return withMember(record, membershipId, {
    failures: 0,
    firstSessionAt: first ?? now.toISOString(),
  });
}

/**
 * Rule 22: an owner or manager replaced their forgotten PIN by password; the lockout of the old
 * one on this PC goes with it.
 */
export function clearLocalLockout(record: Registered, membershipId: string): Registered {
  return withMember(record, membershipId, { failures: 0, disabled: false });
}

/** Verifies `pin` for `member`, counting a wrong one toward rule 25. */
async function verifyCounted(
  record: Registered,
  member: DeviceMember,
  pin: string,
  verify: VerifyPin,
): Promise<LocalOutcome> {
  if (!member.pinVerifier) return { record, ok: false, code: 'MEMBERSHIP_INACTIVE' };
  if (pinDisabledHere(record, member)) return { record, ok: false, code: 'PIN_DISABLED' };
  if (await verify(pin, member.pinVerifier)) {
    return { record: withMember(record, member.membershipId, { failures: 0 }), ok: true };
  }
  const counted = countFailure(record, member.membershipId);
  const disabled = localMember(counted, member.membershipId).disabled;
  return { record: counted, ok: false, code: disabled ? 'PIN_DISABLED' : 'INVALID_PIN' };
}

function findMember(record: Registered, membershipId: string): DeviceMember | undefined {
  return record.memberList.members.find((member) => member.membershipId === membershipId);
}

/**
 * A member's PIN typed on this PC for an action that opens no session (spec S04 rule 27: making
 * the standby the hub), with the lockout of rule 25.
 */
export async function checkPinLocally(
  record: Registered,
  membershipId: string,
  pin: string,
  verify: VerifyPin,
): Promise<LocalOutcome> {
  const member = findMember(record, membershipId);
  if (!member) return { record, ok: false, code: 'MEMBERSHIP_INACTIVE' };
  return verifyCounted(record, member, pin, verify);
}

/**
 * A PIN session opened offline (rules 25, 30, 31), checked in the main process against the
 * verifier in the member list. After the window only members who opened a session on this PC
 * before it closed may sign in.
 */
export async function signInOffline(
  record: Registered,
  membershipId: string,
  pin: string,
  now: Date,
  verify: VerifyPin,
): Promise<LocalOutcome> {
  const seen = seeTime(record, now);
  const member = findMember(seen, membershipId);
  if (!member) return { record: seen, ok: false, code: 'MEMBERSHIP_INACTIVE' };
  const window = windowOf(seen, now);
  const firstSessionAt = localMember(seen, membershipId).firstSessionAt;
  if (!mayOpenOfflineSession(window, firstSessionAt ? new Date(firstSessionAt) : null)) {
    return { record: seen, ok: false, code: 'OFFLINE_WINDOW_EXPIRED' };
  }
  const checked = await verifyCounted(seen, member, pin, verify);
  return checked.ok
    ? { ...checked, record: recordSession(checked.record, membershipId, now) }
    : checked;
}

/**
 * Manager approval (rule 27): another member of the branch holding `permission` types their PIN
 * on this PC, offline too. Wrong PINs count toward the approver's rule 25.
 */
export async function approveLocally(
  record: Registered,
  input: { permission: StaffPermission; actingMembershipId: string; approverMembershipId: string },
  pin: string,
  verify: VerifyPin,
): Promise<LocalOutcome> {
  const candidates = approverCandidates(
    record.memberList.members,
    input.permission,
    input.actingMembershipId,
  );
  const approver = candidates.find((member) => member.membershipId === input.approverMembershipId);
  if (!approver) return { record, ok: false, code: 'APPROVER_NOT_ALLOWED' };
  return verifyCounted(record, approver, pin, verify);
}

/**
 * Re-enables a PIN disabled on this PC (rule 25), never one disabled online (rule 24): a member of the branch who may manage the member
 * (rule 7, `staff.manage`) types their own PIN. On a PC both are members of its branch, so rule 7
 * compares their roles; the server checks the branches again when the audit arrives (S04).
 */
export async function reenableLocally(
  record: Registered,
  input: { membershipId: string; managerMembershipId: string },
  pin: string,
  verify: VerifyPin,
): Promise<LocalOutcome> {
  const target = findMember(record, input.membershipId);
  const manager = findMember(record, input.managerMembershipId);
  if (!target || !manager) return { record, ok: false, code: 'MEMBERSHIP_INACTIVE' };
  // Disabled online (rule 24): only a PIN reset online brings it back, never this PC.
  if (target.pinDisabled) return { record, ok: false, code: 'PIN_DISABLED' };
  const branch = { allBranches: false, branchIds: [record.registration.branchId] };
  const allowed =
    manager.membershipId !== target.membershipId &&
    manager.permissions.includes('staff.manage') &&
    mayManageMember({ roles: manager.roles, ...branch }, { roles: target.roles, ...branch });
  if (!allowed) return { record, ok: false, code: 'FORBIDDEN' };
  const checked = await verifyCounted(record, manager, pin, verify);
  if (!checked.ok) return checked;
  return {
    ok: true,
    record: withMember(checked.record, target.membershipId, { failures: 0, disabled: false }),
  };
}
