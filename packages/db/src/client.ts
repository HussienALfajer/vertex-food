import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describeForLog } from './describe-for-log.js';
import * as schema from './schema/index.js';

/**
 * The deadlines of every pooled connection, in milliseconds. A connection that does not open in
 * time fails; the session settings are sent at connection start, so they bind whichever role the
 * URL names: a statement is cancelled (57014), a lock wait gives up (55P03) and a transaction left
 * idle is ended by the server. Each error rolls the transaction back.
 */
export const DATABASE_DEADLINES = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 30_000,
} as const;

/**
 * A Drizzle database over a node-postgres pool. Apps connect as the app role (`food_app`), which
 * cannot bypass row-level security; tenant data is reached only through `withTenant`.
 */
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, ...DATABASE_DEADLINES });
  // An idle client that loses its connection (a server restart, an administrator's termination)
  // emits `error` on the pool; unheard, it would end the process. The pool drops that client and
  // opens a new one for the next query. The message can quote values, so only its code is logged.
  pool.on('error', (error) => {
    console.error(`Idle database connection lost: ${describeForLog(error)}`);
  });
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDatabase>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
