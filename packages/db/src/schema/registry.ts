/**
 * Every table, with the module that owns it (`docs/architecture.md`), its scope and its kind,
 * which decide the conventions it is held to (ADR 0004, ADR 0020).
 *
 * Scope:
 * - `tenant`: tenant data; `tenant_id`, forced RLS, foreign keys to other tenant tables carry it.
 * - `platform`: platform data (customer accounts, the Vertex fleet, agreements, the platform
 *   ledger); no `tenant_id`, reached only through its module.
 *
 * Kind:
 * - `business`: `created_at`, `updated_at`, `archived_at`; archived, never deleted.
 * - `append-only`: `created_at` only; a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE`, and the
 *   app role has no such privileges (audit, payments, refunds, order and job events, ledger
 *   entries, agreement terms, the sync command log).
 * - `queue`: `created_at` and `updated_at`; rows change as they are processed (outbox, the
 *   WhatsApp send queue). The app role deletes only from the queues listed in `APP_DELETES` of the
 *   convention test (spec S03: sent messages after 30 days, a replaced link's store).
 * - `replaceable`: `created_at` only; rows with no identity of their own, replaced as a set by
 *   deleting and inserting in one audited transaction (a branch's weekly hours). The app role may
 *   delete from every one.
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 */
export const tableRegistry = {
  account_tenant_links: { module: 'access', scope: 'platform', kind: 'business' },
  accounts: { module: 'identity', scope: 'platform', kind: 'business' },
  audit_entries: { module: 'audit', scope: 'tenant', kind: 'append-only' },
  branch_charges: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  branch_hour_exceptions: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  branch_hours: { module: 'tenancy', scope: 'tenant', kind: 'replaceable' },
  branches: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  cities: { module: 'areas', scope: 'platform', kind: 'business' },
  devices: { module: 'identity', scope: 'tenant', kind: 'business' },
  files: { module: 'files', scope: 'tenant', kind: 'business' },
  governorates: { module: 'areas', scope: 'platform', kind: 'business' },
  otp_challenges: { module: 'identity', scope: 'platform', kind: 'queue' },
  outbox_events: { module: 'events', scope: 'tenant', kind: 'queue' },
  personal_devices: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_audit_entries: { module: 'audit', scope: 'platform', kind: 'append-only' },
  platform_sessions: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_user_recovery_codes: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_users: { module: 'identity', scope: 'platform', kind: 'business' },
  staff_membership_branches: { module: 'access', scope: 'tenant', kind: 'business' },
  staff_memberships: { module: 'access', scope: 'tenant', kind: 'business' },
  staff_pins: { module: 'identity', scope: 'tenant', kind: 'business' },
  staff_sessions: { module: 'identity', scope: 'tenant', kind: 'business' },
  tenant_slugs: { module: 'tenancy', scope: 'platform', kind: 'business' },
  tenants: { module: 'tenancy', scope: 'platform', kind: 'business' },
  used_tokens: { module: 'identity', scope: 'platform', kind: 'append-only' },
  whatsapp_known_recipients: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_messages: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_opt_outs: { module: 'messaging', scope: 'platform', kind: 'business' },
  whatsapp_session_credentials: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_session_events: { module: 'messaging', scope: 'platform', kind: 'append-only' },
  whatsapp_sessions: { module: 'messaging', scope: 'platform', kind: 'business' },
} as const satisfies Record<string, TableInfo>;

export type TableScope = 'tenant' | 'platform';

export type TableKind = 'business' | 'append-only' | 'queue' | 'replaceable';

export type TableInfo = { module: string; scope: TableScope; kind: TableKind };
