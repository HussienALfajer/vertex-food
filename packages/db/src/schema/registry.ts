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
 * - `blob`: `created_at` only; the bytes of a file built by a job, never updated (trigger), deleted
 *   only by the jobs role once they served their purpose (an export's chunks, spec S06).
 *
 * Export (spec S06): every tenant table declares what the restaurant's data export does with it,
 * `{ dataset }` (the CSV file stem that holds its rows, `packages/db/src/exports/`) or
 * `{ excluded }` (why it is left out). A platform table read through a tenant route's view is
 * declared on the dataset that reads it, never exported raw.
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 */
const SECRETS = 'secrets and credentials (sign-ins are in the audit log)';
const SYNC =
  'sync mechanics: the records the commands produce are in their own datasets, quarantine reviews in the audit log';
const DERIVED = 'a derived copy of the staff or entitlements dataset';
const OWN = "the export's own records (the requests are in the audit log)";

export const tableRegistry = {
  account_tenant_links: { module: 'access', scope: 'platform', kind: 'business' },
  accounts: { module: 'identity', scope: 'platform', kind: 'business' },
  agreement_amendments: { module: 'commercial', scope: 'platform', kind: 'state' },
  agreement_templates: { module: 'commercial', scope: 'platform', kind: 'business' },
  agreement_term_endings: { module: 'commercial', scope: 'platform', kind: 'append-only' },
  agreement_terms: { module: 'commercial', scope: 'platform', kind: 'append-only' },
  agreements: { module: 'commercial', scope: 'platform', kind: 'state' },
  attention_items: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { dataset: 'sync_attention' },
  },
  attention_resolutions: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { dataset: 'sync_attention' },
  },
  audit_entries: {
    module: 'audit',
    scope: 'tenant',
    kind: 'append-only',
    export: { dataset: 'audit_log' },
  },
  branch_ca_keys: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SECRETS },
  },
  branch_certificate_authorities: {
    module: 'sync',
    scope: 'tenant',
    kind: 'business',
    export: { excluded: SECRETS },
  },
  branch_charges: {
    module: 'tenancy',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'branch_charges' },
  },
  branch_connectivity: {
    module: 'sync',
    scope: 'tenant',
    kind: 'state',
    export: { excluded: SYNC },
  },
  branch_connectivity_changes: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  branch_entitlements: {
    module: 'entitlements',
    scope: 'tenant',
    kind: 'state',
    export: { excluded: DERIVED },
  },
  branch_hour_exceptions: {
    module: 'tenancy',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'branch_hour_exceptions' },
  },
  branch_hours: {
    module: 'tenancy',
    scope: 'tenant',
    kind: 'replaceable',
    export: { dataset: 'branch_hours' },
  },
  branches: {
    module: 'tenancy',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'branches' },
  },
  cities: { module: 'areas', scope: 'platform', kind: 'business' },
  command_log: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  command_payloads: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  command_replays: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  device_certificates: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SECRETS },
  },
  device_sync_states: {
    module: 'sync',
    scope: 'tenant',
    kind: 'state',
    export: { excluded: SYNC },
  },
  data_export_chunks: {
    module: 'data-export',
    scope: 'tenant',
    kind: 'blob',
    export: { excluded: OWN },
  },
  data_export_links: {
    module: 'data-export',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: OWN },
  },
  data_exports: {
    module: 'data-export',
    scope: 'tenant',
    kind: 'state',
    export: { excluded: OWN },
  },
  devices: {
    module: 'identity',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'devices' },
  },
  entitlement_exceptions: { module: 'entitlements', scope: 'platform', kind: 'append-only' },
  entitlement_override_revocations: {
    module: 'entitlements',
    scope: 'platform',
    kind: 'append-only',
  },
  entitlement_overrides: { module: 'entitlements', scope: 'platform', kind: 'append-only' },
  entitlement_states: { module: 'entitlements', scope: 'platform', kind: 'state' },
  files: {
    module: 'files',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'restaurant' },
  },
  governorates: { module: 'areas', scope: 'platform', kind: 'business' },
  membership_access_snapshots: {
    module: 'access',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: DERIVED },
  },
  number_blocks: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  otp_challenges: { module: 'identity', scope: 'platform', kind: 'queue' },
  outbox_events: {
    module: 'events',
    scope: 'tenant',
    kind: 'queue',
    export: { excluded: 'delivery queue' },
  },
  packages: { module: 'commercial', scope: 'platform', kind: 'business' },
  personal_devices: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_audit_entries: { module: 'audit', scope: 'platform', kind: 'append-only' },
  platform_sessions: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_user_recovery_codes: { module: 'identity', scope: 'platform', kind: 'business' },
  platform_users: { module: 'identity', scope: 'platform', kind: 'business' },
  quarantine_batches: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  quarantine_commands: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  quarantine_decisions: {
    module: 'sync',
    scope: 'tenant',
    kind: 'append-only',
    export: { excluded: SYNC },
  },
  staff_membership_branches: {
    module: 'access',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'staff' },
  },
  staff_memberships: {
    module: 'access',
    scope: 'tenant',
    kind: 'business',
    export: { dataset: 'staff' },
  },
  staff_pins: {
    module: 'identity',
    scope: 'tenant',
    kind: 'business',
    export: { excluded: SECRETS },
  },
  staff_sessions: {
    module: 'identity',
    scope: 'tenant',
    kind: 'business',
    export: { excluded: SECRETS },
  },
  tenant_slugs: { module: 'tenancy', scope: 'platform', kind: 'business' },
  tenants: {
    module: 'tenancy',
    scope: 'platform',
    kind: 'business',
    export: { dataset: 'restaurant' },
  },
  used_tokens: { module: 'identity', scope: 'platform', kind: 'append-only' },
  whatsapp_known_recipients: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_messages: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_opt_outs: { module: 'messaging', scope: 'platform', kind: 'business' },
  whatsapp_session_credentials: { module: 'messaging', scope: 'platform', kind: 'queue' },
  whatsapp_session_events: { module: 'messaging', scope: 'platform', kind: 'append-only' },
  whatsapp_sessions: { module: 'messaging', scope: 'platform', kind: 'business' },
} as const satisfies Record<string, TableInfo>;

export type TableScope = 'tenant' | 'platform';

export type TableKind = 'business' | 'append-only' | 'queue' | 'state' | 'replaceable' | 'blob';

/** What the data export does with a table's rows (spec S06). */
export type TableExport = { dataset: string } | { excluded: string };

export type TableInfo = {
  module: string;
  scope: TableScope;
  kind: TableKind;
  export?: TableExport;
};
