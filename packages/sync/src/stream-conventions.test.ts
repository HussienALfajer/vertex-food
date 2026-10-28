import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// The sync streams' conventions (spec S04, ADR 0035): the sync service reads whole rows of the
// published tables bypassing RLS, so isolation of what reaches a PC rests on these queries. Each
// one names its columns, reads a published table, and filters by the token's tenant and branch.
// The config is parsed as YAML and every key is known here, so no query escapes the checks.

const config: unknown = parseYaml(
  readFileSync(new URL('../powersync/sync-config.yaml', import.meta.url), 'utf8'),
);

const TOP_LEVEL_KEYS = ['config', 'streams'];
const STREAM_KEYS = ['auto_subscribe', 'query', 'queries'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every query of every stream, or an error naming what the test does not recognise. */
function streamQueries(): string[] {
  if (!isRecord(config)) throw new Error('the sync config is not a mapping');
  const unknownTop = Object.keys(config).filter((key) => !TOP_LEVEL_KEYS.includes(key));
  if (unknownTop.length > 0) throw new Error(`unknown keys: ${unknownTop.join(', ')}`);
  const streams = config.streams;
  if (!isRecord(streams)) throw new Error('streams is not a mapping');
  const queries: string[] = [];
  for (const [name, stream] of Object.entries(streams)) {
    if (!isRecord(stream)) throw new Error(`stream ${name} is not a mapping`);
    const unknown = Object.keys(stream).filter((key) => !STREAM_KEYS.includes(key));
    if (unknown.length > 0)
      throw new Error(`stream ${name} has unknown keys: ${unknown.join(', ')}`);
    const own = [
      ...(stream.query === undefined ? [] : [stream.query]),
      ...(stream.queries === undefined ? [] : (stream.queries as unknown[])),
    ];
    if (!Array.isArray(stream.queries ?? []) || own.length === 0) {
      throw new Error(`stream ${name} has no list of queries`);
    }
    for (const query of own) {
      if (typeof query !== 'string') throw new Error(`stream ${name} has a query that is not text`);
      queries.push(query.replace(/\s+/g, ' ').trim());
    }
  }
  return queries;
}

const queries = streamQueries();
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
  it('are found in the config, with only keys the checks know', () => {
    expect(queries.length).toBeGreaterThanOrEqual(8);
  });

  it.each(queries)('%s names its columns and reads a published table', (query) => {
    const { columns, table } = parse(query);
    expect(columns).not.toContain('*');
    expect(publishedTables()).toContain(table);
  });

  it.each(queries)('%s filters by the token’s tenant and branch', (query) => {
    const { table, where } = parse(query);
    // One table, no subquery, no alternative: the filters below hold for every row.
    expect(where).not.toMatch(/\b(OR|SELECT|FROM|JOIN|UNION)\b/i);
    const conditions = where.split(/ AND /i).map((condition) => condition.trim());
    // A tenant's own row by its id; a branch's own row by its id; every other row by both columns.
    const tenantFilter = table === 'tenants' ? `id = ${TENANT}` : `tenant_id = ${TENANT}`;
    expect(conditions).toContain(tenantFilter);
    if (table === 'tenants') return;
    const branchFilter = table === 'branches' ? `id = ${BRANCH}` : `branch_id = ${BRANCH}`;
    expect(conditions).toContain(branchFilter);
  });

  it('stream every published table', () => {
    expect([...publishedTables()].sort()).toEqual(
      [...new Set(queries.map((q) => parse(q).table))].sort(),
    );
  });
});
