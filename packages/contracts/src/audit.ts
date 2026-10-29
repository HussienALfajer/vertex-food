import { z } from 'zod';
import { staffRoleSchema } from './access.js';
import { idSchema, instantSchema } from './primitives.js';
import { addDays, businessInstant, businessWallClock, type LocalDate, localDateSchema } from './time.js';

/** Which log an action is written to; `both` are S02's owner recoveries (spec S02 rule 43). */
export type AuditLog = 'tenant' | 'platform' | 'both';

/**
 * The categories of the restaurant's audit log (spec S06), its filter chips. `money`,
 * `menu_prices` and `support` get their first actions in S07, S10 and S22.
 */
export const auditCategories = [
  'access',
  'devices',
  'settings',
  'agreement',
  'data',
  'money',
  'menu_prices',
  'support',
] as const;

export const auditCategorySchema = z.enum(auditCategories).meta({ id: 'AuditCategory' });

export type AuditCategory = z.infer<typeof auditCategorySchema>;

export type AuditActionDefinition = {
  log: AuditLog;
  category: AuditCategory;
  /**
   * The keys of `details` the viewer shows (spec S06 rule 5): a key held by `details.before` or
   * `details.after` (objects) shows as before → after, any other as its value. Other keys stay in
   * the row and the export.
   */
  detailFields: readonly string[];
};

function entry(
  log: AuditLog,
  category: AuditCategory,
  detailFields: readonly string[] = [],
): AuditActionDefinition {
  return { log, category, detailFields };
}

const tenant = (category: AuditCategory, detailFields?: readonly string[]) =>
  entry('tenant', category, detailFields);
const platform = (category: AuditCategory, detailFields?: readonly string[]) =>
  entry('platform', category, detailFields);

const branchProfileFields = [
  'changed',
  'nameAr',
  'nameLatin',
  'cityId',
  'addressDescription',
  'location',
  'defaultCurrency',
  'acceptedCurrencies',
];
const accessFields = ['roles', 'branchScope', 'grantedPermissions', 'revokedPermissions'];
const amendmentFields = ['number', 'from', 'to'];
const overrideFields = ['kind', 'featureKey', 'limitKey', 'value', 'startsAt', 'expiresAt'];

/**
 * Every action the audit log records (ADR 0016), as `<entity>.<verb>`, with its log, category and
 * shown detail fields (spec S06). Entries hold ids, codes and the old and new values of settings,
 * never a customer's phone or address or a driver's location. Each spec adds its actions here,
 * with a sentence (`audit:actions.<action>`) and a label per detail field (`audit:fields.<key>`)
 * in `packages/i18n` (rule 20).
 */
