import { describe, expect, it } from 'vitest';
import {
  coordinatesSchema,
  idSchema,
  instantSchema,
  listQuerySchema,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  pageSchema,
} from './primitives.js';

describe('idSchema', () => {
  it('accepts UUIDv7 only', () => {
    expect(idSchema.safeParse('0199f2a4-6b1e-7c3d-8e4f-a1b2c3d4e5f6').success).toBe(true);
    // A version 4 UUID, a nil UUID and text.
    for (const id of [
      '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f',
      '00000000-0000-0000-0000-000000000000',
      'tenant-a',
      '',
    ]) {
      expect(idSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe('instantSchema', () => {
  it('accepts ISO 8601 in UTC only', () => {
    expect(instantSchema.safeParse('2026-10-19T08:30:00.000Z').success).toBe(true);
    expect(instantSchema.safeParse('2026-10-19T08:30:00Z').success).toBe(true);
    for (const value of ['2026-10-19T11:30:00+03:00', '2026-10-19 08:30:00', '2026-10-19']) {
      expect(instantSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('coordinatesSchema', () => {
  it('holds integer degrees × 10⁷ within range', () => {
    // Azaz.
    expect(coordinatesSchema.parse({ latitudeE7: 365_863_000, longitudeE7: 370_448_000 })).toEqual({
      latitudeE7: 365_863_000,
      longitudeE7: 370_448_000,
    });
    for (const point of [
      { latitudeE7: 36.5863, longitudeE7: 370_448_000 },
      { latitudeE7: 900_000_001, longitudeE7: 0 },
      { latitudeE7: 0, longitudeE7: -1_800_000_001 },
    ]) {
      expect(coordinatesSchema.safeParse(point).success).toBe(false);
    }
  });
});

describe('listQuerySchema', () => {
  const query = listQuerySchema(['createdAt', 'name']);

  it('defaults to the first page of 50, ascending', () => {
    expect(query.parse({})).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT, order: 'asc' });
  });

  it('reads numbers from query-string text', () => {
    expect(query.parse({ page: '3', pageSize: '100', sort: 'name', order: 'desc' })).toEqual({
      page: 3,
      pageSize: 100,
      sort: 'name',
      order: 'desc',
    });
  });

  it('refuses a page below 1, a size above 100, an unknown sort key and an unknown order', () => {
    for (const input of [
      { page: '0' },
      { page: '1.5' },
      { page: 'abc' },
      { pageSize: String(PAGE_SIZE_MAX + 1) },
      { pageSize: '0' },
      { sort: 'phone' },
      { order: 'up' },
    ]) {
      expect(query.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

describe('pageSchema', () => {
  it('is items, total, page and pageSize', () => {
    const page = pageSchema(idSchema);
    const items = ['0199f2a4-6b1e-7c3d-8e4f-a1b2c3d4e5f6'];
    expect(page.parse({ items, total: 1, page: 1, pageSize: 50 })).toEqual({
      items,
      total: 1,
      page: 1,
      pageSize: 50,
    });
    expect(page.safeParse({ items, total: -1, page: 1, pageSize: 50 }).success).toBe(false);
    expect(page.safeParse({ items: ['x'], total: 1, page: 1, pageSize: 50 }).success).toBe(false);
  });
});
