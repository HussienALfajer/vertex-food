import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AttentionKind,
  type CommandFlag,
  type CommandReason,
  type CommandResult,
  clockSuspectReasons,
  correctedTime,
  DomainError,
  effectiveTime,
  isSyncProtocolSupported,
  type UploadCommands,
  type UploadCommandsResult,
  type UploadedCommand,
} from '@vertex-food/contracts';
import {
  attentionItems,
  commandLog,
  commandPayloads,
  commandReplays,
  type Database,
  describeForLog,
  deviceSyncStates,
  devices,
  quarantineBatches,
  quarantineCommands,
  staffMemberships,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import {
  type CommandDefinition,
  type CommandRegistry,
  checkEnvelope,
  commandPayloadHash,
} from '@vertex-food/sync';
import { ed25519Verifier } from '@vertex-food/sync/node';
import { and, eq } from 'drizzle-orm';
import type { DeviceActor } from '../../../core/access/actor.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isDeadlineExceeded } from '../../../core/database/deadline.js';
import { accessHistory, approverAllowed, memberDecision } from './command-access.js';
import {
  COMMAND_EXECUTORS,
  COMMAND_REGISTRY,
  type CommandExecution,
  type CommandExecutor,
  type ExecutionResult,
} from './executors.js';
import { holdInQuarantine } from './quarantine-store.js';
import { storableJson, toCommandResult } from './sync.views.js';
import { databaseNow, lock } from './sync-locks.js';

// The server's execution of uploaded commands (spec S04 rules 7–16, ADR 0035): each command in
// its own transaction under its tenant, after a transaction lock on its id; a known id answers its
// stored outcome; a new one goes through rule 8's checks in order, then its executor in a
// savepoint. Every outcome is recorded once with its payload, and the attention items it opens.

/** Where a command arrived: the token's tenant and branch, and the PC whose upload carried it. */
export type CommandScope = { tenantId: string; branchId: string; uploadedByDeviceId: string };

/** A late command the owner accepted from the quarantine runs without the device check (rule 41). */
export type RunOptions = { fromQuarantine: boolean };

/** Raised inside the savepoint to roll back a rejected command's writes (SYNC-01). */
class Rejected extends Error {
  constructor(readonly result: Extract<ExecutionResult, { outcome: 'rejected' }>) {
    super('rejected');
  }
}

/** SQLSTATE classes of a database or infrastructure failure, which the PC retries (rule 9). */
const INFRASTRUCTURE_CLASSES = ['08', '40', '53', '57P', '58', 'XX'];

/** The driver's network errors, which carry no SQLSTATE. */
const NETWORK_ERRORS = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isInfrastructureFailure(error: unknown): boolean {
  if (isDeadlineExceeded(error)) return true;
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
  const code = String(cause.code);
  if (NETWORK_ERRORS.has(code)) return true;
  // A SQLSTATE is five digits or capitals; Node's own `ERR_*` codes are a handler's bug.
  return (
    /^[0-9A-Z]{5}$/.test(code) && INFRASTRUCTURE_CLASSES.some((prefix) => code.startsWith(prefix))
  );
}

const unstored = (id: string, reason: CommandReason): CommandResult => ({
  id,
  outcome: 'rejected',
  reason,
  replay: false,
});

@Injectable()
export class CommandPipeline {
  private readonly logger = new Logger('SyncCommands');
  private readonly executors = new Map<string, CommandExecutor>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(COMMAND_REGISTRY) private readonly registry: CommandRegistry,
    @Inject(COMMAND_EXECUTORS) executors: readonly CommandExecutor[],
  ) {
    for (const executor of executors) {
      this.executors.set(`${executor.name}@${executor.version}`, executor);
    }
    // Every command the server accepts has its `execute` step (rule 1).
    for (const definition of registry.definitions()) {
      if (!this.executors.has(`${definition.name}@${definition.version}`)) {
        throw new Error(`${definition.name} v${definition.version} has no executor`);
      }
    }
  }

  /**
   * Rule 7: up to 100 envelopes from a hub-capable PC of the token's branch, each in its own
   * transaction. An unsupported protocol answers 426 before anything runs (rule 8's first check,
   * not stored); a database failure answers 5xx and the PC re-sends, the commands before it keep
   * their outcomes and answer as replays.
   */
  async upload(device: DeviceActor, input: UploadCommands): Promise<UploadCommandsResult> {
    if (
      !isSyncProtocolSupported(input.protocol) ||
      input.commands.some((command) => !isSyncProtocolSupported(command.envelope.protocol))
    ) {
      throw new DomainError('PROTOCOL_UNSUPPORTED', 'The sync protocol is not supported');
    }
    await withTenant(this.db, device.tenantId, (tx) => assertHubCapable(tx, device.deviceId));
    const scope: CommandScope = {
      tenantId: device.tenantId,
      branchId: device.branchId,
      uploadedByDeviceId: device.deviceId,
    };
    const results: CommandResult[] = [];
    for (const command of input.commands) {
      results.push(
        await withTenant(this.db, device.tenantId, (tx) =>
          this.run(tx, scope, command, { fromQuarantine: false }),
        ),
      );
    }
    return { results };
  }

  /** One command, inside the caller's tenant transaction. */
  async run(
    tx: Transaction,
    scope: CommandScope,
    uploaded: UploadedCommand,
    options: RunOptions,
  ): Promise<CommandResult> {
    const { envelope } = uploaded;
    // Concurrent uploads of one id (the hub and the standby) wait here for each other.
    await lock(tx, 'command', envelope.id);
    const receivedAt = await databaseNow(tx);
    const [known] = await tx.select().from(commandLog).where(eq(commandLog.id, envelope.id));
    if (known) {
      // Another branch's command is not this branch's to read or answer.
      if (known.branchId !== scope.branchId) {
        this.logger.warn(
          `Command of another branch uploaded: command ${envelope.id} uploader ${scope.uploadedByDeviceId}`,
        );
        return unstored(envelope.id, 'signature_invalid');
      }
      return this.replay(tx, scope, known, uploaded, receivedAt);
    }
    if (!options.fromQuarantine) {
      // Rule 16 decided on this command once; a revoked executor's is checked again below.
      const [held] = await tx
        .select({ id: quarantineCommands.id })
        .from(quarantineCommands)
        .innerJoin(quarantineBatches, eq(quarantineBatches.id, quarantineCommands.batchId))
        .where(
          and(
            eq(quarantineCommands.commandId, envelope.id),
            eq(quarantineBatches.reason, 'member_inactive'),
          ),
        );
      if (held) return { id: envelope.id, outcome: 'quarantined', replay: true };
    }

    const effective = effectiveTime(
      new Date(envelope.deviceTime),
      envelope.clockOffsetMs,
      receivedAt,
    );
    const [executor] = await tx
      .select({
        id: devices.id,
        branchId: devices.branchId,
        publicKey: devices.publicKey,
        status: devices.status,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.id, envelope.executedByDeviceId));
    const nextClockOffsetMs = executor
      ? await this.offsetAfter(tx, executor.id, envelope.deviceTime, envelope.clockOffsetMs)
      : null;
    const clockSuspect =
      clockSuspectReasons({
        deviceTime: new Date(envelope.deviceTime),
        highestSeenTime: new Date(envelope.highestSeenTime),
        clockOffsetMs: envelope.clockOffsetMs,
        receivedAt,
        nextClockOffsetMs,
      }).length > 0;
    const flags: CommandFlag[] = [];
    if (clockSuspect) flags.push('clock_suspect');
    if (envelope.afterOfflineWindow) flags.push('after_offline_window');
    if (options.fromQuarantine) flags.push('from_quarantine');
    if (!uploaded.mirrored) flags.push('mirrored_false');

    // Rule 8, in order; the first failure is the reason.
    let reason: CommandReason | null = null;
    let definition: CommandDefinition | undefined;
    let payload: unknown;
    let resolved: unknown;
    if (!isSyncProtocolSupported(envelope.protocol)) reason = 'protocol_unsupported';
    if (!reason) {
      const lookup = this.registry.lookup(envelope.name, envelope.version);
      if (lookup.ok) definition = lookup.definition;
      else reason = lookup.reason;
    }
    if (!reason && definition) {
      const parsedPayload = definition.payload.safeParse(envelope.payload);
      const parsedResolved = definition.resolved.safeParse(envelope.resolved);
      if (parsedPayload.success && parsedResolved.success) {
        payload = parsedPayload.data;
        resolved = parsedResolved.data;
      } else {
        reason = 'payload_invalid';
      }
    }
    if (!reason) {
      // Only a PC of the token's branch has a key that may sign the branch's commands.
      const check =
        executor && executor.branchId === scope.branchId
          ? checkEnvelope(envelope, ed25519Verifier(executor.publicKey))
          : ({ ok: false, reason: 'signature_invalid' } as const);
      if (!check.ok) reason = check.reason;
      if (reason === 'signature_invalid') {
        this.logger.warn(
          `Command signature invalid: command ${envelope.id} executor ${envelope.executedByDeviceId} uploader ${scope.uploadedByDeviceId}`,
        );
      }
    }
    if (!reason && executor && !options.fromQuarantine) {
      const revoked =
        executor.status !== 'active' &&
        (executor.revokedAt === null || executor.revokedAt.getTime() <= effective.getTime());
      if (revoked) {
        const held = await this.quarantine(tx, scope, uploaded, receivedAt, {
          reason: 'device_revoked',
          deviceId: executor.id,
          membershipId: null,
        });
        if (held) return held;
        // The owner decided on the revoked PC's batch: a command it did not hold is refused.
        reason = 'device_revoked';
      }
    }

    // A row of command_log names its executor, member and approver by tenant keys: an id the
    // tenant does not hold is answered without being stored (a forgery, with its security line).
    const actor = envelope.actor;
    const membershipId = actor.kind === 'member' ? actor.membershipId : null;
    const members = await this.knownMemberships(tx, [
      membershipId,
      envelope.approvedByMembershipId,
    ]);
    if (!executor) return unstored(envelope.id, reason ?? 'signature_invalid');
    if (membershipId && !members.has(membershipId)) {
      this.logger.warn(`Command of an unknown member: command ${envelope.id}`);
      return unstored(envelope.id, reason ?? 'member_inactive');
    }
    if (envelope.approvedByMembershipId && !members.has(envelope.approvedByMembershipId)) {
      this.logger.warn(`Command with an unknown approver: command ${envelope.id}`);
      return unstored(envelope.id, reason ?? 'approver_not_allowed');
    }

    if (!reason && definition) {
      const decision = await this.checkActor(tx, scope, uploaded, definition, effective, {
        clockSuspect,
        accepted: options.fromQuarantine,
      });
      if (decision === 'quarantine') {
        const held = await this.quarantine(tx, scope, uploaded, receivedAt, {
          reason: 'member_inactive',
          deviceId: executor.id,
          membershipId,
        });
        if (held) return held;
        throw new Error('A member batch is always open');
      }
      reason = decision;
    }

    let result: ExecutionResult;
    if (reason || !definition) {
      result = { outcome: 'rejected', reason: reason ?? 'unknown_command' };
    } else {
      result = await this.execute(tx, {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        envelope,
        payload,
        resolved,
        effectiveTime: effective,
        receivedAt,
        flags,
      });
    }
    return this.record(tx, scope, uploaded, { result, receivedAt, effective, flags });
  }

  /** Rule 8's actor checks: the reason of a refusal, `quarantine` (rule 16), or null. */
  private async checkActor(
    tx: Transaction,
    scope: CommandScope,
    uploaded: UploadedCommand,
    definition: CommandDefinition,
    effective: Date,
    clock: { clockSuspect: boolean; accepted: boolean },
  ): Promise<CommandReason | 'quarantine' | null> {
    const { envelope } = uploaded;
    const { access } = definition;
    const actor = envelope.actor;
    if (access.actor === 'device') {
      if (actor.kind === 'station') return 'station_not_allowed';
      if (actor.kind !== 'device' || envelope.originKind !== 'pc') return 'permission_missing';
      // The PC that made it is one of the branch's (a client PC's command reaches the hub's).
      const [origin] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, envelope.originDeviceId), eq(devices.branchId, scope.branchId)));
      return origin ? null : 'permission_missing';
    }
    if (actor.kind === 'device') return 'permission_missing';
    if (actor.kind === 'station') return access.station ? null : 'station_not_allowed';
    const decision = memberDecision(await accessHistory(tx, actor.membershipId), {
      branchId: scope.branchId,
      permission: access.permission,
      effectiveTime: effective,
      clockSuspect: clock.clockSuspect,
      accepted: clock.accepted,
    });
    if (decision.kind === 'quarantine') return 'quarantine';
    if (decision.kind === 'rejected') return decision.reason;
    const approver = envelope.approvedByMembershipId;
    if (approver) {
      if (!access.approval || approver === actor.membershipId) return 'approver_not_allowed';
      const allowed = approverAllowed(await accessHistory(tx, approver), {
        branchId: scope.branchId,
        permission: access.approval,
        effectiveTime: effective,
      });
      if (!allowed) return 'approver_not_allowed';
    }
    return null;
  }

  /**
   * Rule 9: the executor runs in a savepoint. A rejection rolls back what it wrote (SYNC-01); an
   * exception is rolled back and recorded as `server_error`, so the PC's queue always drains;
   * only a database or infrastructure failure goes up as 5xx, which the PC retries.
   */
  private async execute(tx: Transaction, command: CommandExecution): Promise<ExecutionResult> {
    const { envelope } = command;
    const executor = this.executors.get(`${envelope.name}@${envelope.version}`) as CommandExecutor;
    try {
      return await tx.transaction(async (savepoint) => {
        const result = await executor.execute(savepoint, command);
        if (result.outcome === 'rejected') throw new Rejected(result);
        return result;
      });
    } catch (error) {
      if (error instanceof Rejected) return error.result;
      if (isInfrastructureFailure(error)) throw error;
      this.logger.error(
        `Command ${envelope.id} (${envelope.name} v${envelope.version}) failed: ${describeForLog(error)}`,
      );
      return { outcome: 'rejected', reason: 'server_error' };
    }
  }

  /** The outcome, recorded once with its payload and the attention items it opens (rule 47). */
  private async record(
    tx: Transaction,
    scope: CommandScope,
    uploaded: UploadedCommand,
    outcome: { result: ExecutionResult; receivedAt: Date; effective: Date; flags: CommandFlag[] },
  ): Promise<CommandResult> {
    const { envelope } = uploaded;
    const { result } = outcome;
    const actor = envelope.actor;
    const membershipId = actor.kind === 'member' ? actor.membershipId : null;
    const reason = result.outcome === 'rejected' ? result.reason : null;
    const details = result.outcome === 'accepted' ? null : (result.details ?? null);
    const [row] = await tx
      .insert(commandLog)
      .values({
        id: envelope.id,
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        name: envelope.name,
        version: envelope.version,
        protocol: envelope.protocol,
        originKind: envelope.originKind,
        originDeviceId: envelope.originDeviceId,
        executedByDeviceId: envelope.executedByDeviceId,
        uploadedByDeviceId: scope.uploadedByDeviceId,
        actorKind: actor.kind,
        membershipId,
        pairingId: actor.kind === 'station' ? actor.pairingId : null,
        approvedByMembershipId: envelope.approvedByMembershipId ?? null,
        hubEpoch: envelope.hubEpoch,
        hubSeq: envelope.hubSeq,
        deviceTime: new Date(envelope.deviceTime),
        clockOffsetMs: envelope.clockOffsetMs,
        effectiveTime: outcome.effective,
        receivedAt: outcome.receivedAt,
        payloadHash: envelope.payloadHash,
        outcome: result.outcome,
        reason,
        details,
        flags: outcome.flags,
      })
      .returning();
    if (!row) throw new Error('No command logged');
    await tx.insert(commandPayloads).values({
      tenantId: scope.tenantId,
      commandId: envelope.id,
      payload: storableJson(envelope.payload),
      resolved: storableJson(envelope.resolved),
    });
    const kinds: AttentionKind[] = [];
    if (result.outcome === 'adjusted') kinds.push('adjusted');
    if (result.outcome === 'rejected') {
      kinds.push(result.reason === 'server_error' ? 'server_error' : 'rejected');
    }
    if (outcome.flags.includes('clock_suspect')) kinds.push('clock_suspect');
    for (const kind of kinds) {
      await openAttention(tx, { ...scope, commandId: envelope.id, kind, membershipId });
    }
    return toCommandResult(row, false);
  }

  /**
   * Rule 7: a known id answers its stored outcome. Another version of it (a different payload
   * hash, or one that does not match its own payload) is kept in `command_replays`, once per
   * hash, with a `replay_mismatch` attention item; an identical replay writes nothing.
   */
  private async replay(
    tx: Transaction,
    scope: CommandScope,
    known: typeof commandLog.$inferSelect,
    uploaded: UploadedCommand,
    receivedAt: Date,
  ): Promise<CommandResult> {
    const { envelope } = uploaded;
    let consistent: boolean;
    try {
      consistent = commandPayloadHash(envelope.payload, envelope.resolved) === envelope.payloadHash;
    } catch {
      consistent = false;
    }
    if (!consistent || envelope.payloadHash !== known.payloadHash) {
      const [seen] = await tx
        .select({ id: commandReplays.id })
        .from(commandReplays)
        .where(
          and(
            eq(commandReplays.commandId, envelope.id),
            eq(commandReplays.payloadHash, envelope.payloadHash),
          ),
        )
        .limit(1);
      if (!seen) {
        await tx.insert(commandReplays).values({
          tenantId: scope.tenantId,
          commandId: envelope.id,
          uploadedByDeviceId: scope.uploadedByDeviceId,
          payloadHash: envelope.payloadHash,
          payload: storableJson(envelope.payload),
          resolved: storableJson(envelope.resolved),
          receivedAt,
        });
      }
      await openAttention(tx, {
        tenantId: scope.tenantId,
        branchId: known.branchId,
        commandId: envelope.id,
        kind: 'replay_mismatch',
        membershipId: known.membershipId,
      });
    }
    return toCommandResult(known, true);
  }

  /**
   * Rules 16 and 40–42: the command is held for the owner, and the PC drops it from its queue. A
   * revoked PC's batch the owner decided takes nothing more: a command it held when the owner
   * accepted it runs (the standby uploading it after the decision), any other answers null and is
   * refused `device_revoked` by the caller.
   */
  private async quarantine(
    tx: Transaction,
    scope: CommandScope,
    uploaded: UploadedCommand,
    receivedAt: Date,
    hold: {
      reason: 'device_revoked' | 'member_inactive';
      deviceId: string;
      membershipId: string | null;
    },
  ): Promise<CommandResult | null> {
    const held = await holdInQuarantine(tx, {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      deviceId: hold.deviceId,
      reason: hold.reason,
      membershipId: hold.membershipId,
      envelope: uploaded.envelope,
      receivedAt,
      receivedFromDeviceId: scope.uploadedByDeviceId,
    });
    if (held.decision === null) {
      return { id: uploaded.envelope.id, outcome: 'quarantined', replay: held.alreadyHeld };
    }
    if (held.decision === 'accept' && held.alreadyHeld) {
      return this.run(tx, scope, uploaded, { fromQuarantine: true });
    }
    return null;
  }

  /**
   * The PC's offset measured after the command (rule 15): its latest heartbeat's, when that
   * heartbeat came after the command's corrected time.
   */
  private async offsetAfter(
    tx: Transaction,
    deviceId: string,
    deviceTime: string,
    clockOffsetMs: number,
  ): Promise<number | null> {
    const [state] = await tx
      .select({
        lastHeartbeatAt: deviceSyncStates.lastHeartbeatAt,
        clockOffsetMs: deviceSyncStates.clockOffsetMs,
      })
      .from(deviceSyncStates)
      .where(eq(deviceSyncStates.deviceId, deviceId));
    if (!state || state.clockOffsetMs === null) return null;
    const corrected = correctedTime(new Date(deviceTime), clockOffsetMs);
    return state.lastHeartbeatAt.getTime() > corrected.getTime() ? state.clockOffsetMs : null;
  }

  private async knownMemberships(
    tx: Transaction,
    ids: readonly (string | null | undefined)[],
  ): Promise<Set<string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const known = new Set<string>();
    for (const id of wanted) {
      const [row] = await tx
        .select({ id: staffMemberships.id })
        .from(staffMemberships)
        .where(eq(staffMemberships.id, id));
      if (row) known.add(row.id);
    }
    return known;
  }
}

/**
 * Refuses a PC that is neither the branch's configured hub nor its standby (rule 7): client PCs
 * send their commands to the hub on the LAN.
 */
export async function assertHubCapable(tx: Transaction, deviceId: string): Promise<void> {
  const [row] = await tx
    .select({ hubRole: devices.hubRole })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (!row?.hubRole) {
    throw new DomainError('DEVICE_NOT_HUB_CAPABLE', 'Only the hub and the standby upload');
  }
}

/** Opens an attention item once per command and kind (rule 47). */
export async function openAttention(
  tx: Transaction,
  item: {
    tenantId: string;
    branchId: string;
    commandId: string;
    kind: AttentionKind;
    membershipId: string | null;
  },
): Promise<void> {
  await tx
    .insert(attentionItems)
    .values({
      tenantId: item.tenantId,
      branchId: item.branchId,
      commandId: item.commandId,
      kind: item.kind,
      membershipId: item.membershipId,
    })
    .onConflictDoNothing({
      target: [attentionItems.tenantId, attentionItems.commandId, attentionItems.kind],
    });
}
