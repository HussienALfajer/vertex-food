import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CommandEnvelope,
  type CommandResult,
  commandEnvelopeSchema,
  DomainError,
  isSyncProtocolSupported,
  MAX_QUARANTINE_COMMANDS,
  type QuarantineBatch,
  type QuarantineBatchDetail,
  type QuarantineUpload,
  quarantineUploadMessage,
} from '@vertex-food/contracts';
import {
  commandLog,
  type Database,
  devices,
  quarantineBatches,
  quarantineCommands,
  quarantineDecisions,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { type CommandRegistry, checkEnvelope } from '@vertex-food/sync';
import { ed25519Verifier } from '@vertex-food/sync/node';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { databaseNow } from '../../../core/database/database-now.js';
import { DeviceProofs } from '../identity/index.js';
import { CommandPipeline } from './command-pipeline.js';
import { COMMAND_REGISTRY } from './executors.js';
import { addToQuarantine, quarantineBatch } from './quarantine-store.js';
import { commandSummary, toQuarantineBatch } from './sync.views.js';
import { lock } from './sync-locks.js';

const notFound = () => new DomainError('NOT_FOUND', 'No such quarantine batch');

/** Journal order (rule 12): epoch, then sequence. */
const byJournal = (a: CommandEnvelope, b: CommandEnvelope) =>
  a.hubEpoch - b.hubEpoch || a.hubSeq - b.hubSeq;

/**
 * The quarantine (spec S04 rules 16, 40–42, S02 rules 19, 20, 33): a revoked PC uploads its
 * pending work once, signed with its device key; the owner reviews each batch and accepts it (its
 * commands run as late commands, in journal order, without the device check) or rejects it with a
 * reason; nothing in it runs before.
 */
@Injectable()
export class QuarantineService {
  private readonly logger = new Logger('SyncQuarantine');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(COMMAND_REGISTRY) private readonly registry: CommandRegistry,
    @Inject(CommandPipeline) private readonly pipeline: CommandPipeline,
    @Inject(DeviceProofs) private readonly proofs: DeviceProofs,
  ) {}

  /**
   * Rule 40: the revoked PC proves itself with the nonce of a device-token challenge signed by
   * its key, until it confirmed its wipe. Its own commands go to its revocation's one batch while
   * the owner has not decided on it (at most 10 000; any beyond are refused, audited and logged);
   * the entries of its journal that another PC executed are not its to hold, and run as any upload
   * of them would, through rule 8 with their executor's signature.
   */
  async upload(input: QuarantineUpload): Promise<{ batchId: string }> {
    if (!isSyncProtocolSupported(input.protocol)) {
      throw new DomainError('PROTOCOL_UNSUPPORTED', 'The sync protocol is not supported');
    }
    this.proofs.takeNonce(input.tenantId, input.deviceId, input.nonce);
    const own = input.commands.filter((envelope) => envelope.executedByDeviceId === input.deviceId);
    const others = input.commands.filter(
      (envelope) => envelope.executedByDeviceId !== input.deviceId,
    );
    const received = await withTenant(this.db, input.tenantId, async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, input.deviceId));
      if (!device) throw new DomainError('DEVICE_UNKNOWN', 'Unknown device');
      const verify = ed25519Verifier(device.publicKey);
      if (!verify(quarantineUploadMessage(input.nonce, input.deviceId), input.signature)) {
        throw new DomainError('SIGNATURE_INVALID', 'The device signature does not verify');
      }
      if (device.status !== 'revoked') {
        throw new DomainError('DEVICE_NOT_REVOKED', 'Only a revoked PC uploads to the quarantine');
      }
      if (device.wipedAt) throw new DomainError('DEVICE_REVOKED', 'The PC confirmed its wipe');
      const actor = {
        kind: 'device',
        tenantId: input.tenantId,
        deviceId: device.id,
        branchId: device.branchId,
        status: 'revoked',
      } as const;
      const batch = await quarantineBatch(tx, {
        tenantId: input.tenantId,
        branchId: device.branchId,
        deviceId: device.id,
        reason: 'device_revoked',
        membershipId: null,
        receivedFromDeviceId: device.id,
      });
      // The owner decided on what the batch held: nothing more is taken or run.
      if (batch.decision !== null) {
        this.logger.warn(`Quarantine upload after the decision: batch ${batch.id}`);
        return { batchId: batch.id, branchId: device.branchId, decided: true };
      }
      // The standby's uploads may have added some of these before; ids already held stay.
      const [held] = await tx
        .select({ value: count() })
        .from(quarantineCommands)
        .where(eq(quarantineCommands.batchId, batch.id));
      const room = Math.max(0, MAX_QUARANTINE_COMMANDS - (held?.value ?? 0));
      const taken = own.slice(0, room);
      const refused = own.slice(room).map((envelope) => envelope.id);
      if (taken.length > 0) {
        await addToQuarantine(tx, {
          tenantId: input.tenantId,
          batchId: batch.id,
          envelopes: taken,
          receivedAt: await databaseNow(tx),
        });
      }
      if (refused.length > 0) {
        this.logger.warn(
          `Quarantine batch ${batch.id} full: ${refused.length} commands refused, first ${refused[0]}`,
        );
      }
      await audit(tx, input.tenantId, actor, {
        action: 'quarantine_batch.received',
        entityType: 'quarantine_batch',
        entityId: batch.id,
        details: {
          reason: 'device_revoked',
          uploaded: taken.length,
          executedElsewhere: others.length,
          ...(refused.length > 0 ? { refused: refused.length, refusedIds: refused } : {}),
        },
      });
      return { batchId: batch.id, branchId: device.branchId, decided: false };
    });
    if (!received.decided) {
      for (const envelope of [...others].sort(byJournal)) {
        await withTenant(this.db, input.tenantId, async (tx) => {
          // A revoked PC is not trusted with another PC's command: one that its executor did not
          // sign is left out, unrecorded, so the executor's own upload still runs the real one.
          const [executor] = await tx
            .select({ publicKey: devices.publicKey })
            .from(devices)
            .where(
              and(
                eq(devices.id, envelope.executedByDeviceId),
                eq(devices.branchId, received.branchId),
              ),
            );
          if (!executor || !checkEnvelope(envelope, ed25519Verifier(executor.publicKey)).ok) {
            this.logger.warn(
              `Quarantine upload with a command its executor did not sign: command ${envelope.id} uploader ${input.deviceId}`,
            );
            return;
          }
          await this.pipeline.run(
            tx,
            {
              tenantId: input.tenantId,
              branchId: received.branchId,
              uploadedByDeviceId: input.deviceId,
            },
            { envelope, mirrored: true },
            { fromQuarantine: false },
          );
        });
      }
    }
    return { batchId: received.batchId };
  }

  list(actor: StaffActor): Promise<QuarantineBatch[]> {
    requirePermission(actor, 'sync.quarantine.review');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const rows = await tx
        .select({ id: quarantineBatches.id })
        .from(quarantineBatches)
        .orderBy(desc(quarantineBatches.createdAt));
      const batches: QuarantineBatch[] = [];
      for (const row of rows) batches.push(await readBatch(tx, row.id));
      return batches;
    });
  }

  detail(actor: StaffActor, id: string): Promise<QuarantineBatchDetail> {
    requirePermission(actor, 'sync.quarantine.review');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const batch = await readBatch(tx, id);
      const envelopes = await batchEnvelopes(tx, id);
      const executed = await executedIds(tx, envelopes);
      return {
        batch,
        commands: envelopes.map((envelope) => ({
          commandId: envelope.id,
          name: envelope.name,
          summary: commandSummary(this.registry, { ...envelope, reason: null }, envelope),
          deviceTime: envelope.deviceTime,
          hubEpoch: envelope.hubEpoch,
          hubSeq: envelope.hubSeq,
          alreadyExecuted: executed.has(envelope.id),
        })),
      };
    });
  }

  /**
   * Rule 41: the decision, then the batch's commands in journal order, each in its own transaction
   * through rule 8 without the device check and flagged `from_quarantine`; one already in the log
   * (uploaded earlier by the standby) answers as a replay and is skipped. An accept cut short is
   * finished by accepting again, which runs what is left.
   */
  async accept(
    actor: StaffActor,
    id: string,
  ): Promise<{ batch: QuarantineBatch; results: CommandResult[] }> {
    requirePermission(actor, 'sync.quarantine.review');
    const batch = await withTenant(this.db, actor.tenantId, async (tx) => {
      await lock(tx, 'quarantine-batch', id);
      const [decided] = await tx
        .select({ decision: quarantineDecisions.decision })
        .from(quarantineDecisions)
        .where(eq(quarantineDecisions.batchId, id));
      if (decided?.decision === 'accept' && (await unexecutedCount(tx, id)) > 0) {
        return batchRow(tx, id);
      }
      return this.decide(tx, actor, id, 'accept', null);
    });
    const envelopes = await withTenant(this.db, actor.tenantId, (tx) => batchEnvelopes(tx, id));
    const results: CommandResult[] = [];
    for (const envelope of envelopes) {
      results.push(
        await withTenant(this.db, actor.tenantId, (tx) =>
          this.pipeline.run(
            tx,
            {
              tenantId: actor.tenantId,
              branchId: batch.branchId,
              uploadedByDeviceId: batch.deviceId,
            },
            { envelope, mirrored: true },
            { fromQuarantine: true },
          ),
        ),
      );
    }
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await audit(tx, actor.tenantId, actor, {
        action: 'quarantine_batch.accepted',
        entityType: 'quarantine_batch',
        entityId: id,
        details: {
          commands: results.length,
          skipped: results.filter((result) => result.replay).length,
        },
      });
      return { batch: await readBatch(tx, id), results };
    });
  }

  /** Rule 41: records the reason and executes nothing. */
  reject(
    actor: StaffActor,
    id: string,
    reason: string,
  ): Promise<{ batch: QuarantineBatch; results: CommandResult[] }> {
    requirePermission(actor, 'sync.quarantine.review');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await this.decide(tx, actor, id, 'reject', reason);
      await audit(tx, actor.tenantId, actor, {
        action: 'quarantine_batch.rejected',
        entityType: 'quarantine_batch',
        entityId: id,
        reason,
      });
      return { batch: await readBatch(tx, id), results: [] };
    });
  }

  /** The decision, once per batch under a lock on it (`QUARANTINE_ALREADY_DECIDED`). */
  private async decide(
    tx: Transaction,
    actor: StaffActor,
    id: string,
    decision: 'accept' | 'reject',
    reason: string | null,
  ) {
    await lock(tx, 'quarantine-batch', id);
    const batch = await batchRow(tx, id);
    // The revoked PC's batch takes no more commands while it is decided.
    await lock(tx, 'quarantine-device', batch.deviceId);
    const [decided] = await tx
      .select({ id: quarantineDecisions.id })
      .from(quarantineDecisions)
      .where(eq(quarantineDecisions.batchId, id));
    if (decided) {
      throw new DomainError('QUARANTINE_ALREADY_DECIDED', 'The batch is already decided', {
        batchId: id,
      });
    }
    await tx.insert(quarantineDecisions).values({
      tenantId: actor.tenantId,
      batchId: id,
      decision,
      reason,
      decidedByMembershipId: actor.membershipId,
      decidedAt: new Date(),
    });
    return batch;
  }
}