export const auditActionCatalog = {
  // S01 tenancy, in the tenant's audit
  'tenant.created': tenant('settings', ['slug']),
  'tenant.profile_updated': tenant('settings', ['nameAr', 'nameLatin', 'defaultCurrency']),
  'tenant.slug_changed': tenant('settings', ['from', 'to']),
  'tenant.status_scheduled': tenant('settings', ['status', 'at']),
  'tenant.status_changed': tenant('settings', ['from', 'to']),
  'tenant.status_schedule_cancelled': tenant('settings', ['status', 'at']),
  'tenant.status_rescheduled': tenant('settings', ['status', 'from', 'to']),
  'tenant.onboarding_completed': tenant('settings'),
  'tenant_logo.replaced': tenant('settings'),
  'tenant_logo.archived': tenant('settings'),
  'tenant_cover.replaced': tenant('settings'),
  'tenant_cover.archived': tenant('settings'),
  'branch.created': tenant('settings', ['code']),
  'branch.updated': tenant('settings', branchProfileFields),
  'branch.archived': tenant('settings'),
  'branch_hours.replaced': tenant('settings', ['businessDayEndsAt', 'periods']),
  'branch_hour_exception.created': tenant('settings', ['date', 'closed', 'periods']),
  'branch_hour_exception.updated': tenant('settings', ['closed', 'periods']),
  'branch_hour_exception.archived': tenant('settings'),
  'branch_charges.replaced': tenant('settings', ['before', 'after']),
  // S01 areas, in the platform audit
  'governorate.created': platform('settings'),
  'city.created': platform('settings'),
  // S02 staff and devices, in the tenant's audit
  'staff.added': tenant('access', ['roles', 'branchScope']),
  'staff.access_changed': tenant('access', accessFields),
  'staff.deactivated': tenant('access'),
  'staff.reactivated': tenant('access', ['roles', 'branchScope']),
  'staff.password_reset_authorized': tenant('access'),
  'staff_pin.set': tenant('access', ['by']),
  'staff_pin.disabled': tenant('access'),
  'device.registered': tenant('devices'),
  'device.renamed': tenant('devices', ['before', 'after']),
  'device.revoked': tenant('devices', ['reason']),
  'device.wiped': tenant('devices'),
  'staff_session.started': tenant('access', ['kind']),
  'staff_session.reauthenticated': tenant('access'),
  'branch.security_updated': tenant('settings', ['idleLockMinutes']),
  // S02 accounts, in the platform audit (support recovery also in each tenant where the account
  // is an owner)
  'account.created': platform('access'),
  'account.password_set': platform('access', ['reset']),
  'account.password_reset_authorized': entry('both', 'access', ['hours']),
  'account.phone_changed': entry('both', 'access'),
  'account.sign_in_locked': platform('access'),
  'personal_device.added': platform('access'),
  'personal_device.revoked': platform('access'),
  // S02 console, in the platform audit
  'console.request': platform('access', ['outcome', 'params']),
  'platform_user.created': platform('access', ['role']),
  'platform_user.updated': platform('access', [
    'role',
    'grantedPermissions',
    'revokedPermissions',
    'status',
  ]),
  'platform_user.disabled': platform('access'),
  'platform_user.reset': platform('access'),
  'platform_user.setup_completed': platform('access'),
  'platform_user.signed_in': platform('access', ['method']),
  'platform_user.signed_out': platform('access'),
  'platform_user.sign_in_failed': platform('access'),
  'platform_user.totp_failed': platform('access'),
  'platform_user.reauthenticated': platform('access'),
  'platform_user.password_changed': platform('access'),
  // S03 platform WhatsApp numbers, in the platform audit
  'whatsapp_session.created': platform('settings'),
  'whatsapp_session.relinked': platform('settings'),
  'whatsapp_session.paused': platform('settings', ['reason']),
  'whatsapp_session.resumed': platform('settings', ['reason']),
  'whatsapp_session.unlinked': platform('settings'),
  // S04 sync and the branch hub, in the tenant's audit
  'branch.hub_roles_changed': tenant('devices', ['hubDeviceId', 'standbyDeviceId', 'reason']),
  'branch_ca.created': tenant('devices', ['fingerprint']),
  'device_certificate.issued': tenant('devices', ['fingerprint']),
  'quarantine_batch.received': tenant('devices', [
    'reason',
    'uploaded',
    'executedElsewhere',
    'refused',
  ]),
  'quarantine_batch.accepted': tenant('devices', ['commands', 'skipped']),
  'quarantine_batch.rejected': tenant('devices'),
  'attention_item.resolved': tenant('devices'),
  // Recorded on a PC, offline too, and uploaded by `audit.record_local_events` (`localEventActions`)
  'hub.promoted': tenant('devices', ['fromEpoch', 'toEpoch', 'manual']),
  'hub.demoted': tenant('devices', ['toEpoch']),
  'hub.rejoined': tenant('devices', ['epoch', 'forwarded']),
  'hub.divergence_adopted': tenant('devices'),
  'hub_pairing.opened': tenant('devices', ['kind']),
  'hub_pairing.paired': tenant('devices', ['kind']),
  'hub_pairing.revoked': tenant('devices'),
  'hub_pairing.expired': tenant('devices'),
  'hub_session.pin_locked': tenant('access'),
  'sync.network_check_run': tenant('devices'),
  'staff_pin.failed_offline': tenant('access'),
  'staff_pin.locked_offline': tenant('access'),
  'staff_pin.reenabled_offline': tenant('access'),
  'staff_approval.granted': tenant('access'),
  // S05 agreements and entitlements, in the platform audit
  'package.created': platform('agreement', ['code', 'features', 'limits']),
  'package.updated': platform('agreement', ['from', 'to']),
  'package.archived': platform('agreement'),
  'agreement_template.created': platform('agreement', ['code', 'chargeTerms']),
  'agreement_template.updated': platform('agreement', ['from', 'to']),
  'agreement_template.archived': platform('agreement'),
  'amendment.created': platform('agreement', ['number']),
  'amendment.updated': platform('agreement', amendmentFields),
  'amendment.submitted': platform('agreement', amendmentFields),
  'amendment.unsubmitted': platform('agreement', amendmentFields),
  'amendment.withdrawn': platform('agreement', amendmentFields),
  'amendment.approved': platform('agreement', ['number']),
  'amendment.rejected': platform('agreement', amendmentFields),
  'entitlement_override.created': platform('agreement', overrideFields),
  'entitlement_override.revoked': platform('agreement', ['revokedAt']),
  // S05, in the tenant's audit (actor kind `platform` or `system`)
  'agreement.amended': tenant('agreement', ['number']),
  'entitlements.overridden': tenant('agreement', ['change', ...overrideFields, 'revokedAt']),
  // S06 data export, in the tenant's audit
  'data_export.requested': tenant('data'),
  'data_export.completed': tenant('data', ['byteSize', 'rowCounts']),
  'data_export.failed': tenant('data', ['failure']),
  'data_export.downloaded': tenant('data'),
  'data_export.expired': tenant('data'),
} as const satisfies Record<string, AuditActionDefinition>;

