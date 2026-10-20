import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { createDatabase, DATABASE_DEADLINES } from '../src/client.js';
import { auditEntries, withTenant } from '../src/index.js';

// The pool every app uses: it survives a lost idle connection and every wait is bounded.

const app = createDatabase(inject('appUrl'));
afterAll(() => app.$client.end());

describe('a lost idle connection', () => {
  it('is logged without its message and the next query opens a new one', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rows } = await app.$client.query<{ pid: number }>('select pg_backend_pid() as pid');
      const pid = rows[0]?.pid;
      expect(app.$client.idleCount).toBe(1);

      // The same role may end its own backend, as an administrator or a server restart would.
      const killer = new pg.Client({ connectionString: inject('appUrl') });
      await killer.connect();
      try {
        await killer.query('select pg_terminate_backend($1)', [pid]);
      } finally {
        await killer.end();
      }
      // Only the pool's own listener hears it: an unheard `error` would end this process.
      expect(app.$client.listenerCount('error')).toBe(1);
      await vi.waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          expect.stringMatching(/^Idle database connection lost: /),
        ),
      );
      const next = await app.$client.query<{ pid: number }>('select pg_backend_pid() as pid');
      expect(next.rows[0]?.pid).not.toBe(pid);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('the deadlines', () => {
  it('apply to every session of the pool', async () => {
    const { rows } = await app.$client.query<Record<string, string>>(
      `select current_setting('statement_timeout') as statement,
              current_setting('lock_timeout') as lock,
              current_setting('idle_in_transaction_session_timeout') as idle`,
    );
    expect(rows[0]).toEqual({ statement: '10s', lock: '5s', idle: '30s' });
  });

  it('end a lock wait in time and roll back what the transaction wrote before it', async () => {
    const tenant = uuidv7();
    const holder = new pg.Client({ connectionString: inject('appUrl') });
    await holder.connect();
    try {
      await holder.query('select pg_advisory_lock(4242)');
      const started = Date.now();
      const error = await withTenant(app, tenant, async (tx) => {
        await tx.insert(auditEntries).values({
          tenantId: tenant,
          actorKind: 'system',
          action: 'test.lock_waited',
          entityType: 'test',
          occurredAt: new Date(),
        });
        await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
      }).catch((caught: unknown) => caught);
      const elapsed = Date.now() - started;

      const cause = error instanceof Error ? error.cause : undefined;
      expect(cause).toMatchObject({ code: '55P03' });
      expect(elapsed).toBeGreaterThanOrEqual(DATABASE_DEADLINES.lock_timeout - 100);
      expect(elapsed).toBeLessThan(DATABASE_DEADLINES.lock_timeout + 2_000);
      const written = await withTenant(app, tenant, (tx) => tx.select().from(auditEntries));
      expect(written).toEqual([]);
    } finally {
      await holder.end();
    }
  }, 10_000);

  it('give up on a server that never answers the connection', async () => {
    const sockets: Socket[] = [];
    const silent = createServer((socket) => sockets.push(socket));
    silent.listen(0, '127.0.0.1');
    await once(silent, 'listening');
    const address = silent.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const stalled = createDatabase(`postgres://food_app:unused@127.0.0.1:${address.port}/db`);
    try {
      const started = Date.now();
      await expect(stalled.$client.query('select 1')).rejects.toThrow(/timeout/);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(DATABASE_DEADLINES.connectionTimeoutMillis - 100);
      expect(elapsed).toBeLessThan(DATABASE_DEADLINES.connectionTimeoutMillis + 2_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      silent.close();
      await stalled.$client.end();
    }
  }, 10_000);
});
