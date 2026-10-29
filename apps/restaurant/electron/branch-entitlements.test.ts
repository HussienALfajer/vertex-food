import { afterEach, describe, expect, it } from 'vitest';
import { branchEntitlementsView, readBranchEntitlements } from './branch-entitlements.js';
import { tempFolder } from './device-test-kit.js';
import { generateDatabaseKey, type OpenedDatabase, openLocalDatabase } from './local-db.js';
import { uuidv7 } from './uuid.js';

// The branch's entitlement copy on the real encrypted database (spec S05 rules 18, 24, 26): the
// row as the stream writes it, read offline, and the 7-day lease from the last sync.

const opened: OpenedDatabase[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
});

async function database(): Promise<OpenedDatabase> {
  const result = await openLocalDatabase(tempFolder(), generateDatabaseKey());
  opened.push(result);
  return result;
}

/** A checkpoint's row: `jsonb` as JSON text and `timestamptz` as PowerSync gives them. */
async function syncRow(
  local: OpenedDatabase,
  row: { version: number; features: string; limits: string; updatedAt: string },
): Promise<void> {
  await local.db?.execute(
    `INSERT INTO branch_entitlements (id, version, features, limits, valid_until, lease_days,
       updated_at) VALUES (?, ?, ?, ?, NULL, 7, ?)`,
    [uuidv7(), row.version, row.features, row.limits, row.updatedAt],
  );
}

describe('the branch entitlement copy', () => {
  it('is null before the stream brought a row', async () => {
    const local = await database();
    expect(await readBranchEntitlements(local.reads)).toBeNull();
  });

  it('reads the synced row: entitled keys with their removal time, and the set limits', async () => {
    const local = await database();
    await syncRow(local, {
      version: 4,
      features: JSON.stringify([
        { key: 'pos', until: null },
        { key: 'waiter_app', until: '2026-11-30T01:00:00.000Z' },
      ]),
      limits: JSON.stringify({ branches: 2, devices: 3 }),
      updatedAt: '2026-10-29 07:42:00.123Z',
    });
    expect(await readBranchEntitlements(local.reads)).toEqual({
      version: 4,
      features: [
        { key: 'pos', until: null },
        { key: 'waiter_app', until: '2026-11-30T01:00:00.000Z' },
      ],
      limits: { branches: 2, devices: 3 },
      updatedAt: '2026-10-29T07:42:00.123Z',
    });
  });

  it('reads a row it cannot parse as no copy, so the hub refuses rather than guesses', async () => {
    const local = await database();
    await syncRow(local, {
      version: 1,
      features: '{"pos": true',
      limits: '{}',
      updatedAt: '2026-10-29 07:42:00Z',
    });
    expect(await readBranchEntitlements(local.reads)).toBeNull();
  });

  it('expires the lease 7 days after the last sync and keeps the copy', () => {
    const copy = {
      version: 1,
      features: [{ key: 'pos', until: null }],
      limits: {},
      updatedAt: null,
    };
    const synced = '2026-10-20T09:00:00.000Z';
    const sevenDays = new Date('2026-10-27T09:00:00.000Z');
    expect(branchEntitlementsView(copy, synced, sevenDays)).toEqual({
      copy,
      lastSyncedAt: synced,
      leaseExpired: false,
    });
    expect(
      branchEntitlementsView(copy, synced, new Date(sevenDays.getTime() + 1)).leaseExpired,
    ).toBe(true);
    // A PC that never synced has no lease: the banner asks it to connect.
    expect(branchEntitlementsView(null, null, sevenDays)).toEqual({
      copy: null,
      lastSyncedAt: null,
      leaseExpired: true,
    });
  });
});
