import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, idIsUuidV7, tenantId, timestamptz } from './columns.js';

/**
 * Append-only audit log of a restaurant (ADR 0016): money (payments, refunds, voids, discounts
 * above limit, cash corrections), prices and menu availability, access and roles, agreements,
 * terms and overrides, settings, support access, and reads of customer lists or exports. Rows are
 * written in the same transaction as the change and are never updated or deleted (triggers and
 * grants in the custom migration). Entries hold ids and codes, never a customer's phone or address
 * or a driver's location.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: id(),
    tenantId: tenantId(),
    actorKind: text().notNull(),
    actorId: uuid(),
    deviceId: uuid(),
    /** What happened, as `<entity>.<verb>`: `payment.voided`, `customer_list.exported`. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    /** Free text written by staff (a void or a correction), so never sent to logs. */
    reason: text(),
    /** When it happened: the device's time for actions recorded offline (ADR 0008). */
    occurredAt: timestamptz().notNull(),
    /** When the server stored it. */
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('audit_entries', t.id),
    check(
      'audit_entries_actor_kind',
      sql`${t.actorKind} in ('staff', 'customer', 'driver', 'platform', 'system')`,
    ),
    index('audit_entries_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
    index('audit_entries_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.occurredAt),
  ],
);
