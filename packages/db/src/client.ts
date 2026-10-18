import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

/**
 * A Drizzle database over a node-postgres pool. Apps connect as the app role (`food_app`), which
 * cannot bypass row-level security; tenant data is reached only through `withTenant`.
 */
export function createDatabase(connectionString: string) {
  return drizzle({ client: new pg.Pool({ connectionString }), schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDatabase>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
