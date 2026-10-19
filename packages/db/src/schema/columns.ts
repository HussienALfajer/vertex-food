import { type AnyColumn, sql } from 'drizzle-orm';
import { check, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// Shared column helpers (ADR 0020). Column names come from the property names through the
// snake_case casing set in `createDatabase` and `drizzle.config.ts`.

/** UUIDv7 primary key; devices make their own ids (ADR 0008), the server makes the rest. */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * The database refuses any id that is not a UUIDv7; every table adds it. `is true`, because
 * `uuid_extract_version` answers NULL for a non-RFC variant and a check passes on NULL.
 */
export const idIsUuidV7 = (table: string, column: AnyColumn) =>
  check(`${table}_id_is_uuidv7`, sql`(uuid_extract_version(${column}) = 7) is true`);

export const tenantId = () => uuid().notNull();

export const timestamptz = () => timestamp({ withTimezone: true });

export const createdAt = () => timestamptz().notNull().defaultNow();

export const updatedAt = () =>
  timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Business tables: set when the record is archived; records are never deleted (ADR 0016). */
export const archivedAt = () => timestamptz();
