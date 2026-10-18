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
 * - `queue`: `created_at` and `updated_at`; rows change as they are processed (outbox, message
 *   status).
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 */
export const tableRegistry = {
  audit_entries: { module: 'audit', scope: 'tenant', kind: 'append-only' },
  outbox_events: { module: 'events', scope: 'tenant', kind: 'queue' },
} as const satisfies Record<string, TableInfo>;

export type TableScope = 'tenant' | 'platform';

export type TableKind = 'business' | 'append-only' | 'queue';

export type TableInfo = { module: string; scope: TableScope; kind: TableKind };
