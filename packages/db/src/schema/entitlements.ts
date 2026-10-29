import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, idIsUuidV7, tenantId, timestamptz, updatedAt } from './columns.js';
import { devices, platformUsers } from './identity.js';
import { branches, tenants } from './tenancy.js';

// Entitlements (spec S05, ADR 0013, 0036), module `entitlements`: overrides and their revocations,
// the resolved state per tenant, the copy per branch the sync service streams to its PCs, and the
// commands the server accepted although their feature was off. All platform data but
// `branch_entitlements`, the one tenant table, because a branch's PCs read it offline.

const KEY = `'^[a-z][a-z0-9_]{1,39}$'`;

/**
 * An entitlement override (rules 12–14), append-only: a `grant` or `deny` of a feature, or a
 * `limit` value, between `starts_at` and the earlier of its expiry and its revocation. Only a
 * grant (of a private feature, which the API checks) may stay open-ended.
 */
export const entitlementOverrides = pgTable(
  'entitlement_overrides',
  {
    id: id(),
    subjectTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    kind: text().notNull(),
    featureKey: text(),
    limitKey: text(),
    value: integer(),
    reason: text().notNull(),
    startsAt: timestamptz().notNull(),
    expiresAt: timestamptz(),
    createdBy: uuid().references(() => platformUsers.id),
    createdByOperator: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('entitlement_overrides', t.id),
    index('entitlement_overrides_tenant_idx').on(t.subjectTenantId, t.startsAt),
    index('entitlement_overrides_created_by_idx').on(t.createdBy),
    check('entitlement_overrides_kind', sql`${t.kind} in ('grant', 'deny', 'limit')`),
    check(
      'entitlement_overrides_target',
      sql.raw(
        `case when kind = 'limit' then feature_key is null and limit_key ~ ${KEY} and value between 0 and 1000000 else limit_key is null and value is null and feature_key ~ ${KEY} end is true`,
      ),
    ),
    check('entitlement_overrides_reason', sql`char_length(${t.reason}) between 3 and 500`),
    // Rule 12's 366 days, plus the push of the expiry to the next business day end (rule 14).
    check(
      'entitlement_overrides_expiry',
      sql`((${t.expiresAt} is null and ${t.kind} = 'grant') or (${t.expiresAt} > ${t.startsAt} and ${t.expiresAt} <= ${t.startsAt} + interval '367 days')) is true`,
    ),
    check(
      'entitlement_overrides_author',
      sql`(${t.createdBy} is null) <> (${t.createdByOperator} is null)`,
    ),
  ],
);

/** The revocation of an override, once, with its effective time (rule 14). Append-only. */
export const entitlementOverrideRevocations = pgTable(
  'entitlement_override_revocations',
  {
    id: id(),
    overrideId: uuid()
      .notNull()
      .references(() => entitlementOverrides.id),
    /** The effective time: the next business day end for a removal. */
    revokedAt: timestamptz().notNull(),
    reason: text().notNull(),
    revokedBy: uuid().references(() => platformUsers.id),
    revokedByOperator: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('entitlement_override_revocations', t.id),
    unique('entitlement_override_revocations_override_unique').on(t.overrideId),
    index('entitlement_override_revocations_revoked_by_idx').on(t.revokedBy),
    check(
      'entitlement_override_revocations_reason',
      sql`char_length(${t.reason}) between 3 and 500`,
    ),
    check(
      'entitlement_override_revocations_author',
      sql`(${t.revokedBy} is null) <> (${t.revokedByOperator} is null)`,
    ),
  ],
);

/**
 * The resolved entitlements of a tenant (rules 17–19), one row upserted in place: `version` moves
 * with every change of `resolved`, and `valid_until` is the next boundary. The row is also the lock
 * that serializes additions at a limit (rule 21).
 */
export const entitlementStates = pgTable(
  'entitlement_states',
  {
    id: id(),
    subjectTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    version: bigint({ mode: 'number' }).notNull(),
    /** `resolvedEntitlementsSchema`. */
    resolved: jsonb().notNull(),
    validUntil: timestamptz(),
    computedAt: timestamptz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('entitlement_states', t.id),
    unique('entitlement_states_tenant_unique').on(t.subjectTenantId),
    // entitlements/apply-boundaries reads the due states every minute (rule 19).
    index('entitlement_states_due_idx')
      .on(t.validUntil)
      .where(sql`${t.validUntil} is not null`),
    check('entitlement_states_version', sql`${t.version} >= 1`),
    check(
      'entitlement_states_resolved',
      sql.raw(
        `jsonb_typeof(resolved) = 'object' and jsonb_typeof(resolved->'features') = 'array' and jsonb_typeof(resolved->'limits') = 'array'`,
      ),
    ),
  ],
);

/**
 * A branch's copy of its tenant's resolved entitlements (rules 18, 24, 26): the entitled feature
 * keys with `until` when a removal is scheduled, and the set limits. No money term, so PCs never
 * learn prices. Published to the sync service and streamed by tenant and branch.
 */
export const branchEntitlements = pgTable(
  'branch_entitlements',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    version: bigint({ mode: 'number' }).notNull(),
    /** `branchEntitledFeaturesSchema`. */
    features: jsonb().notNull(),
    /** `branchLimitsSchema`. */
    limits: jsonb().notNull(),
    validUntil: timestamptz(),
    /** `ENTITLEMENT_LEASE_DAYS`. */
    leaseDays: smallint().notNull().default(7),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('branch_entitlements', t.id),
    unique('branch_entitlements_branch_unique').on(t.tenantId, t.branchId),
    foreignKey({
      name: 'branch_entitlements_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check('branch_entitlements_version', sql`${t.version} >= 1`),
    check('branch_entitlements_lease_days', sql`${t.leaseDays} between 1 and 30`),
    check(
      'branch_entitlements_features',
      sql.raw(
        `jsonb_typeof(features) = 'array' and not jsonb_path_exists(features, '$[*] ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || !(@.until.type() == "null" || @.until.type() == "string"))')`,
      ),
    ),
    check(
      'branch_entitlements_limits',
      sql.raw(
        `jsonb_typeof(limits) = 'object' and not jsonb_path_exists(limits, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || @.value.type() != "number" || @.value < 0 || @.value != @.value.floor())')`,
      ),
    ),
  ],
);

/**
 * A command the server accepted although its feature was off at its effective time (rule 25), once
 * per command id. Ids and keys only. Append-only.
 */
export const entitlementExceptions = pgTable(
  'entitlement_exceptions',
  {
    id: id(),
    subjectTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    branchId: uuid().notNull(),
    deviceId: uuid().notNull(),
    commandId: uuid().notNull(),
    featureKey: text().notNull(),
    effectiveAt: timestamptz().notNull(),
    recordedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('entitlement_exceptions', t.id),
    unique('entitlement_exceptions_command_unique').on(t.commandId),
    foreignKey({
      name: 'entitlement_exceptions_branch_fk',
      columns: [t.subjectTenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'entitlement_exceptions_device_fk',
      columns: [t.subjectTenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    index('entitlement_exceptions_tenant_idx').on(t.subjectTenantId, t.id),
    index('entitlement_exceptions_branch_idx').on(t.subjectTenantId, t.branchId),
    index('entitlement_exceptions_device_idx').on(t.subjectTenantId, t.deviceId),
    check('entitlement_exceptions_feature', sql.raw(`feature_key ~ ${KEY}`)),
  ],
);
