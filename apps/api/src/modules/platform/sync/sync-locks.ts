import type { Transaction } from '@vertex-food/db';
import { type SQL, sql } from 'drizzle-orm';

/**
 * The key of a transaction lock on one subject of the sync module (a command id, a branch's
 * blocks, a quarantine batch), for `pg_advisory_xact_lock`: two subjects sharing a hash only wait
 * for each other.
 */
export function lockKey(kind: string, id: string): SQL {
  return sql`hashtextextended(${`sync.${kind}:${id}`}, 0)`;
}

/** Waits for the transaction lock on `kind` and `id`, held until the transaction ends. */
export async function lock(tx: Transaction, kind: string, id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(kind, id)})`);
}

/** The transaction's start (`now()`): `received_at` of the commands it records. */
export async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select now() as now`);
  return new Date(result.rows[0]?.now as Date);
}