async function batchRow(tx: Transaction, id: string) {
  const [batch] = await tx.select().from(quarantineBatches).where(eq(quarantineBatches.id, id));
  if (!batch) throw notFound();
  return batch;
}

/** How many of the batch's commands are not in the log yet. */
async function unexecutedCount(tx: Transaction, id: string): Promise<number> {
  const envelopes = await batchEnvelopes(tx, id);
  const executed = await executedIds(tx, envelopes);
  return envelopes.filter((envelope) => !executed.has(envelope.id)).length;
}

async function readBatch(tx: Transaction, id: string): Promise<QuarantineBatch> {
  const [row] = await tx
    .select({ batch: quarantineBatches, deviceName: devices.name, decision: quarantineDecisions })
    .from(quarantineBatches)
    .innerJoin(devices, eq(devices.id, quarantineBatches.deviceId))
    .leftJoin(quarantineDecisions, eq(quarantineDecisions.batchId, quarantineBatches.id))
    .where(eq(quarantineBatches.id, id));
  if (!row) throw notFound();
  const [commands] = await tx
    .select({ value: count() })
    .from(quarantineCommands)
    .where(eq(quarantineCommands.batchId, id));
  return toQuarantineBatch(row.batch, row.deviceName, commands?.value ?? 0, row.decision);
}

/** A batch's envelopes in journal order. */
async function batchEnvelopes(tx: Transaction, batchId: string): Promise<CommandEnvelope[]> {
  const rows = await tx
    .select({ envelope: quarantineCommands.envelope })
    .from(quarantineCommands)
    .where(eq(quarantineCommands.batchId, batchId));
  return rows.map((row) => commandEnvelopeSchema.parse(row.envelope)).sort(byJournal);
}

async function executedIds(tx: Transaction, envelopes: readonly CommandEnvelope[]) {
  const ids = envelopes.map((envelope) => envelope.id);
  const executed = new Set<string>();
  const CHUNK = 1000;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const rows = await tx
      .select({ id: commandLog.id })
      .from(commandLog)
      .where(inArray(commandLog.id, ids.slice(start, start + CHUNK)));
    for (const row of rows) executed.add(row.id);
  }
  return executed;
}
