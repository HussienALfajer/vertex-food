import type { CommandEnvelope, QuarantineReason } from '@vertex-food/contracts';
import {
  quarantineBatches,
  quarantineCommands,
  quarantineDecisions,
  type Transaction,
} from '@vertex-food/db';
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '../../../core/audit/audit.js';
import { lock } from './sync-locks.js';

// The quarantine's batches (spec S04 rules 16, 40–42): a revoked PC's pending work in one batch per
// revocation, and a deactivated member's commands that rule 16 could not run, per member and PC,
// in an open batch until the owner decides. A command id is held once.

/**
 * The batch for `reason`: the revoked PC's one batch, or the member's undecided batch for this
 * PC, created when missing (audited as received). Answers it with its decision, if any.
 */
export async function quarantineBatch(
  tx: Transaction,
  input: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    reason: QuarantineReason;
    membershipId: string | null;
    /** The PC whose upload brought the commands, for the audit entry. */
    receivedFromDeviceId: string;
  },
): Promise<{ id: string; decision: 'accept' | 'reject' | null; created: boolean }> {
  await lock(tx, 'quarantine-device', input.deviceId);
  const found = await tx
    .select({ id: quarantineBatches.id, decision: quarantineDecisions.decision })
    .from(quarantineBatches)
    .leftJoin(quarantineDecisions, eq(quarantineDecisions.batchId, quarantineBatches.id))
    .where(
      input.reason === 'device_revoked'
        ? and(
            eq(quarantineBatches.deviceId, input.deviceId),
            eq(quarantineBatches.reason, 'device_revoked'),
          )
        : and(
            eq(quarantineBatches.deviceId, input.deviceId),
            eq(quarantineBatches.reason, 'member_inactive'),
            eq(quarantineBatches.membershipId, input.membershipId as string),
            isNull(quarantineDecisions.id),
          ),
    )
    .limit(1);
  const existing = found[0];
  if (existing) {
    return {
      id: existing.id,
      decision: existing.decision as 'accept' | 'reject' | null,
      created: false,
    };
  }
  const [batch] = await tx
    .insert(quarantineBatches)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      deviceId: input.deviceId,
      reason: input.reason,
      membershipId: input.membershipId,
    })
    .returning({ id: quarantineBatches.id });
  if (!batch) throw new Error('No quarantine batch inserted');
  await audit(
    tx,
    input.tenantId,
    {
      kind: 'device',
      tenantId: input.tenantId,
      deviceId: input.receivedFromDeviceId,
      branchId: input.branchId,
      status: 'active',
    },
    {
      action: 'quarantine_batch.received',
      entityType: 'quarantine_batch',
      entityId: batch.id,
      details: {
        reason: input.reason,
        deviceId: input.deviceId,
        ...(input.membershipId ? { membershipId: input.membershipId } : {}),
      },
    },
  );
  return { id: batch.id, decision: null, created: true };
}

/** Adds commands to a batch; an id already held anywhere in the tenant is left where it is. */
export async function addToQuarantine(
  tx: Transaction,
  input: {
    tenantId: string;
    batchId: string;
    envelopes: readonly CommandEnvelope[];
    receivedAt: Date;
  },
): Promise<void> {
  const CHUNK = 500;
  for (let start = 0; start < input.envelopes.length; start += CHUNK) {
    await tx
      .insert(quarantineCommands)
      .values(
        input.envelopes.slice(start, start + CHUNK).map((envelope) => ({
          tenantId: input.tenantId,
          batchId: input.batchId,
          commandId: envelope.id,
          envelope,
          receivedAt: input.receivedAt,
        })),
      )
      .onConflictDoNothing({ target: [quarantineCommands.tenantId, quarantineCommands.commandId] });
  }
}

/**
 * Holds one uploaded command in its batch (rules 16, 40). Answers the batch's decision: a revoked
 * PC's batch the owner already accepted takes its late commands in, to be run.
 */
export async function holdInQuarantine(
  tx: Transaction,
  input: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    reason: QuarantineReason;
    membershipId: string | null;
    envelope: CommandEnvelope;
    receivedAt: Date;
    receivedFromDeviceId: string;
  },
): Promise<'accept' | 'reject' | null> {
  const batch = await quarantineBatch(tx, input);
  await addToQuarantine(tx, {
    tenantId: input.tenantId,
    batchId: batch.id,
    envelopes: [input.envelope],
    receivedAt: input.receivedAt,
  });
  return batch.decision;
}
