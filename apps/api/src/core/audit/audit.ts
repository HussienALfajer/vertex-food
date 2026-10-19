import type { AuditAction } from '@vertex-food/contracts';
import {
  auditEntries,
  type Database,
  platformAuditEntries,
  type Transaction,
} from '@vertex-food/db';
import type { Actor } from '../access/actor.js';

/**
 * Audit entries (ADR 0016), written in the same transaction as the change they record. They hold
 * ids, codes and the old and new values of settings; `reason` is the free text a person wrote and
 * never goes to logs. Never a customer's phone or address or a driver's location.
 */
export type AuditRecord = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
};

function actorColumns(actor: Actor) {
  switch (actor.kind) {
    case 'staff':
      return { actorKind: 'staff', actorId: actor.accountId, actorName: null };
    case 'platform':
      return { actorKind: 'platform', actorId: actor.userId, actorName: null };
    case 'system':
      return { actorKind: 'system', actorId: null, actorName: actor.name };
  }
}

/** One entry in the tenant's audit log, inside `withTenant` of that tenant. */
export async function audit(
  tx: Transaction,
  tenantId: string,
  actor: Actor,
  record: AuditRecord,
): Promise<void> {
  await tx.insert(auditEntries).values({
    tenantId,
    ...actorColumns(actor),
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId ?? null,
    reason: record.reason ?? null,
    details: record.details ?? null,
    occurredAt: new Date(),
  });
}

/** One entry in the platform audit log: a change that belongs to no tenant (a city added). */
export async function auditPlatform(
  db: Database | Transaction,
  actor: Actor,
  record: AuditRecord,
): Promise<void> {
  await db.insert(platformAuditEntries).values({
    ...actorColumns(actor),
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId ?? null,
    reason: record.reason ?? null,
    details: record.details ?? null,
    occurredAt: new Date(),
  });
}
