import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';

/** The transaction setting every RLS policy reads, through `current_tenant_id()` (ADR 0004). */
export const TENANT_SETTING = 'app.tenant_id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction that sees and writes only `tenantId`'s rows. The setting is
 * transaction-local, so it never leaks to the next user of the pooled connection. `tenantId` comes
 * from the authenticated session or device token, never from client input.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('withTenant needs the tenant id as a UUID');
  return db.transaction(async (tx) => {
    await enterTenant(tx, tenantId);
    return work(tx);
  });
}

/**
 * Points an open transaction at `tenantId`: the statements that follow see and write only its
 * rows, until the next call or the end of the transaction. For the few account-level changes that
 * must touch each of a person's tenants in one transaction (one account holds staff roles in
 * several restaurants, ADR 0005). The tenant ids come from the account's own links, never from
 * client input.
 */
export async function enterTenant(tx: Transaction, tenantId: string): Promise<void> {
  if (!UUID.test(tenantId)) throw new Error('enterTenant needs the tenant id as a UUID');
  await tx.execute(sql`select set_config(${TENANT_SETTING}, ${tenantId}, true)`);
}

/**
 * Runs `work` in one `REPEATABLE READ, READ ONLY` transaction of `tenantId`: every read sees the
 * database as of the transaction's first statement, so files built from several tables agree
 * with each other (the data export, spec S06 rule 10). `tenantId` comes from a record the caller
 * already holds under RLS (the export row), never from client input.
 */
export async function withTenantSnapshot<T>(
  db: Database,
  tenantId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('withTenantSnapshot needs the tenant id as a UUID');
  return db.transaction(
    async (tx) => {
      await enterTenant(tx, tenantId);
      return work(tx);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
