import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  type Database,
  outboxEvents,
  type Transaction,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// The platform-jobs role (ADR 0004): the worker's outbox dispatcher reads and claims events across
// tenants, and can do nothing else. Each test uses its own tenants, so claims never reach the events
// of other test files sharing the run's database.

const { owner, app, jobs } = connect();
const DENIED = /permission denied for table/;
const CLAIM_ONLY = /only a claim, setting dispatched_at once, is allowed/;

const event = (tenantId: string) => ({ tenantId, type: 'test.ran', payload: { run: 1 } });

/** One pending event for each of two new tenants, written by the app role as the API would. */
async function seed() {
  const tenants = [uuidv7(), uuidv7()];
  const ids: string[] = [];
  for (const tenant of tenants) {
    const [row] = await withTenant(app, tenant, (tx) =>
      tx.insert(outboxEvents).values(event(tenant)).returning({ id: outboxEvents.id }),
    );
    if (!row) throw new Error('no outbox event inserted');
    ids.push(row.id);
  }
  return { tenants, ids };
}

/** The dispatcher's claim: pending events, locked and skipped by concurrent claims, in one statement. */
async function claim(tenants: string[]) {
  const { rows } = await jobs.$client.query<{ id: string; tenant_id: string }>(
    `update outbox_events set dispatched_at = now(), updated_at = now()
     where id in (select id from outbox_events
                  where dispatched_at is null and tenant_id = any($1)
                  order by id limit 10 for update skip locked)
     returning id, tenant_id`,
    [tenants],
  );
  return rows;
}

const reset = (db: Database | Transaction, id: string) =>
  db
    .update(outboxEvents)
    .set({ dispatchedAt: null })
    .where(eq(outboxEvents.id, id))
    .returning({ id: outboxEvents.id });

describe('the jobs role on outbox_events', () => {
  it('reads the pending events of every tenant without a tenant context', async () => {
    const { tenants, ids } = await seed();
    const seen = await jobs
      .select({ id: outboxEvents.id, tenantId: outboxEvents.tenantId })
      .from(outboxEvents)
      .where(and(inArray(outboxEvents.tenantId, tenants), isNull(outboxEvents.dispatchedAt)))
      .orderBy(outboxEvents.id);
    expect(seen).toEqual(ids.map((id, i) => ({ id, tenantId: tenants[i] })));
  });

  it('claims pending events across tenants, each once', async () => {
    const { tenants, ids } = await seed();
    const claimed = await claim(tenants);
    expect(claimed.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(await claim(tenants)).toEqual([]);

    const [stored] = await jobs
      .select({ dispatchedAt: outboxEvents.dispatchedAt })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, ids[0] ?? ''));
    expect(stored?.dispatchedAt).toBeInstanceOf(Date);
  });

  it('cannot put a claimed event back in the queue or claim it again', async () => {
    const { tenants, ids } = await seed();
    await claim(tenants);
    const [id = '', tenant = ''] = [ids[0], tenants[0]];

    // Without a tenant context its policies hide dispatched events from updates.
    expect(await reset(jobs, id)).toEqual([]);
    // With one, the tenant policy would let the row through, and the trigger refuses.
    expect(await refusal(withTenant(jobs, tenant, (tx) => reset(tx, id)))).toMatch(CLAIM_ONLY);
    expect(
      await refusal(
        withTenant(jobs, tenant, (tx) =>
          tx.update(outboxEvents).set({ dispatchedAt: new Date() }).where(eq(outboxEvents.id, id)),
        ),
      ),
    ).toMatch(CLAIM_ONLY);
  });

  it('cannot change anything but the dispatch time', async () => {
    const { tenants, ids } = await seed();
    const id = ids[0] ?? '';
    const changes = [{ type: 'test.changed' }, { payload: { run: 2 } }, { tenantId: tenants[1] }];
    for (const change of changes) {
      expect(
        await refusal(jobs.update(outboxEvents).set(change).where(eq(outboxEvents.id, id))),
      ).toMatch(DENIED);
    }
  });

  it('cannot add, delete or empty events, with or without a tenant context', async () => {
    const { tenants, ids } = await seed();
    const [id = '', tenant = ''] = [ids[0], tenants[0]];
    expect(await refusal(jobs.insert(outboxEvents).values(event(tenant)))).toMatch(DENIED);
    expect(
      await refusal(
        withTenant(jobs, tenant, (tx) => tx.insert(outboxEvents).values(event(tenant))),
      ),
    ).toMatch(DENIED);
    expect(await refusal(jobs.delete(outboxEvents).where(eq(outboxEvents.id, id)))).toMatch(DENIED);
    expect(await refusal(jobs.$client.query('truncate outbox_events'))).toMatch(DENIED);
  });
});

