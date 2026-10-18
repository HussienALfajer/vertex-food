import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditEntries, type Database, withTenant } from '../src/index.js';
import { connect, refusal } from './connections.js';

const { owner, app } = connect();
const tenant = uuidv7();
let entryId: string;

const entry = {
  tenantId: tenant,
  actorKind: 'staff',
  actorId: uuidv7(),
  action: 'payment.voided',
  entityType: 'payment',
  entityId: uuidv7(),
  occurredAt: new Date('2026-10-19T08:00:00Z'),
};

beforeAll(async () => {
  const [row] = await withTenant(app, tenant, (tx) =>
    tx.insert(auditEntries).values(entry).returning({ id: auditEntries.id }),
  );
  if (!row) throw new Error('no audit entry inserted');
  entryId = row.id;
});

const update = (db: Database) =>
  withTenant(db, tenant, (tx) =>
    tx.update(auditEntries).set({ action: 'changed' }).where(eq(auditEntries.id, entryId)),
  );
const remove = (db: Database) =>
  withTenant(db, tenant, (tx) => tx.delete(auditEntries).where(eq(auditEntries.id, entryId)));

describe('audit_entries', () => {
  it('stores a UUIDv7 id made by the application', async () => {
    const [row] = await withTenant(app, tenant, (tx) =>
      tx
        .select({ version: sql<number>`uuid_extract_version(${auditEntries.id})` })
        .from(auditEntries)
        .where(eq(auditEntries.id, entryId)),
    );
    expect(row?.version).toBe(7);
  });

  it('refuses an id that is not a UUIDv7 and an unknown actor kind', async () => {
    expect(
      await refusal(
        withTenant(app, tenant, (tx) => tx.insert(auditEntries).values({ ...entry, id: uuidv4() })),
      ),
    ).toMatch(/audit_entries_id_is_uuidv7/);
    expect(
      await refusal(
        withTenant(app, tenant, (tx) =>
          tx.insert(auditEntries).values({ ...entry, actorKind: 'robot' }),
        ),
      ),
    ).toMatch(/audit_entries_actor_kind/);
  });

  it('refuses UPDATE and DELETE by the app role, which has no such privilege', async () => {
    expect(await refusal(update(app))).toMatch(/permission denied/);
    expect(await refusal(remove(app))).toMatch(/permission denied/);
  });

  it('refuses UPDATE, DELETE and TRUNCATE by the owner role, through the trigger', async () => {
    expect(await refusal(update(owner))).toBe('audit_entries is append-only: UPDATE refused');
    expect(await refusal(remove(owner))).toBe('audit_entries is append-only: DELETE refused');
    expect(await refusal(owner.execute(sql`truncate audit_entries`))).toBe(
      'audit_entries is append-only: TRUNCATE refused',
    );
  });

  it('keeps the entry unchanged', async () => {
    const rows = await withTenant(owner, tenant, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.id, entryId)),
    );
    expect(rows).toEqual([expect.objectContaining({ ...entry, id: entryId })]);
  });
});
