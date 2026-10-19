import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, id, idIsUuidV7, tenantId, updatedAt } from './columns.js';
import { tenants } from './tenancy.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Images a tenant uploads (module `files`, spec S01): the logo and the cover, re-encoded by the API
 * (metadata stripped). In PostgreSQL, so they are backed up with the database and need no object
 * store until hosting is decided (Q1); Vertex Shifa's `tenant_logos`, generalized. A replacement
 * archives the previous file in the same transaction; files are never deleted.
 */
export const files = pgTable(
  'files',
  {
    id: id(),
    // Typed as any column: `tenants` refers back to this table for its logo and cover.
    tenantId: tenantId().references((): AnyPgColumn => tenants.id),
    /** `logo` or `cover`. */
    purpose: text().notNull(),
    /** `image/png` for a logo, `image/webp` for a cover: what it is served as. */
    mediaType: text().notNull(),
    bytes: bytea().notNull(),
    byteSize: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    /** Hex SHA-256 of `bytes`. */
    sha256: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('files', t.id),
    // Parent of the composite keys `(tenant id, file id)` from `tenants`.
    unique('files_tenant_id_id_unique').on(t.tenantId, t.id),
    check(
      'files_purpose_media_type',
      sql`(${t.purpose} = 'logo' and ${t.mediaType} = 'image/png') or (${t.purpose} = 'cover' and ${t.mediaType} = 'image/webp')`,
    ),
    check(
      'files_byte_size',
      sql`${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and case ${t.purpose} when 'logo' then 262144 else 409600 end`,
    ),
    check(
      'files_dimensions',
      sql`case ${t.purpose} when 'logo' then ${t.width} = 512 and ${t.height} = 512 else ${t.width} = 1600 and ${t.height} = 600 end`,
    ),
    check('files_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    index('files_tenant_purpose_idx').on(t.tenantId, t.purpose, t.createdAt),
  ],
);
