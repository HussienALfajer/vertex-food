import { type AnyColumn, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cities } from './areas.js';
import {
  archivedAt,
  createdAt,
  id,
  idIsUuidV7,
  tenantId,
  timestamptz,
  updatedAt,
} from './columns.js';
import { files } from './files.js';

// Currency codes of `currencies` in @vertex-food/contracts (ADR 0014).
const CURRENCIES = sql.raw(`'USD', 'TRY', 'SYP'`);

// The shapes the contracts check, held by the database too (S01 audit A08): another writer (the
// CLI, a later module, a hand-written fix) cannot store what the API would refuse.

/** Latin names: trimmed, Latin letters, digits, spaces and `& ' . -` (`nameLatinSchema`). */
const latinName = (column: AnyColumn, max: number, extra = '') =>
  sql`char_length(${column}) between 2 and ${sql.raw(String(max))} and ${column} = btrim(${column}) and ${column} ~ ${sql.raw(`'^[A-Za-z0-9 &''.${extra}-]+$'`)}`;

/** `HH:MM` wall-clock times: whole minutes, no seconds (`timeOfDaySchema`). */
const wholeMinutes = (column: AnyColumn) => sql`extract(second from ${column}) = 0`;

const TIME_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';

/**
 * The tenant catalog (ADR 0004, spec S01): one row per restaurant. Platform scope, no RLS: its id
 * is the tenant id of every tenant row. Only the tenancy module reads or writes it; restaurant
 * routes read only the session tenant's row. The worker's `tenancy/apply-scheduled-status` job
 * reads it and writes the status columns as the jobs role.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    nameAr: text().notNull(),
    nameLatin: text(),
    /** Pre-fills new branches only. */
    defaultCurrency: text().notNull(),
    status: text().notNull().default('onboarding'),
    /** `non_payment`, `abuse`, `other`: exactly while suspended or closed. */
    statusReason: text(),
    statusChangedAt: timestamptz().notNull().defaultNow(),
    /** A suspension or closure waiting for the end of the business day (rule 6). */
    scheduledStatus: text(),
    scheduledStatusReason: text(),
    scheduledStatusAt: timestamptz(),
    onboardingCompletedAt: timestamptz(),
    /** Set on the first activation; never cleared. */
    activatedAt: timestamptz(),
    closedAt: timestamptz(),
    logoFileId: uuid(),
    coverFileId: uuid(),
    /** `pool` (shared database) in V1; the silo option of ADR 0004 comes later. */
    dataLocation: text().notNull().default('pool'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Set on closure. */
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('tenants', t.id),
    check('tenants_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check('tenants_name_latin', latinName(t.nameLatin, 100)),
    check('tenants_default_currency', sql`${t.defaultCurrency} in (${CURRENCIES})`),
    check('tenants_status', sql`${t.status} in ('onboarding', 'active', 'suspended', 'closed')`),
    check(
      'tenants_status_reason',
      sql`(${t.statusReason} is not null) = (${t.status} in ('suspended', 'closed')) and (${t.statusReason} is null or ${t.statusReason} in ('non_payment', 'abuse', 'other'))`,
    ),
    check(
      'tenants_scheduled_status',
      sql`(${t.scheduledStatus} is null or ${t.scheduledStatus} in ('suspended', 'closed')) and (${t.scheduledStatus} is null) = (${t.scheduledStatusReason} is null) and (${t.scheduledStatus} is null) = (${t.scheduledStatusAt} is null) and (${t.scheduledStatusReason} is null or ${t.scheduledStatusReason} in ('non_payment', 'abuse', 'other'))`,
    ),
    check('tenants_closed', sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    check(
      'tenants_closed_is_archived',
      sql`(${t.status} = 'closed') = (${t.archivedAt} is not null)`,
    ),
    check(
      'tenants_activated',
      sql`${t.status} not in ('active', 'suspended') or ${t.activatedAt} is not null`,
    ),
    check(
      'tenants_activation_after_onboarding',
      sql`${t.activatedAt} is null or ${t.onboardingCompletedAt} is not null`,
    ),
    check('tenants_data_location', sql`${t.dataLocation} = 'pool'`),
    // The logo and cover belong to the tenant itself: PostgreSQL checks keys without RLS.
    foreignKey({
      name: 'tenants_logo_file_fk',
      columns: [t.id, t.logoFileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'tenants_cover_file_fk',
      columns: [t.id, t.coverFileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    index('tenants_logo_file_idx').on(t.id, t.logoFileId),
    index('tenants_cover_file_idx').on(t.id, t.coverFileId),
    index('tenants_status_idx').on(t.status),
    // The scheduled-status job's scan.
    index('tenants_scheduled_status_idx')
      .on(t.scheduledStatusAt)
      .where(isNotNull(t.scheduledStatus)),
  ],
);

/**
 * A tenant's slugs (spec S01 rule 10): exactly one primary; an old slug stays an alias of its
 * tenant forever, so printed QR codes keep working (S15 redirects it). Never deleted, archived or
 * reassigned: `archived_at` exists for the business-table shape and is never set.
 */
export const tenantSlugs = pgTable(
  'tenant_slugs',
  {
    id: id(),
    slug: text().notNull(),
    /** The tenant the slug names; platform data, so not called `tenant_id` (no RLS here). */
    subjectTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    isPrimary: boolean().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('tenant_slugs', t.id),
    unique('tenant_slugs_slug_unique').on(t.slug),
    check(
      'tenant_slugs_slug',
      sql`${t.slug} ~ '^[a-z]([a-z0-9]|-(?=[a-z0-9])){2,29}$' and ${t.archivedAt} is null`,
    ),
    uniqueIndex('tenant_slugs_primary_idx').on(t.subjectTenantId).where(sql`${t.isPrimary}`),
    index('tenant_slugs_tenant_idx').on(t.subjectTenantId, t.createdAt),
  ],
);

/** A branch of a restaurant (ADR 0004, spec S01). Tenant data; archived, never deleted. */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    nameAr: text().notNull(),
    nameLatin: text(),
    /** The branch segment of QR links (ADR 0015); set at creation, never changed. */
    code: text().notNull(),
    /** Required for onboarding completion; an archived city stays valid here. */
    cityId: uuid().references(() => cities.id),
    addressDescription: text(),
    /** Degrees × 10⁷ (no floats, ADR 0020); both or neither. */
    latitudeE7: integer('latitude_e7'),
    longitudeE7: integer('longitude_e7'),
    /** 0–3 `{ phone, whatsapp }`, phone in E.164, checked by the contract. */
    contactPhones: jsonb().notNull().default([]),
    /** Prices the menu (S07); changing it never converts any amount (ADR 0014). */
    defaultCurrency: text().notNull(),
    acceptedCurrencies: text().array().notNull(),
    /** Set by S09 with the first real order; the default currency is fixed after it. */
    currencyLockedAt: timestamptz(),
    /** Damascus wall clock; on the hour or half hour between 00:00 and 08:00. */
    businessDayEndsAt: time().notNull().default('04:00'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('branches', t.id),
    // Parent of composite keys from other tenant tables, `(tenant_id, branch_id)`.
    unique('branches_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('branches_tenant_code_unique').on(t.tenantId, t.code),
    uniqueIndex('branches_tenant_name_ar_idx').on(t.tenantId, t.nameAr).where(isNull(t.archivedAt)),
    check('branches_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check('branches_name_latin', latinName(t.nameLatin, 100)),
    check('branches_code', sql`${t.code} ~ '^[a-z0-9-]{2,20}$'`),
    check(
      'branches_address_description',
      sql`char_length(${t.addressDescription}) between 2 and 300`,
    ),
    check(
      'branches_location',
      sql`(${t.latitudeE7} is null) = (${t.longitudeE7} is null) and ${t.latitudeE7} between -900000000 and 900000000 and ${t.longitudeE7} between -1800000000 and 1800000000`,
    ),
    // Up to three `{ phone, whatsapp }` with an E.164 phone, none twice (`contactPhonesSchema`).
    check(
      'branches_contact_phones',
      sql`jsonb_typeof(${t.contactPhones}) = 'array' and jsonb_array_length(${t.contactPhones}) <= 3 and not jsonb_path_exists(${t.contactPhones}, ${sql.raw(`'lax $[*] ? (@.type() != "object" || !(@.phone.type() == "string") || !(@.phone like_regex "^[+][1-9][0-9]{7,14}$") || !(@.whatsapp.type() == "boolean"))'`)}) and coalesce(${t.contactPhones}->0->>'phone' <> ${t.contactPhones}->1->>'phone', true) and coalesce(${t.contactPhones}->0->>'phone' <> ${t.contactPhones}->2->>'phone', true) and coalesce(${t.contactPhones}->1->>'phone' <> ${t.contactPhones}->2->>'phone', true)`,
    ),
    // Accepted currencies are distinct: as many as the known codes they contain.
    check(
      'branches_currencies',
      sql`${t.defaultCurrency} in (${CURRENCIES}) and cardinality(${t.acceptedCurrencies}) between 1 and 3 and ${t.acceptedCurrencies} <@ array[${CURRENCIES}] and ${t.defaultCurrency} = any(${t.acceptedCurrencies}) and cardinality(${t.acceptedCurrencies}) = ('USD' = any(${t.acceptedCurrencies}))::int + ('TRY' = any(${t.acceptedCurrencies}))::int + ('SYP' = any(${t.acceptedCurrencies}))::int`,
    ),
    check(
      'branches_business_day_ends_at',
      sql`${t.businessDayEndsAt} between '00:00' and '08:00' and extract(minute from ${t.businessDayEndsAt}) in (0, 30) and extract(second from ${t.businessDayEndsAt}) = 0`,
    ),
    index('branches_tenant_city_idx').on(t.tenantId, t.cityId),
  ],
);

/**
 * The weekly opening periods of a branch (spec S01 rule 12): replaced as a set, so a period has no
 * identity of its own and the app role may delete rows here (and nowhere else); every replacement
 * writes one audit entry with the old and new sets. `weekday` 1 = Saturday … 7 = Friday, the
 * business date the period belongs to.
 */
export const branchHours = pgTable(
  'branch_hours',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    weekday: smallint().notNull(),
    opensAt: time().notNull(),
    closesAt: time().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('branch_hours', t.id),
    foreignKey({
      name: 'branch_hours_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check('branch_hours_weekday', sql`${t.weekday} between 1 and 7`),
    check(
      'branch_hours_period',
      sql`${t.opensAt} <> ${t.closesAt} and ${wholeMinutes(t.opensAt)} and ${wholeMinutes(t.closesAt)}`,
    ),
    index('branch_hours_branch_idx').on(t.tenantId, t.branchId, t.weekday),
  ],
);

/**
 * A dated exception to the weekly hours (spec S01 rule 13): the business date is closed, or opens
 * with 1–2 periods `{ opensAt, closesAt }`. Removing one archives it.
 */
export const branchHourExceptions = pgTable(
  'branch_hour_exceptions',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    date: date().notNull(),
    closed: boolean().notNull(),
    periods: jsonb().notNull().default([]),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('branch_hour_exceptions', t.id),
    foreignKey({
      name: 'branch_hour_exceptions_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check(
      'branch_hour_exceptions_periods',
      sql`jsonb_typeof(${t.periods}) = 'array' and jsonb_array_length(${t.periods}) <= 2 and ${t.closed} = (jsonb_array_length(${t.periods}) = 0) and not jsonb_path_exists(${t.periods}, ${sql.raw(`'lax $[*] ? (@.type() != "object" || !(@.opensAt.type() == "string") || !(@.closesAt.type() == "string") || !(@.opensAt like_regex "${TIME_PATTERN}") || !(@.closesAt like_regex "${TIME_PATTERN}") || @.opensAt == @.closesAt)'`)})`,
    ),
    check('branch_hour_exceptions_note', sql`char_length(${t.note}) between 1 and 100`),
    uniqueIndex('branch_hour_exceptions_date_idx')
      .on(t.tenantId, t.branchId, t.date)
      .where(isNull(t.archivedAt)),
    index('branch_hour_exceptions_branch_idx').on(t.tenantId, t.branchId, t.date),
  ],
);

/**
 * Tax and service charge lines of a branch (spec S01 rule 15), at most 3 not archived. Edited in
 * place: orders snapshot their adjustments (ADR 0007), and every change is audited. How amounts
 * are computed is S10's.
 */
export const branchCharges = pgTable(
  'branch_charges',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid().notNull(),
    /** `tax` or `service`. */
    kind: text().notNull(),
    nameAr: text().notNull(),
    nameLatin: text(),
    /** Basis points, 1–5000; never a float. */
    rateBp: integer().notNull(),
    /** `inclusive` (inside the prices) or `added` (on top). */
    mode: text().notNull(),
    orderTypes: text().array().notNull(),
    position: smallint().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('branch_charges', t.id),
    foreignKey({
      name: 'branch_charges_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    check('branch_charges_kind', sql`${t.kind} in ('tax', 'service')`),
    check('branch_charges_mode', sql`${t.mode} in ('inclusive', 'added')`),
    check('branch_charges_name_ar', sql`char_length(${t.nameAr}) between 2 and 40`),
    check('branch_charges_name_latin', latinName(t.nameLatin, 40, '%')),
    check('branch_charges_rate_bp', sql`${t.rateBp} between 1 and 5000`),
    check(
      'branch_charges_order_types',
      sql`cardinality(${t.orderTypes}) between 1 and 4 and ${t.orderTypes} <@ array['dine_in', 'takeaway', 'delivery', 'pickup']`,
    ),
    check('branch_charges_position', sql`${t.position} between 1 and 3`),
    index('branch_charges_branch_idx').on(t.tenantId, t.branchId, t.position),
    // One line per position among those in force: with positions 1–3, at most three (rule 15).
    uniqueIndex('branch_charges_position_idx')
      .on(t.tenantId, t.branchId, t.position)
      .where(isNull(t.archivedAt)),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
