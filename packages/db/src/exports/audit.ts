import { type AuditAction, auditActionCatalog, shownAuditActorKind } from '@vertex-food/contracts';
import { asc, gt } from 'drizzle-orm';
import { auditEntries } from '../schema/audit.js';
import { byPages, EXPORT_PAGE_SIZE, type ExportDataset } from './dataset.js';

// The restaurant's audit log (module `audit`, spec S06): every entry, with the actor as the log
// shows it (rule 3): a member's account id, never a Vertex person's or a job's name or id.
// Names are in staff.csv and devices.csv.

function categoryOf(action: string): string | null {
  return action in auditActionCatalog ? auditActionCatalog[action as AuditAction].category : null;
}

export const auditLogDataset: ExportDataset = {
  stem: 'audit_log',
  tables: ['audit_entries'],
  reads: [],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'occurred_at', kind: 'instant' },
    { name: 'recorded_offline', kind: 'boolean' },
    { name: 'created_at', kind: 'instant' },
    { name: 'action', kind: 'text' },
    { name: 'category', kind: 'text' },
    { name: 'actor_kind', kind: 'text' },
    { name: 'actor_account_id', kind: 'text' },
    { name: 'device_id', kind: 'text' },
    { name: 'branch_id', kind: 'text' },
    { name: 'entity_type', kind: 'text' },
    { name: 'entity_id', kind: 'text' },
    { name: 'reason', kind: 'text' },
    { name: 'details', kind: 'text' },
  ],
  async *rows(tx) {
    const pages = byPages((after) =>
      tx
        .select()
        .from(auditEntries)
        .where(after === null ? undefined : gt(auditEntries.id, after))
        .orderBy(asc(auditEntries.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const entry of pages) {
      const actorKind = shownAuditActorKind(entry.actorKind, entry.actorName);
      yield {
        id: entry.id,
        occurred_at: entry.occurredAt,
        recorded_offline: entry.recordedOffline,
        created_at: entry.createdAt,
        action: entry.action,
        category: categoryOf(entry.action),
        actor_kind: actorKind,
        actor_account_id: actorKind === 'staff' ? entry.actorId : null,
        device_id: entry.deviceId,
        branch_id: entry.branchId,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        reason: entry.reason,
        details: entry.details === null ? null : JSON.stringify(entry.details),
      };
    }
  },
};
