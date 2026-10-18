import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditEntries, type Database, outboxEvents, withTenant } from '../src/index.js';
import { connect, refusal } from './connections.js';

// What each role can try against the running database, beyond the privileges the convention test
// reads: the app role cannot step around RLS, and the queue and sync roles reach no table.

const { app, queue, sync } = connect();
const DENIED = /permission denied/;
const tenant = uuidv7();

const run = (db: Database, text: string) => db.$client.query(text);

beforeAll(async () => {
  await withTenant(app, tenant, (tx) =>
    tx.insert(auditEntries).values({
      tenantId: tenant,
      actorKind: 'system',
      action: 'test.ran',
      entityType: 'test',
      occurredAt: new Date(),
    }),
  );
});

describe('the app role', () => {
  it('cannot turn row security off: the query fails instead of seeing every tenant', async () => {
    const client = await app.$client.connect();
    try {
      await client.query('set row_security = off');
      expect(await refusal(client.query('select * from audit_entries'))).toMatch(
        /row-level security policy/,
      );
    } finally {
      client.release(true);
    }
  });

  it('cannot disable or drop a policy, a trigger or a table it does not own', async () => {
    for (const statement of [
      'alter table audit_entries disable row level security',
      'alter table audit_entries no force row level security',
      'drop policy tenant_isolation on audit_entries',
      'alter table audit_entries disable trigger audit_entries_refuse_change',
      'drop table outbox_events',
    ]) {
      expect(await refusal(run(app, statement)), statement).toMatch(/must be owner/);
    }
  });

  it('cannot empty a table, which would ignore RLS', async () => {
    expect(await refusal(run(app, 'truncate audit_entries'))).toMatch(DENIED);
    expect(await refusal(run(app, 'truncate outbox_events'))).toMatch(DENIED);
  });

  it('cannot switch to another role or create objects', async () => {
    for (const role of ['food_owner', 'food_jobs', 'food_sync', 'postgres']) {
      expect(await refusal(run(app, `set role ${role}`)), role).toMatch(DENIED);
    }
    expect(await refusal(run(app, 'create table spare (id uuid)'))).toMatch(DENIED);
    expect(await refusal(run(app, 'create schema spare'))).toMatch(DENIED);
    expect(await refusal(run(app, 'create table pgboss.spare (id uuid)'))).toMatch(DENIED);
  });

  it('cannot change the tenant function the policies call', async () => {
    expect(
      await refusal(
        run(
          app,
          'create or replace function current_tenant_id() returns uuid language sql as $$ select null::uuid $$',
        ),
      ),
    ).toMatch(/must be owner|permission denied/);
  });
});

describe('the queue role', () => {
  it('reaches no table, with or without a tenant context', async () => {
    expect(await refusal(queue.select().from(auditEntries))).toMatch(DENIED);
    expect(await refusal(queue.select().from(outboxEvents))).toMatch(DENIED);
    expect(
      await refusal(withTenant(queue, tenant, (tx) => tx.select().from(auditEntries))),
    ).toMatch(DENIED);
  });
});

describe('the sync role', () => {
  // Through SQL only: its REPLICATION attribute reaches the WAL, closed on the server (Q20).
  it('reads no table it is not given through SQL, though it bypasses RLS', async () => {
    expect(await refusal(sync.select().from(auditEntries))).toMatch(DENIED);
    expect(await refusal(sync.select().from(outboxEvents))).toMatch(DENIED);
  });

  it('writes nothing and creates nothing', async () => {
    expect(
      await refusal(
        sync.insert(outboxEvents).values({ tenantId: tenant, type: 'test.ran', payload: {} }),
      ),
    ).toMatch(DENIED);
    expect(await refusal(run(sync, 'truncate audit_entries'))).toMatch(DENIED);
    expect(await refusal(run(sync, 'create table spare (id uuid)'))).toMatch(DENIED);
    expect(await refusal(run(sync, 'set role food_owner'))).toMatch(DENIED);
  });
});
