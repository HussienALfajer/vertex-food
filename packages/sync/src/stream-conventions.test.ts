import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The sync streams' conventions (spec S04, ADR 0035): the sync service reads whole rows of the
// published tables bypassing RLS, so isolation of what reaches a PC rests on these queries. Each
// one names its columns, reads a published table, and filters by the token's tenant and branch.

const config = readFileSync(new URL('../powersync/sync-config.yaml', import.meta.url), 'utf8');
const queries = config
  .split('\n')
  .map((line) => /^\s*- (SELECT .*)$/.exec(line)?.[1])
  .filter((query): query is string => query !== undefined);

const TENANT = "auth.parameter('tenant_id')";
const BRANCH = "auth.parameter('branch_id')";

/** The tables the migrations publish to the sync service, read from their SQL. */
function publishedTables(): Set<string> {
  const directory = new URL('../../db/migrations/', import.meta.url);
  const published = new Set<string>();
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(new URL(file, directory), 'utf8');
    for (const [, verb, list] of sql.matchAll(
      /(CREATE PUBLICATION powersync FOR TABLE|ALTER PUBLICATION powersync (?:ADD|DROP) TABLE)\s+([^;]+);/g,
    )) {
      const tables = (list as string).split(',').map((table) => table.trim());
      for (const table of tables) {
        if (verb?.includes('DROP')) published.delete(table);
        else published.add(table);
      }
    }
  }
  return published;
}

function parse(query: string) {
  const match = /^SELECT (.+) FROM (\w+) WHERE (.+)$/.exec(query);
  if (!match) throw new Error(`not a stream query: ${query}`);
  const [, columns, table, where] = match as unknown as [string, string, string, string];
  return { columns: columns.split(',').map((c) => c.trim()), table, where };
}

describe('sync streams', () => {
  it('are found in the config', () => {
    expect(queries.length).toBeGreaterThanOrEqual(8);
  });

  it.each(queries)('%s names its columns and reads a published table', (query) => {
    const { columns, table } = parse(query);
    expect(columns).not.toContain('*');
    expect(publishedTables()).toContain(table);
  });

  it.each(queries)('%s filters by the token’s tenant and branch', (query) => {
    const { table, where } = parse(query);
    const conditions = where.split(' AND ').map((condition) => condition.trim());
    // A tenant's own row by its id; a branch's own row by its id; every other row by both columns.
    const tenantFilter = table === 'tenants' ? `id = ${TENANT}` : `tenant_id = ${TENANT}`;
    expect(conditions).toContain(tenantFilter);
    if (table === 'tenants') return;
    const branchFilter = table === 'branches' ? `id = ${BRANCH}` : `branch_id = ${BRANCH}`;
    expect(conditions).toContain(branchFilter);
    expect(where).not.toMatch(/\bOR\b/i);
  });

  it('stream every published table', () => {
    expect([...publishedTables()].sort()).toEqual(
      [...new Set(queries.map((q) => parse(q).table))].sort(),
    );
  });
});