export type AuditAction = keyof typeof auditActionCatalog;

export const auditActions = Object.keys(auditActionCatalog) as [AuditAction, ...AuditAction[]];

export const auditActionSchema = z.enum(auditActions).meta({ id: 'AuditAction' });

/** The actions a log holds: the tenant's (with `both`) or the platform's (with `both`). */
export function auditActionsOf(log: 'tenant' | 'platform'): AuditAction[] {
  return auditActions.filter((action) => {
    const written = auditActionCatalog[action].log;
    return written === log || written === 'both';
  });
}

/**
 * What a PC records in its `local_events` and uploads with `audit.record_local_events` (spec S04
 * "Audit"): its hub events and S02's offline events, written with their device times and
 * `recorded_offline: true`.
 */
export const localEventActions = [
  'hub.promoted',
  'hub.demoted',
  'hub.rejoined',
  'hub.divergence_adopted',
  'hub_pairing.opened',
  'hub_pairing.paired',
  'hub_pairing.revoked',
  'hub_pairing.expired',
  'hub_session.pin_locked',
  'sync.network_check_run',
  'staff_pin.failed_offline',
  'staff_pin.locked_offline',
  'staff_pin.reenabled_offline',
  'staff_approval.granted',
] as const satisfies readonly AuditAction[];

export const localEventActionSchema = z.enum(localEventActions).meta({ id: 'LocalEventAction' });

export type LocalEventAction = z.infer<typeof localEventActionSchema>;

/**
 * Who did it: restaurant staff, a customer, a driver, Vertex staff in the console, or the system
 * (the CLI, with the operator's name, and the worker's jobs).
 */
export const auditActorKindSchema = z
  .enum(['staff', 'customer', 'driver', 'platform', 'system'])
  .meta({ id: 'AuditActorKind' });

export type AuditActorKind = z.infer<typeof auditActorKindSchema>;


// Reading the logs (spec S06 rules 2–5, 18).

export const AUDIT_PAGE_SIZE = 50;

/** The longest period a log reads at once, in days (rule 2). */
export const AUDIT_MAX_RANGE_DAYS = 366;

/** The period read when the query names none: the last 7 days, today included (rule 2). */
export const AUDIT_DEFAULT_RANGE_DAYS = 7;

/**
 * A page's position: the last entry read, as `<occurredAt ISO>_<id>`. The next page holds the
 * entries strictly before it in (`occurred_at`, `id`) order, so entries arriving meanwhile are
 * never repeated or skipped among those already present (edge case 5).
 */
export const auditCursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f-]{36}$/)
  .meta({ id: 'AuditCursor' });

export type AuditCursor = { occurredAt: Date; id: string };

export function encodeAuditCursor(cursor: AuditCursor): string {
  return `${cursor.occurredAt.toISOString()}_${cursor.id}`;
}

