import type { Transaction } from '@vertex-food/db';
import { sql } from 'drizzle-orm';

/**
 * The transaction's start (`now()`) by the database clock, to the millisecond a JavaScript date
 * holds: the instant of a change that triggers or other rows compare with `now()` (a command's
 * `received_at`, an amendment's decision).
 */
export async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(
    sql`select date_trunc('milliseconds', now()) as now`,
  );
  return new Date(result.rows[0]?.now as Date);
}
