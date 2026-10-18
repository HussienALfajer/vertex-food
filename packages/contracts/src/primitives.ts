import { z } from 'zod';

/**
 * Shapes every module reuses (ADR 0020): ids, instants, coordinates, and the list query and page.
 */

/**
 * A record id: a UUIDv7, made by the device that creates the record (ADR 0008) or by the server.
 * The database refuses any other version.
 */
export const idSchema = z.uuidv7().meta({ id: 'Id' });

export type Id = z.infer<typeof idSchema>;

/**
 * A point in time on the wire: ISO 8601 in UTC with the `Z` suffix (`2026-10-19T08:30:00.000Z`).
 * Stored as `timestamptz`; shown in `Asia/Damascus` by the front ends.
 */
export const instantSchema = z.iso.datetime().meta({ id: 'Instant' });

export type Instant = z.infer<typeof instantSchema>;

/**
 * A point on the map in degrees × 10⁷, as integers (ADR 0020: no floats in stored data). Seven
 * decimals locate a point to about one centimetre, more than any map pin needs.
 */
export const coordinatesSchema = z
  .object({
    latitudeE7: z.int().min(-900_000_000).max(900_000_000),
    longitudeE7: z.int().min(-1_800_000_000).max(1_800_000_000),
  })
  .meta({ id: 'Coordinates' });

export type Coordinates = z.infer<typeof coordinatesSchema>;

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;

export const sortOrderSchema = z.enum(['asc', 'desc']).meta({ id: 'SortOrder' });

/**
 * The query of a list endpoint (ADR 0020): `page` from 1, `pageSize` (default 50, max 100), `sort`
 * among the keys the list allows, `order`. Query strings arrive as text, so numbers are coerced.
 * A module extends the result with its named filters and gives it its own `.meta({ id })`.
 */
export function listQuerySchema<const Key extends string>(sortKeys: readonly [Key, ...Key[]]) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    sort: z.enum(sortKeys).optional(),
    order: sortOrderSchema.default('asc'),
  });
}

/** The answer of a list endpoint (ADR 0020): `{ items, total, page, pageSize }`. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    total: z.int().min(0),
    page: z.int().min(1),
    pageSize: z.int().min(1).max(PAGE_SIZE_MAX),
  });
}
