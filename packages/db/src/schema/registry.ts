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
 * - `state`: `created_at` and `updated_at`; one current row per subject, upserted in place (a PC's
 *   sync state, a branch's connectivity, a tenant's agreement and entitlements), or a record whose
 *   status moves in place and is never archived (an agreement amendment); never deleted.
 * - `replaceable`: `created_at` only; rows with no identity of their own, replaced as a set by
 *   deleting and inserting in one audited transaction (a branch's weekly hours). The app role may
 *   delete from every one.
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 */
export const tableRegistry = {
  account_tenant_links: { module: 'access', scope: 'platform', kind: 'business' },
  accounts: { module: 'identity', scope: 'platform', kind: 'business' },
  agreement_amendments: { module: 'commercial', scope: 'platform', kind: 'state' },
  agreement_templates: { module: 'commercial', scope: 'platform', kind: 'business' },
  agreement_term_endings: { module: 'commercial', scope: 'platform', kind: 'append-only' },
  agreement_terms: { module: 'commercial', scope: 'platform', kind: 'append-only' },
  agreements: { module: 'commercial', scope: 'platform', kind: 'state' },
  attention_items: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  attention_resolutions: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  audit_entries: { module: 'audit', scope: 'tenant', kind: 'append-only' },
  branch_ca_keys: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  branch_certificate_authorities: { module: 'sync', scope: 'tenant', kind: 'business' },
  branch_charges: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  branch_connectivity: { module: 'sync', scope: 'tenant', kind: 'state' },
  branch_connectivity_changes: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  branch_entitlements: { module: 'entitlements', scope: 'tenant', kind: 'state' },
  branch_hour_exceptions: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  branch_hours: { module: 'tenancy', scope: 'tenant', kind: 'replaceable' },
  branches: { module: 'tenancy', scope: 'tenant', kind: 'business' },
  cities: { module: 'areas', scope: 'platform', kind: 'business' },
  command_log: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  command_payloads: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  command_replays: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  device_certificates: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  device_sync_states: { module: 'sync', scope: 'tenant', kind: 'state' },
  devices: { module: 'identity', scope: 'tenant', kind: 'business' },
  entitlement_exceptions: { module: 'entitlements', scope: 'platform', kind: 'append-only' },
  entitlement_override_revocations: { module: 'entitlements', scope: 'platform', kind: 'append-only' },
  entitlement_overrides: { module: 'entitlements', scope: 'platform', kind: 'append-only' },
  entitlement_states: { module: 'entitlements', scope: 'platform', kind: 'state' },
  files: { module: 'files', scope: 'tenant', kind: 'business' },
  governorates: { module: 'areas', scope: 'platform', kind: 'business' },
  membership_access_snapshots: { module: 'access', scope: 'tenant', kind: 'append-only' },
  number_blocks: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  otp_challenges: { module: 'identity', scope: 'platform', kind: 'queue' },
  outbox_events: { module: 'events', scope: 'tenant', kind: 'queue' },
  packages: { module: 'commercial', scope: 'platform', kind: 'business' },
  personal_devices: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_audit_entries: { module: 'audit', scope: 'platform', kind: 'append-only' },
  platform_sessions: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_user_recovery_codes: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_users: { module: 'identity', scope: 'platform', kind: 'business' },
  quarantine_batches: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  quarantine_commands: { module: 'sync', scope: 'tenant', kind: 'append-only' },
  quarantine_decisions: { module: 'sync', scope: 'tenant', kind: 'append-only' },
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

export type TableKind = 'business' | 'append-only' | 'queue' | 'state' | 'replaceable';

export type TableInfo = { module: string; scope: TableScope; kind: TableKind };
