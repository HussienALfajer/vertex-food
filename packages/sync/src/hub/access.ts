import type {
  CommandActor,
  CommandOriginKind,
  DeviceMember,
  HubCommand,
  HubRefusalReason,
} from '@vertex-food/contracts';
import type { CommandAccess } from '../registry.js';

// The hub's local access check (spec S04 rules 5, 6, 35, 36): before journaling a command, the hub
// checks its actor against the member list and the pairing it came from. The server checks again
// against the access snapshot in force at the command's time (rule 8); this check only keeps a
// command the branch would refuse from being run on the LAN.

/** Who sent a command, as the hub's LAN server authenticated the request. */
export type CommandSource =
  /** The hub PC's own screens, or a client PC by mutual TLS: it names its member or itself. */
  | { kind: 'pc'; deviceId: string }
  | { kind: 'station'; pairingId: string }
  /** A personal pairing, with the member of its active PIN session, or null without one. */
  | { kind: 'personal'; pairingId: string; membershipId: string | null };

export type AccessDecision =
  | {
      ok: true;
      actor: CommandActor;
      originKind: CommandOriginKind;
      originDeviceId: string;
      approvedByMembershipId: string | null;
    }
  | { ok: false; reason: HubRefusalReason };

function refuse(reason: HubRefusalReason): AccessDecision {
  return { ok: false, reason };
}

function holds(member: DeviceMember | null, permission: string): boolean {
  return member !== null && (member.permissions as readonly string[]).includes(permission);
}

export function checkLocalAccess(input: {
  access: CommandAccess;
  source: CommandSource;
  command: Pick<HubCommand, 'actor' | 'approvedByMembershipId'>;
  member: (membershipId: string) => DeviceMember | null;
}): AccessDecision {
  const { access, source, command } = input;

  if (source.kind === 'station') {
    // A station acts as itself; it may run only the commands that allow it (S11).
    if (access.actor === 'member' && access.station) {
      return {
        ok: true,
        actor: { kind: 'station', pairingId: source.pairingId },
        originKind: 'hub_client',
        originDeviceId: source.pairingId,
        approvedByMembershipId: null,
      };
    }
    return refuse('station_not_allowed');
  }

  let actor: CommandActor;
  let originKind: CommandOriginKind;
  let originDeviceId: string;
  if (source.kind === 'personal') {
    // Only a PC, by mutual TLS, may send its own device commands (PR 1's review).
    if (command.actor && command.actor.kind !== 'member') return refuse('permission_missing');
    if (source.membershipId === null) return refuse('pin_session_ended');
    actor = { kind: 'member', membershipId: source.membershipId, sessionKind: 'hub_client' };
    originKind = 'hub_client';
    originDeviceId = source.pairingId;
  } else {
    if (!command.actor) return refuse('permission_missing');
    if (command.actor.kind === 'station') return refuse('station_not_allowed');
    if (command.actor.kind === 'member' && command.actor.sessionKind !== 'pc') {
      return refuse('permission_missing');
    }
    actor = command.actor;
    originKind = 'pc';
    originDeviceId = source.deviceId;
  }

  if (access.actor === 'device') {
    return actor.kind === 'device'
      ? { ok: true, actor, originKind, originDeviceId, approvedByMembershipId: null }
      : refuse('permission_missing');
  }
  if (actor.kind !== 'member') return refuse('permission_missing');
  if (!holds(input.member(actor.membershipId), access.permission)) {
    return refuse('permission_missing');
  }
  if (!access.approval) {
    return { ok: true, actor, originKind, originDeviceId, approvedByMembershipId: null };
  }
  // Another member's PIN approval (S02 rule 27).
  const approver = command.approvedByMembershipId ?? null;
  if (approver === null || approver === actor.membershipId) return refuse('permission_missing');
  if (!holds(input.member(approver), access.approval)) return refuse('permission_missing');
  return { ok: true, actor, originKind, originDeviceId, approvedByMembershipId: approver };
}