export function decodeAuditCursor(value: string): AuditCursor {
  const [at = '', id = ''] = value.split('_');
  return { occurredAt: new Date(at), id };
}

function rangeWithinLimit(query: { from?: LocalDate | undefined; to?: LocalDate | undefined }): boolean {
  if (!query.from || !query.to) return true;
  const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
  return days >= 0 && days < AUDIT_MAX_RANGE_DAYS;
}

const rangeIssue = { message: 'The period runs backwards or is longer than 366 days', path: ['to'] };

/**
 * The period of a query as instants, `[from, to)`: whole Damascus calendar days from `from` to
 * `to` included, by default the last 7 days to today (rule 2). A missing bound is taken from the
 * other one or from today.
 */
export function auditPeriod(
  query: { from?: LocalDate | undefined; to?: LocalDate | undefined },
  now: Date,
): { from: Date; to: Date } {
  const to = query.to ?? (query.from ? addDays(query.from, AUDIT_DEFAULT_RANGE_DAYS - 1) : null);
  const last = to ?? businessWallClock(now).date;
  const first = query.from ?? addDays(last, -(AUDIT_DEFAULT_RANGE_DAYS - 1));
  return {
    from: businessInstant(first, '00:00'),
    to: businessInstant(addDays(last, 1), '00:00'),
  };
}

/** `?category=a&category=b` arrives as one value or a list. */
const categoryFilterSchema = z.union([auditCategorySchema, z.array(auditCategorySchema).max(8)]);

/** `GET /api/tenant/audit` (rule 2). The tenant comes from the session only. */
export const auditQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    category: categoryFilterSchema.optional(),
    /** Entries about that branch. */
    branchId: idSchema.optional(),
    /** `true`: the entries about no branch (tenant-wide); not with `branchId`. */
    tenantWide: z.enum(['true', 'false']).optional(),
    /** A member, current or former. */
    actorAccountId: idSchema.optional(),
    before: auditCursorSchema.optional(),
  })
  .refine(rangeWithinLimit, rangeIssue)
  .refine((query) => !(query.branchId && query.tenantWide === 'true'), {
    message: 'A branch and tenant-wide exclude each other',
    path: ['tenantWide'],
  })
  .meta({ id: 'AuditQuery' });

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** The categories a query names, as a list (none: every category). */
export function auditQueryCategories(query: Pick<AuditQuery, 'category'>): AuditCategory[] {
  if (!query.category) return [];
  return Array.isArray(query.category) ? query.category : [query.category];
}

/**
 * Who the restaurant's log shows (rule 3): a member, Vertex (a console user or a CLI operator,
 * never named), the system (a job) or a PC acting alone. Customers and drivers arrive with S16
 * and S19.
 */
export const auditShownActorKindSchema = z
  .enum(['staff', 'vertex', 'system', 'device', 'customer', 'driver'])
  .meta({ id: 'AuditShownActorKind' });

export type AuditShownActorKind = z.infer<typeof auditShownActorKindSchema>;

/** The name a job writes as its actor: `<module>/<job>`, such as `tenancy/apply-scheduled-status`. */
export const systemJobNamePattern = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/** The `actor_name` of a PC acting without a member (confirming its wipe). */
export const DEVICE_ACTOR_NAME = 'device';

/**
 * How a stored actor is shown in the restaurant's log (rule 3): a `system` actor is a PC when its
 * name is `device`, a job when its name is a job's, else a CLI operator, shown as Vertex.
 */
export function shownAuditActorKind(actorKind: string, actorName: string | null): AuditShownActorKind {
  switch (actorKind) {
    case 'staff':
    case 'customer':
    case 'driver':
      return actorKind;
    case 'system':
      if (actorName === DEVICE_ACTOR_NAME) return 'device';
      return actorName !== null && systemJobNamePattern.test(actorName) ? 'system' : 'vertex';
    default:
      return 'vertex';
  }
}

