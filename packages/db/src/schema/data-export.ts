import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, idIsUuidV7, tenantId, timestamptz, updatedAt } from './columns.js';
import { tenants } from './tenancy.js';

/**
 * A restaurant's data exports (module `data-export`, spec S06, ADR 0016, 0037): one row per
 * request, moved in place by the worker through `queued`, `running`, then `ready` or `failed`, and
 * `expired` 7 days after `ready`. Never deleted: the row stays as the record of the export once
 * its file is gone. One export is active (`queued` or `running`) per tenant at a time.
 */
export const dataExports = pgTable(
  'data_exports',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    /** The owner's account. */
    requestedBy: uuid().notNull(),
    status: text().notNull().default('queued'),
    formatVersion: integer().notNull().default(1),
    requestedAt: timestamptz().notNull(),
    startedAt: timestamptz(),
    finishedAt: timestamptz(),
    /** The snapshot's instant: the start of the job's read transaction. */
    asOf: timestamptz(),
    /** `finished_at + 7 days`, exactly when `ready` (and kept once `expired`). */
    expiresAt: timestamptz(),
    /** `too_large`, `timed_out` or `server_error`, exactly when `failed`. */
    failure: text(),
    fileName: text(),
    byteSize: bigint({ mode: 'number' }),
    /** Hex SHA-256 of the whole file. */
    sha256: text(),
    /** `{ "<file>": <rows> }`, as in the manifest. */
    rowCounts: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('data_exports', t.id),
    // Parent of the composite keys `(tenant id, export id)` of the chunks and links.
    unique('data_exports_tenant_id_id_unique').on(t.tenantId, t.id),
    index('data_exports_tenant_requested_idx').on(t.tenantId, t.requestedAt),
    // Rule 7: one active export per tenant.
    uniqueIndex('data_exports_one_active_idx')
      .on(t.tenantId)
      .where(sql`${t.status} in ('queued', 'running')`),
    // The expiry job's claim across tenants (rule 14).
    index('data_exports_expiry_idx').on(t.expiresAt).where(sql`${t.status} = 'ready'`),
    check(
      'data_exports_status',
      sql`${t.status} in ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    check('data_exports_format_version', sql`${t.formatVersion} = 1`),
    check(
      'data_exports_failure',
      sql`(${t.status} = 'failed') = (${t.failure} is not null) and (${t.failure} is null or ${t.failure} in ('too_large', 'timed_out', 'server_error'))`,
    ),
    check(
      'data_exports_started',
      sql`(${t.status} <> 'queued' or ${t.startedAt} is null) and (${t.status} not in ('running', 'ready', 'expired') or ${t.startedAt} is not null)`,
    ),
    check(
      'data_exports_file',
      sql`(${t.status} in ('ready', 'expired')) = (${t.expiresAt} is not null and ${t.fileName} is not null and ${t.byteSize} is not null and ${t.sha256} is not null and ${t.rowCounts} is not null)`,
    ),
    check(
      'data_exports_finished',
      sql`${t.status} not in ('ready', 'expired', 'failed') or ${t.finishedAt} is not null`,
    ),
    check(
      'data_exports_as_of',
      sql`${t.status} not in ('ready', 'expired') or ${t.asOf} is not null`,
    ),
    check(
      'data_exports_expires_at',
      sql`${t.expiresAt} is null or ${t.expiresAt} = ${t.finishedAt} + interval '7 days'`,
    ),
    check('data_exports_byte_size', sql`${t.byteSize} between 0 and 1073741824`),
    check('data_exports_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'data_exports_file_name',
      sql`${t.fileName} ~ '^vertex-food-[a-z0-9-]+-[0-9]{8}-[0-9]{4}\\.zip$'`,
    ),
    check('data_exports_row_counts', sql`jsonb_typeof(${t.rowCounts}) = 'object'`),
  ],
);

/**
 * The bytes of an export's ZIP, in 1 MiB chunks in order (`seq` from 0), written by the build job
 * as it streams the file. The one tenant table whose rows are deleted once they served their
 * purpose: the jobs role deletes an export's chunks when it expires, fails or is rebuilt (rules
 * 12, 14, 15). Never updated (trigger); the app role only reads them, for downloads.
 */
export const dataExportChunks = pgTable(
  'data_export_chunks',
  {
    id: id(),
    tenantId: tenantId(),
    exportId: uuid().notNull(),
    seq: integer().notNull(),
    bytes: bytea().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('data_export_chunks', t.id),
    foreignKey({
      name: 'data_export_chunks_export_fk',
      columns: [t.tenantId, t.exportId],
      foreignColumns: [dataExports.tenantId, dataExports.id],
    }),
    unique('data_export_chunks_tenant_export_seq_unique').on(t.tenantId, t.exportId, t.seq),
    check('data_export_chunks_seq', sql`${t.seq} >= 0`),
    check('data_export_chunks_size', sql`octet_length(${t.bytes}) between 1 and 1048576`),
  ],
);

/**
 * Download links of a ready export (rule 16): a random 32-byte token in the path, stored only as
 * its keyed hash (HMAC-SHA-256 under `IDENTITY_HASH_KEY`), valid 10 minutes. Append-only: each
 * link is the record of a download the owner asked for. The public file route finds a link by its
 * hash alone through `data_export_link_lookup`, then reads the export inside its tenant.
 */
export const dataExportLinks = pgTable(
  'data_export_links',
  {
    id: id(),
    tenantId: tenantId(),
    exportId: uuid().notNull(),
    /** The owner's account. */
    createdBy: uuid().notNull(),
    tokenHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('data_export_links', t.id),
    foreignKey({
      name: 'data_export_links_export_fk',
      columns: [t.tenantId, t.exportId],
      foreignColumns: [dataExports.tenantId, dataExports.id],
    }),
    index('data_export_links_tenant_export_idx').on(t.tenantId, t.exportId),
    unique('data_export_links_token_hash_unique').on(t.tokenHash),
    check('data_export_links_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'data_export_links_expires_at',
      sql`${t.expiresAt} = ${t.createdAt} + interval '10 minutes'`,
    ),
  ],
);