describe('the jobs role elsewhere', () => {
  it('cannot read or write any other table, with or without a tenant context', async () => {
    const tenant = uuidv7();
    expect(await refusal(jobs.select().from(auditEntries))).toMatch(DENIED);
    expect(await refusal(withTenant(jobs, tenant, (tx) => tx.select().from(auditEntries)))).toMatch(
      DENIED,
    );
    expect(
      await refusal(
        withTenant(jobs, tenant, (tx) =>
          tx.insert(auditEntries).values({
            tenantId: tenant,
            actorKind: 'system',
            action: 'test.ran',
            entityType: 'test',
            occurredAt: new Date(),
          }),
        ),
      ),
    ).toMatch(DENIED);
  });
});

describe('outbox_events for the other roles', () => {
  it('the app role still sees only its tenant and cannot claim', async () => {
    const { tenants, ids } = await seed();
    const [tenant = '', id = ''] = [tenants[0], ids[0]];
    expect(
      await app.select().from(outboxEvents).where(inArray(outboxEvents.tenantId, tenants)),
    ).toEqual([]);
    const seen = await withTenant(app, tenant, (tx) =>
      tx
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(inArray(outboxEvents.tenantId, tenants)),
    );
    expect(seen).toEqual([{ id }]);
    expect(
      await refusal(
        withTenant(app, tenant, (tx) =>
          tx.update(outboxEvents).set({ dispatchedAt: new Date() }).where(eq(outboxEvents.id, id)),
        ),
      ),
    ).toMatch(DENIED);
  });

  it('the owner too can only claim an event, once', async () => {
    const { tenants, ids } = await seed();
    const [tenant = '', id = ''] = [tenants[0], ids[0]];
    expect(
      await refusal(
        withTenant(owner, tenant, (tx) =>
          tx
            .update(outboxEvents)
            .set({ payload: { run: 2 } })
            .where(eq(outboxEvents.id, id)),
        ),
      ),
    ).toMatch(CLAIM_ONLY);
    await claim(tenants);
    expect(await refusal(withTenant(owner, tenant, (tx) => reset(tx, id)))).toMatch(CLAIM_ONLY);
  });

  it('no role deletes or empties events, so none is dropped before or after dispatch', async () => {
    const { tenants, ids } = await seed();
    const [tenant = '', id = ''] = [tenants[0], ids[0]];
    expect(
      await refusal(
        withTenant(owner, tenant, (tx) => tx.delete(outboxEvents).where(eq(outboxEvents.id, id))),
      ),
    ).toBe('outbox_events is append-only: DELETE refused');
    expect(await refusal(owner.$client.query('truncate outbox_events'))).toBe(
      'outbox_events is append-only: TRUNCATE refused',
    );
    expect(
      await refusal(
        withTenant(app, tenant, (tx) => tx.delete(outboxEvents).where(eq(outboxEvents.id, id))),
      ),
    ).toMatch(DENIED);
    const [kept] = await withTenant(app, tenant, (tx) =>
      tx.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.id, id)),
    );
    expect(kept).toEqual({ id });
  });

  it('a new event is always pending, whoever writes it', async () => {
    const tenant = uuidv7();
    for (const db of [app, owner]) {
      expect(
        await refusal(
          withTenant(db, tenant, (tx) =>
            tx.insert(outboxEvents).values({ ...event(tenant), dispatchedAt: new Date() }),
          ),
        ),
      ).toMatch(/a new event is pending/);
    }
  });
});
