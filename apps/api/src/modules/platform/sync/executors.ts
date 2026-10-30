import type {
  CommandEnvelope,
  CommandFlag,
  CommandReason,
  LocalEventAction,
} from '@vertex-food/contracts';
import { auditEntries, staffMemberships, type Transaction } from '@vertex-food/db';
import {
  type CommandDefinition,
  type LocalEvent,
  networkCheck,
  recordLocalEvents,
} from '@vertex-food/sync';
import { inArray } from 'drizzle-orm';

// The server's `execute` step of each command (spec S04 rules 1, 9): it receives the verified
// envelope once rule 8's checks passed, validates the whole command before writing anything, and
// answers its outcome. A business refusal is `rejected` with a reason; the pipeline rolls the
// command's savepoint back (SYNC-01), so a rejected command leaves nothing behind. S09 onward add
// the executors of their commands in the modules that own them.

/** What `execute` receives: the envelope with its payload and resolved version parsed. */
export type CommandExecution<Payload = unknown, Resolved = unknown> = {
  tenantId: string;
  /** From the device token. */
  branchId: string;
  envelope: CommandEnvelope;
  payload: Payload;
  resolved: Resolved;
  effectiveTime: Date;
  receivedAt: Date;
  flags: readonly CommandFlag[];
};

export type ExecutionResult =
  | { outcome: 'accepted' }
  | { outcome: 'adjusted'; details: Record<string, unknown> }
  | { outcome: 'rejected'; reason: CommandReason; details?: Record<string, unknown> };

export type CommandExecutor<Payload = unknown, Resolved = unknown> = {
  name: string;
  version: number;
  execute(tx: Transaction, command: CommandExecution<Payload, Resolved>): Promise<ExecutionResult>;
};

/** Ties an executor to its registry definition, so their payload types agree. */
export function defineExecutor<Payload, Resolved>(
  definition: CommandDefinition<Payload, Resolved>,
  execute: CommandExecutor<Payload, Resolved>['execute'],
): CommandExecutor {
  return { name: definition.name, version: definition.version, execute } as CommandExecutor;
}

/** The executors of this release, one per registry definition (checked at start). */
export const COMMAND_EXECUTORS = Symbol('CommandExecutors');

/** The registry of commands the server accepts: `commandRegistry` of `@vertex-food/sync`. */
export const COMMAND_REGISTRY = Symbol('CommandRegistry');

/**
 * `sync.network_check`: the branch network check. Its journey through the hub, the standby and
 * this upload is the test; the server records it accepted and writes nothing else.
 */
export const networkCheckExecutor = defineExecutor(networkCheck, async () => ({
  outcome: 'accepted',
}));

type EntityOf = (event: LocalEvent, deviceId: string) => { type: string; id: string | null };

const byDevice: EntityOf = (_event, deviceId) => ({ type: 'device', id: deviceId });
const byPairing: EntityOf = (event) => ({ type: 'hub_pairing', id: event.pairingId ?? null });
const byMember: EntityOf = (event) => ({
  type: 'staff_membership',
  id: event.membershipId ?? null,
});

/** The entity each offline event concerns. */
const entityOf: Record<LocalEventAction, EntityOf> = {
  'hub.promoted': byDevice,
  'hub.demoted': byDevice,
  'hub.rejoined': byDevice,
  'hub.divergence_adopted': byDevice,
  'hub_pairing.opened': byDevice,
  'hub_pairing.paired': byPairing,
  'hub_pairing.revoked': byPairing,
  'hub_pairing.expired': byPairing,
  'hub_session.pin_locked': byMember,
  'sync.network_check_run': byDevice,
  'staff_pin.failed_offline': byMember,
  'staff_pin.locked_offline': byMember,
  'staff_pin.reenabled_offline': byMember,
  'staff_approval.granted': byMember,
};

/**
 * `audit.record_local_events` (spec S04 "Audit"): the events a PC recorded offline reach the
 * tenant's audit with their device times and `recorded_offline`, as the member who caused each one
 * or as the PC. Every member named must be one of the tenant's, checked before anything is written.
 */
export const recordLocalEventsExecutor = defineExecutor(recordLocalEvents, async (tx, command) => {
  const { events } = command.payload;
  const membershipIds = [
    ...new Set(events.flatMap((event) => (event.membershipId ? [event.membershipId] : []))),
  ];
  const members =
    membershipIds.length === 0
      ? []
      : await tx
          .select({ id: staffMemberships.id, accountId: staffMemberships.accountId })
          .from(staffMemberships)
          .where(inArray(staffMemberships.id, membershipIds));
  const accounts = new Map(members.map((member) => [member.id, member.accountId]));
  const unknown = membershipIds.filter((id) => !accounts.has(id));
  if (unknown.length > 0) {
    return {
      outcome: 'rejected',
      reason: 'payload_invalid',
      details: { unknownMembershipIds: unknown },
    };
  }
  const { envelope } = command;
  // The PC that recorded the events; a client PC's events reach the hub as its own commands.
  const deviceId =
    envelope.originKind === 'pc' ? envelope.originDeviceId : envelope.executedByDeviceId;
  await tx.insert(auditEntries).values(
    events.map((event) => {
      const entity = entityOf[event.action](event, deviceId);
      const accountId = event.membershipId ? (accounts.get(event.membershipId) as string) : null;
      return {
        tenantId: command.tenantId,
        actorKind: accountId ? 'staff' : 'system',
        actorId: accountId,
        actorName: accountId ? null : 'device',
        deviceId,
        branchId: command.branchId,
        action: event.action,
        entityType: entity.type,
        entityId: entity.id,
        details: {
          ...event.details,
          ...(event.membershipId ? { membershipId: event.membershipId } : {}),
          ...(event.pairingId ? { pairingId: event.pairingId } : {}),
          commandId: envelope.id,
          ...(envelope.afterOfflineWindow ? { afterOfflineWindow: true } : {}),
        },
        occurredAt: new Date(event.at),
        recordedOffline: true,
      };
    }),
  );
  return { outcome: 'accepted' };
});

export const commandExecutors: readonly CommandExecutor[] = [
  networkCheckExecutor,
  recordLocalEventsExecutor,
];