/** One shown detail (rule 5): a change from `before` to `after`, or a value. */
export const auditDetailSchema = z
  .object({
    field: z.string().min(1),
    change: z.boolean(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    value: z.unknown().optional(),
  })
  .meta({ id: 'AuditDetail' });

export type AuditDetail = z.infer<typeof auditDetailSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The catalog's detail fields of an entry, in catalog order; absent ones are left out (rule 5). */
export function shownAuditDetails(action: AuditAction, details: unknown): AuditDetail[] {
  if (!isRecord(details)) return [];
  const before = isRecord(details.before) ? details.before : null;
  const after = isRecord(details.after) ? details.after : null;
  const shown: AuditDetail[] = [];
  for (const field of auditActionCatalog[action].detailFields) {
    if ((before && field in before) || (after && field in after)) {
      shown.push({ field, change: true, before: before?.[field], after: after?.[field] });
    } else if (field in details && details[field] !== undefined) {
      shown.push({ field, change: false, value: details[field] });
    }
  }
  return shown;
}

/** An entry of the restaurant's audit log (rules 3–5). */
export const auditEntrySchema = z
  .object({
    id: idSchema,
    action: auditActionSchema,
    category: auditCategorySchema,
    actor: z.object({
      kind: auditShownActorKindSchema,
      /** A member's account; never a Vertex person's or a job's id (rule 3). */
      accountId: idSchema.nullable(),
      /** A member's current name in this tenant, or the PC's name; null for Vertex and jobs. */
      name: z.string().nullable(),
      roles: z.array(staffRoleSchema),
    }),
    /** The entity the entry is about, by type and id, with its name where the route knows it. */
    entity: z.object({
      type: z.string(),
      id: z.uuid().nullable(),
      name: z.string().nullable(),
    }),
    branch: z.object({ id: idSchema, name: z.string(), archived: z.boolean() }).nullable(),
    device: z.object({ id: idSchema, name: z.string().nullable() }).nullable(),
    /** Free text written by staff or Vertex. */
    reason: z.string().nullable(),
    details: z.array(auditDetailSchema),
    /** Recorded on a PC offline and uploaded later (rule 4): `occurredAt` is the PC's time. */
    recordedOffline: z.boolean(),
    occurredAt: instantSchema,
    /** When the server stored it (the upload time of an offline entry). */
    createdAt: instantSchema,
  })
  .meta({ id: 'AuditEntry' });

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z
  .object({
    items: z.array(auditEntrySchema),
    /** The `before` of the next page; null on the last one. */
    nextCursor: auditCursorSchema.nullable(),
  })
  .meta({ id: 'AuditPage' });

export type AuditPage = z.infer<typeof auditPageSchema>;

/** `GET /api/console/audit` (rule 18). */
export const platformAuditQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    actorUserId: idSchema.optional(),
    action: auditActionSchema.optional(),
    subjectTenantId: idSchema.optional(),
    entityId: idSchema.optional(),
    before: auditCursorSchema.optional(),
  })
  .refine(rangeWithinLimit, rangeIssue)
  .meta({ id: 'PlatformAuditQuery' });

export type PlatformAuditQuery = z.infer<typeof platformAuditQuerySchema>;

/** An entry of the platform audit log, for Vertex admins (rule 18). */
export const platformAuditEntrySchema = z
  .object({
    id: idSchema,
    action: auditActionSchema,
    actor: z.object({
      kind: z.enum(['platform', 'staff', 'system']),
      /** A platform user, or a restaurant account changing its own account. */
      id: idSchema.nullable(),
      /** The platform user's or account's name, the CLI operator's or the job's. */
      name: z.string().nullable(),
    }),
    entityType: z.string(),
    entityId: z.uuid().nullable(),
    subjectTenant: z
      .object({ id: idSchema, slug: z.string(), nameAr: z.string() })
      .nullable(),
    /** The console route of a `console.request`, as `METHOD /path/:param`. */
    requestRoute: z.string().nullable(),
    reason: z.string().nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
    occurredAt: instantSchema,
    createdAt: instantSchema,
  })
  .meta({ id: 'PlatformAuditEntry' });

export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;

export const platformAuditPageSchema = z
  .object({
    items: z.array(platformAuditEntrySchema),
    nextCursor: auditCursorSchema.nullable(),
  })
  .meta({ id: 'PlatformAuditPage' });

export type PlatformAuditPage = z.infer<typeof platformAuditPageSchema>;
