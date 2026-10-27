import type { AuditAction } from '@vertex-food/contracts';
import {
  auditEntries,
  type Database,
  platformAuditEntries,
  type Transaction,
} from '@vertex-food/db';
import type { Actor, DeviceActor, PlatformActor } from '../access/actor.js';

/** A platform user named without a session: a failed sign-in step, a session's own end. */
type PlatformUserRef = Pick<PlatformActor, 'kind' | 'userId'>;

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
  /** Platform entries: the tenant the change concerns (spec S02 rule 43). */
  subjectTenantId?: string | null;
  /** Platform entries: the console route of a `console.request`, as `METHOD /path/:param`. */
  requestRoute?: string | null;
};

/**
 * Who the entry names. A registered PC acting without a member (confirming its wipe) is recorded
 * as the system with its device id.
 */
function actorColumns(actor: Actor | DeviceActor | PlatformUserRef) {
  switch (actor.kind) {
    case 'device':
      return { actorKind: 'system', actorId: null, actorName: 'device' };
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
  actor: Actor | DeviceActor,
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
    deviceId: actor.kind === 'staff' || actor.kind === 'device' ? actor.deviceId : null,
    occurredAt: new Date(),
  });
}

/** One entry in the platform audit log: a change that belongs to no tenant (a city added). */
export async function auditPlatform(
  db: Database | Transaction,
  actor: Actor | PlatformUserRef,
  record: AuditRecord,
): Promise<void> {
  await db.insert(platformAuditEntries).values({
    ...actorColumns(actor),
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId ?? null,
    reason: record.reason ?? null,
    details: record.details ?? null,
    subjectTenantId: record.subjectTenantId ?? (actor.kind === 'staff' ? actor.tenantId : null),
    requestRoute: record.requestRoute ?? null,
    occurredAt: new Date(),
  });
}
