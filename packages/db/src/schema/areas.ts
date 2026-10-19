import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';

/**
 * Governorates of Syria (module `areas`, platform data): public place names for branch addresses
 * (spec S01) and, later, discovery by city. Seeded by a custom migration with fixed UUIDv7 ids;
 * Vertex staff add more with the CLI. Archived, never deleted.
 */
export const governorates = pgTable(
  'governorates',
  {
    id: id(),
    nameAr: text().notNull(),
    nameLatin: text().notNull(),
    /** Display order. */
    position: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('governorates', t.id),
    check('governorates_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check('governorates_name_latin', sql`char_length(${t.nameLatin}) between 2 and 100`),
    unique('governorates_name_ar_unique').on(t.nameAr),
  ],
);

/**
 * Cities of a governorate. An archived city stays valid on the branches that use it but is not
 * offered for new choices (spec S01, edge case 7).
 */
export const cities = pgTable(
  'cities',
  {
    id: id(),
    governorateId: uuid()
      .notNull()
      .references(() => governorates.id),
    nameAr: text().notNull(),
    nameLatin: text().notNull(),
    /** Display order within the governorate. */
    position: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('cities', t.id),
    check('cities_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check('cities_name_latin', sql`char_length(${t.nameLatin}) between 2 and 100`),
    unique('cities_governorate_name_ar_unique').on(t.governorateId, t.nameAr),
    index('cities_governorate_idx').on(t.governorateId, t.position),
  ],
);
