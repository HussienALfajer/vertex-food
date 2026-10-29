import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, idIsUuidV7, tenantId, timestamptz } from './columns.js';
import { branches, tenants } from './tenancy.js';

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
    /** For `system` actors: the CLI operator's name or the job's name. */
    actorName: text(),
    deviceId: uuid(),
    /**
     * The branch the change concerns (spec S06): a branch's own settings, a device, a hub event, a
     * change of a member limited to one branch, and from S09 every order, payment and cash action.
     * Null for tenant-wide changes and for the entries written before S06.
     */
    branchId: uuid(),
    /** What happened, as `<entity>.<verb>`: `payment.voided`, `customer_list.exported`. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    /** Free text written by staff (a void or a correction), so never sent to logs. */
    reason: text(),
    /**
     * The values a settings change replaced and set (`{ before, after }`: hours, charge lines,
     * status), ids and codes only, never a customer's phone or address or a driver's location.
     */
    details: jsonb(),
    /** When it happened: the device's time for actions recorded offline (ADR 0008). */
    occurredAt: timestamptz().notNull(),
    /** Recorded on a PC and uploaded later by `audit.record_local_events` (spec S04). */
    recordedOffline: boolean().notNull().default(false),
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
    foreignKey({
      name: 'audit_entries_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    index('audit_entries_tenant_branch_occurred_idx').on(t.tenantId, t.branchId, t.occurredAt),
    index('audit_entries_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.occurredAt),
  ],
);

/**
 * Append-only platform audit log (ADR 0016): changes with no tenant, such as a governorate or city
 * added (spec S01), and from S02 console requests and account-level changes. Same shape as
 * `audit_entries` without `tenant_id`; a console action on a tenant writes that tenant's
 * `audit_entries`.
 */
export const platformAuditEntries = pgTable(
  'platform_audit_entries',
  {
    id: id(),
    /** `platform` (console), `staff` (a person's own account change), `system` (CLI, jobs). */
    actorKind: text().notNull(),
    actorId: uuid(),
    actorName: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    /** Free text written by Vertex staff, so never sent to logs. */
    reason: text(),
    details: jsonb(),
    /** The tenant a console request or an account change concerns (spec S02 rule 43). */
    subjectTenantId: uuid().references(() => tenants.id),
    /** The console route of a `console.request` entry, as `METHOD /path/:param`. */
    requestRoute: text(),
    occurredAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('platform_audit_entries', t.id),
    check(
      'platform_audit_entries_request_route',
      sql`char_length(${t.requestRoute}) between 1 and 200`,
    ),
    index('platform_audit_entries_subject_tenant_idx').on(t.subjectTenantId, t.occurredAt),
    check(
      'platform_audit_entries_actor_kind',
      sql`${t.actorKind} in ('platform', 'staff', 'system')`,
    ),
    index('platform_audit_entries_occurred_idx').on(t.occurredAt),
    index('platform_audit_entries_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
  ],
);
