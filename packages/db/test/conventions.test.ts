import { describe, expect, it } from 'vitest';
import { type TableInfo, tableRegistry } from '../src/index.js';
import { connect } from './connections.js';

// The data conventions of ADR 0004 and ADR 0020, read from the migrated database itself, so they
// hold whatever the schema files or custom migrations say. A new table fails here until it follows
// them and is listed in src/schema/registry.ts.

const APP_ROLE = 'food_app';
const OWNER_ROLE = 'food_owner';
const JOBS_ROLE = 'food_jobs';
const QUEUE_ROLE = 'food_queue';
const SYNC_ROLE = 'food_sync';
const ROLES = [APP_ROLE, OWNER_ROLE, JOBS_ROLE, QUEUE_ROLE, SYNC_ROLE];
// pg-boss's schema: it installs and owns its tables there as the queue role, so they are left out
// of the table checks below; the worker's tests pin who may reach them.
const QUEUE_SCHEMA = 'pgboss';
// The only schemas besides PostgreSQL's own: the tables, Drizzle's migration journal, pg-boss.
const SCHEMAS = ['drizzle', QUEUE_SCHEMA, 'public'];
// Everything the platform-jobs role may touch (ADR 0004): it reads the listed tables across tenants
// through policies of its own (tenant tables) or as platform data, adds rows where `insert` is set
// (inside withTenant, so the tenant_isolation policy bounds them) and updates only the listed
// columns. Any other grant fails here.
const JOBS_ACCESS: Record<string, { select: boolean; insert?: boolean; update: string[] }> = {
  // The scheduled-status job's audit entries and events (spec S01).
  audit_entries: { select: false, insert: true, update: [] },
  outbox_events: { select: true, insert: true, update: ['dispatched_at', 'updated_at'] },
  // tenancy/apply-scheduled-status (spec S01).
  tenants: {
    select: true,
    update: [
      'archived_at',
      'closed_at',
      'scheduled_status',
      'scheduled_status_at',
      'scheduled_status_reason',
      'status',
      'status_changed_at',
      'status_reason',
      'updated_at',
    ],
  },
  // sync/connectivity-sweep (spec S04): every branch's state through its own policy; inside each
  // tenant, the PCs' heartbeats, the move and its change row.
  branch_connectivity: {
    select: true,
    update: ['healthy_streak', 'since', 'state', 'updated_at'],
  },
  branch_connectivity_changes: { select: false, insert: true, update: [] },
  device_sync_states: { select: true, update: [] },
  // The device.revoked.v1 consumer clears the revoked PC's hub role (spec S04).
  devices: { select: true, update: ['hub_role', 'updated_at'] },
  // entitlements/apply-boundaries (spec S05 rule 19): the due states and each tenant's terms and
  // overrides (platform data); inside the tenant, its branches and their copies.
  agreements: { select: true, update: [] },
  agreement_terms: { select: true, update: [] },
  agreement_term_endings: { select: true, update: [] },
  entitlement_overrides: { select: true, update: [] },
  entitlement_override_revocations: { select: true, update: [] },
  entitlement_states: {
    select: true,
    update: ['computed_at', 'resolved', 'updated_at', 'valid_until', 'version'],
  },
  branch_entitlements: {
    select: true,
    insert: true,
    update: ['features', 'lease_days', 'limits', 'updated_at', 'valid_until', 'version'],
  },
  branches: { select: true, update: [] },
};
// The tables the sync service replicates to devices (ADR 0022): it reads them whole, bypassing RLS,
// so each one is listed here by the migration that publishes it (S04, S05). Through SQL it reads nothing
// else and writes nothing. Its REPLICATION attribute reaches the WAL itself, which no grant limits:
// that is closed on the server (only pgoutput installed, packages/db/CLAUDE.md, Q20), not here.
// Its snapshot reads whole rows, so a published table holds nothing a device must not get
// (`command_payloads` and `branch_ca_keys` stay unpublished).
const SYNC_ACCESS: string[] = [
  'attention_items',
  'attention_resolutions',
  'branch_certificate_authorities',
  // S05: a branch's entitlement copy, keys and limits only.
  'branch_entitlements',
  'branches',
  'command_log',
  'device_certificates',
  'devices',
  'tenants',
];
// Queue tables the app role deletes from besides the replaceable sets, each for its reason (spec
// S03): no other table is deleted from.
const APP_DELETES: Record<string, string> = {
  whatsapp_known_recipients: 'keyed hashes of a WhatsApp session that no longer exists',
  whatsapp_messages: 'the sweep after 30 days and an unlinked session’s queued messages',
  whatsapp_session_credentials: 'Baileys’ store of a link that was replaced or ended',
};
// Partial indexes on a tenant table that do not start with tenant_id, for the jobs role's claims
// across tenants, on a table listed in JOBS_ACCESS only.
const CROSS_TENANT_INDEXES: Record<string, string[]> = {
  outbox_events: ['outbox_events_pending_idx'],
};
const FORBIDDEN_TYPES = ['timestamp without time zone', 'real', 'double precision', 'money'];
const TENANT_POLICY = '(tenant_id = current_tenant_id())';
const TENANT_FUNCTION = "SELECT nullif(current_setting('app.tenant_id', true), '')::uuid";
// Trigger type bits (pg_trigger.tgtype): BEFORE, DELETE, UPDATE, TRUNCATE.
const BEFORE = 2;
const REFUSED_EVENTS = 8 | 16 | 32;
// pg_trigger.tgenabled values for a trigger that fires in normal sessions.
const TRIGGER_ENABLED = ['O', 'A'];

const { owner } = connect();

async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await owner.$client.query(text, values)).rows as T[];
}

type Table = { schema: string; name: string; owner: string; rls: boolean; forced: boolean };
type Column = {
  table: string;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};
type Index = {
  table: string;
  name: string;
  primary: boolean;
  partial: boolean;
  columns: string[];
};
type Constraint = {
  table: string;
  type: string;
  definition: string;
  columns: string[];
  references: string | null;
  referencedColumns: string[];
};

const attributeNames = (relation: string, keys: string) => `
  array(select a.attname::text
        from unnest(${keys}) with ordinality as u(attnum, position)
        join pg_attribute a on a.attrelid = ${relation} and a.attnum = u.attnum
        order by u.position)`;

// Every table outside the system schemas, Drizzle's migration journal and pg-boss's schema, so a
// table in another schema cannot escape the checks below.
const tables = await rows<Table>(`
  select n.nspname as schema, c.relname as name, pg_get_userbyid(c.relowner) as owner,
         c.relrowsecurity as rls, c.relforcerowsecurity as forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle', '${QUEUE_SCHEMA}')
    and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
  order by 2`);
const columns = await rows<Column>(`
  select table_name as table, column_name as name, data_type as type,
         is_nullable = 'YES' as nullable, column_default as default
  from information_schema.columns
  where table_schema = 'public'`);
const indexes = await rows<Index>(`
  select i.indrelid::regclass::text as table, i.indexrelid::regclass::text as name,
         i.indisprimary as primary, i.indpred is not null as partial,
         ${attributeNames('i.indrelid', 'i.indkey')} as columns
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  where c.relnamespace = 'public'::regnamespace`);
const constraints = await rows<Constraint>(`
  select k.conrelid::regclass::text as table, k.contype as type,
         pg_get_constraintdef(k.oid) as definition,
         ${attributeNames('k.conrelid', 'k.conkey')} as columns,
         nullif(k.confrelid, 0)::regclass::text as references,
         ${attributeNames('k.confrelid', 'k.confkey')} as "referencedColumns"
  from pg_constraint k
  where k.connamespace = 'public'::regnamespace`);
const policies = await rows<{
  table: string;
  permissive: string;
  roles: string[];
  command: string;
  using: string | null;
  check: string | null;
}>(`
  select tablename as table, permissive, roles::text[] as roles, cmd as command,
         qual as using, with_check as check
  from pg_policies
  where schemaname = 'public'`);
const triggers = await rows<{ table: string; type: number; enabled: string; fn: string }>(`
  select t.tgrelid::regclass::text as table, t.tgtype as type, t.tgenabled as enabled,
         p.proname as fn
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`);

const columnsOf = (table: string) => columns.filter((column) => column.table === table);
const column = (table: string, name: string) =>
  columns.find((c) => c.table === table && c.name === name);
const startsWith = (list: string[], prefix: string[]) =>
  prefix.every((name, i) => list[i] === name);
const registry: Record<string, TableInfo> = tableRegistry;
const isTenant = (table: string) => registry[table]?.scope === 'tenant';

async function appPrivileges(table: string) {
  const [privileges] = await rows<Record<string, boolean>>(
    `select has_table_privilege($1, $2, 'UPDATE') as update,
            has_table_privilege($1, $2, 'DELETE') as delete,
            has_table_privilege($1, $2, 'TRUNCATE') as truncate,
            has_table_privilege($1, $2, 'TRIGGER') as trigger,
            has_table_privilege($1, $2, 'REFERENCES') as references`,
    [APP_ROLE, table],
  );
  if (!privileges) throw new Error(`no privileges read for ${table}`);
  return privileges;
}

/** A role's table-wide privileges and, per privilege, the columns it reaches. */
async function privilegesOf(role: string, table: string) {
  const [tableWide] = await rows<Record<string, boolean>>(
    `select has_table_privilege($1, $2, 'INSERT') as insert,
            has_table_privilege($1, $2, 'UPDATE') as update,
            has_table_privilege($1, $2, 'DELETE') as delete,
            has_table_privilege($1, $2, 'TRUNCATE') as truncate,
            has_table_privilege($1, $2, 'TRIGGER') as trigger,
            has_table_privilege($1, $2, 'REFERENCES') as references`,
    [role, table],
  );
  // Column privileges include the table-wide ones, so these lists show everything it can reach.
  const perColumn = await rows<{ column: string; privilege: string }>(
    `select a.attname as column, p.privilege
     from pg_attribute a
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
     where a.attrelid = $2::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege($1, $2, a.attname, p.privilege)
     order by a.attname`,
    [role, table],
  );
  const columnsWith = (privilege: string) =>
    perColumn.filter((c) => c.privilege === privilege).map((c) => c.column);
  return {
    tableWide,
    columns: {
      select: columnsWith('SELECT'),
      insert: columnsWith('INSERT'),
      update: columnsWith('UPDATE'),
      references: columnsWith('REFERENCES'),
    },
  };
}

const NO_TABLE_WIDE_WRITE = {
  insert: false,
  update: false,
  delete: false,
  truncate: false,
  trigger: false,
  references: false,
};

describe('table registry', () => {
  it('lists exactly the tables in the database', () => {
    expect(tables.map((table) => table.name)).toEqual(Object.keys(registry).sort());
  });

  it('gives every table an owning module', () => {
    for (const [name, info] of Object.entries(registry)) {
      expect(info.module, name).toMatch(/^[a-z-]+$/);
    }
  });

  it('lets the app role delete only from queues', () => {
    for (const table of Object.keys(APP_DELETES)) {
      expect(registry[table]?.kind, table).toBe('queue');
    }
  });

  it('gives the sync role only tables that exist', () => {
    for (const table of SYNC_ACCESS) expect(Object.keys(registry)).toContain(table);
  });
});

describe.each(tables)('$name', (table) => {
  const info = registry[table.name];

  it('lives in the public schema and is owned by the owner role', () => {
    expect(table.schema).toBe('public');
    expect(table.owner).toBe(OWNER_ROLE);
  });

  it('has a UUIDv7 primary key named id', () => {
    const primary = indexes.find((index) => index.table === table.name && index.primary);
    expect(primary?.columns).toEqual(['id']);
    expect(column(table.name, 'id')?.type).toBe('uuid');
    expect(
      constraints.some(
        (c) =>
          c.table === table.name &&
          c.type === 'c' &&
          c.definition === 'CHECK (((uuid_extract_version(id) = 7) IS TRUE))',
      ),
    ).toBe(true);
  });

  it('names columns in snake case and uses no floating-point or zoneless time type', () => {
    for (const c of columnsOf(table.name)) {
      expect(c.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(FORBIDDEN_TYPES, `${c.name} is ${c.type}`).not.toContain(c.type);
    }
  });

  it('records created_at', () => {
    expect(column(table.name, 'created_at')).toMatchObject({
      type: 'timestamp with time zone',
      nullable: false,
      default: 'now()',
    });
  });

  it(`has the timestamps of its kind (${info?.kind})`, () => {
    expect(info).toBeDefined();
    const updated = column(table.name, 'updated_at');
    const archived = column(table.name, 'archived_at');
    if (info?.kind === 'append-only' || info?.kind === 'replaceable') {
      expect(updated).toBeUndefined();
      expect(archived).toBeUndefined();
    } else {
      expect(updated).toMatchObject({ type: 'timestamp with time zone', nullable: false });
      if (info?.kind === 'business') {
        expect(archived).toMatchObject({ type: 'timestamp with time zone', nullable: true });
      }
    }
  });

  it(`has a tenant_id exactly when its scope is tenant (${info?.scope})`, () => {
    if (info?.scope === 'tenant') {
      expect(column(table.name, 'tenant_id')).toMatchObject({ type: 'uuid', nullable: false });
    } else {
      expect(column(table.name, 'tenant_id')).toBeUndefined();
    }
  });

  it('indexes every foreign key, and carries tenant_id in a key between tenant tables', () => {
    const own = indexes.filter((index) => index.table === table.name);
    for (const fk of constraints.filter((c) => c.table === table.name && c.type === 'f')) {
      // A partial index leaves rows out, so it never covers a foreign key.
      const covered = own.some(
        (index) =>
          !index.partial &&
          (startsWith(index.columns, fk.columns) ||
            (index.columns[0] === 'tenant_id' && startsWith(index.columns.slice(1), fk.columns))),
      );
      expect(covered, fk.definition).toBe(true);
      if (isTenant(table.name) && fk.references && isTenant(fk.references)) {
        expect(fk.columns[0], fk.definition).toBe('tenant_id');
        expect(fk.referencedColumns[0], fk.definition).toBe('tenant_id');
      }
    }
  });

  it('gives the app role no privilege that ignores RLS, rewrites history or deletes records', async () => {
    const privileges = await appPrivileges(table.name);
    expect(privileges).toMatchObject({ truncate: false, trigger: false, references: false });
    // Only a set replaced whole (a branch's weekly hours) and the listed queues are deleted from.
    expect(privileges.delete).toBe(info?.kind === 'replaceable' || table.name in APP_DELETES);
    if (info?.kind === 'append-only' || info?.kind === 'replaceable') {
      expect(privileges.update).toBe(false);
    }
  });

  it('gives the queue role no access at all', async () => {
    const [privileges] = await rows<{ table: boolean; column: boolean }>(
      `select has_table_privilege($1, $2,
                'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as table,
              has_any_column_privilege($1, $2, 'SELECT, INSERT, UPDATE, REFERENCES') as column`,
      [QUEUE_ROLE, table.name],
    );
    expect(privileges).toEqual({ table: false, column: false });
  });

  it('gives the jobs role exactly the access listed for it, and no table-wide write', async () => {
    const expected = JOBS_ACCESS[table.name] ?? { select: false, update: [] };
    const privileges = await privilegesOf(JOBS_ROLE, table.name);
    const allColumns = columnsOf(table.name)
      .map((c) => c.name)
      .sort();
    expect(privileges.tableWide).toEqual({ ...NO_TABLE_WIDE_WRITE, insert: !!expected.insert });
    expect(privileges.columns).toEqual({
      select: expected.select ? allColumns : [],
      insert: expected.insert ? allColumns : [],
      update: [...expected.update].sort(),
      references: [],
    });
  });

  it('gives the sync role a read of the table only when it is published, and no write', async () => {
    const privileges = await privilegesOf(SYNC_ROLE, table.name);
    expect(privileges.tableWide).toEqual(NO_TABLE_WIDE_WRITE);
    expect(privileges.columns).toEqual({
      select: SYNC_ACCESS.includes(table.name)
        ? columnsOf(table.name)
            .map((c) => c.name)
            .sort()
        : [],
      insert: [],
      update: [],
      references: [],
    });
  });
});

describe.each(tables.filter((table) => isTenant(table.name)))('tenant table $name', (table) => {
  it('enables and forces row-level security', () => {
    expect(table.rls).toBe(true);
    expect(table.forced).toBe(true);
  });

  it('isolates by the transaction tenant, for every command and role, with nothing wider', () => {
    const own = policies.filter((policy) => policy.table === table.name);
    expect(own.filter((p) => p.permissive === 'PERMISSIVE' && p.roles.includes('public'))).toEqual([
      {
        table: table.name,
        permissive: 'PERMISSIVE',
        roles: ['public'],
        command: 'ALL',
        using: TENANT_POLICY,
        check: TENANT_POLICY,
      },
    ]);
  });

  it('widens access only for the jobs role, on a table listed for it', () => {
    const others = policies.filter(
      (p) => p.table === table.name && p.permissive === 'PERMISSIVE' && !p.roles.includes('public'),
    );
    for (const policy of others) expect(policy.roles).toEqual([JOBS_ROLE]);
    if (others.length > 0) expect(JOBS_ACCESS[table.name]).toBeDefined();
  });

  it('starts every secondary index with tenant_id, but the listed cross-tenant claim indexes', () => {
    const exceptions = CROSS_TENANT_INDEXES[table.name] ?? [];
    if (exceptions.length > 0) expect(JOBS_ACCESS[table.name]).toBeDefined();
    for (const index of indexes.filter((i) => i.table === table.name && !i.primary)) {
      if (exceptions.includes(index.name)) expect(index.partial, index.name).toBe(true);
      else expect(index.columns[0], index.name).toBe('tenant_id');
    }
  });
});

describe.each(tables.filter((table) => registry[table.name]?.kind === 'append-only'))(
  'append-only table $name',
  (table) => {
    it('refuses UPDATE, DELETE and TRUNCATE by enabled triggers', () => {
      const guards = triggers.filter(
        (t) => t.table === table.name && t.fn === 'refuse_change' && t.type & BEFORE,
      );
      for (const guard of guards) expect(TRIGGER_ENABLED).toContain(guard.enabled);
      const events = guards.reduce((all, t) => all | (t.type & REFUSED_EVENTS), 0);
      expect(events).toBe(REFUSED_EVENTS);
    });
  },
);

describe('current_tenant_id()', () => {
  it('reads only the transaction setting, with no fallback, as the owner without definer rights', async () => {
    const [fn] = await rows<{ source: string; definer: boolean; owner: string; config: unknown }>(
      `select prosrc as source, prosecdef as definer, pg_get_userbyid(proowner) as owner,
              proconfig as config
       from pg_proc where oid = 'public.current_tenant_id()'::regprocedure`,
    );
    expect(fn?.source.trim()).toBe(TENANT_FUNCTION);
    expect(fn).toMatchObject({ definer: false, owner: OWNER_ROLE, config: null });
  });
});

describe('functions', () => {
  it('none runs with its owner rights', async () => {
    const definers = await rows<{ name: string }>(
      `select proname as name from pg_proc
       where pronamespace = 'public'::regnamespace and prosecdef`,
    );
    expect(definers).toEqual([]);
  });
});

describe('publications', () => {
  it('publish exactly the tables the sync role may read', async () => {
    const published = await rows<{ table: string }>(
      `select tablename as table from pg_publication_tables order by 1`,
    );
    expect(published.map((p) => p.table)).toEqual([...SYNC_ACCESS].sort());
    const all = await rows<{ name: string }>(
      `select pubname as name from pg_publication where puballtables`,
    );
    expect(all).toEqual([]);
  });
});

describe('schemas', () => {
  it('are public, the migration journal and pg-boss, all owned by the owner role', async () => {
    const schemas = await rows<{ name: string; owner: string }>(
      `select nspname as name, pg_get_userbyid(nspowner) as owner from pg_namespace
       where nspname not in ('pg_catalog', 'information_schema')
         and nspname not like 'pg\\_toast%' and nspname not like 'pg\\_temp%'
       order by 1`,
    );
    expect(schemas.map((schema) => schema.name)).toEqual(SCHEMAS);
    for (const schema of schemas.filter((s) => s.name !== 'public')) {
      expect(schema.owner, schema.name).toBe(OWNER_ROLE);
    }
  });

  it('let no role but the owner create objects in public', async () => {
    const creators = await rows<{ role: string }>(
      `select rolname as role from pg_roles
       where rolname = any($1) and has_schema_privilege(rolname, 'public', 'CREATE')
       order by 1`,
      [ROLES],
    );
    expect(creators).toEqual([{ role: OWNER_ROLE }]);
  });

  it('open pg-boss to the queue role, and only its use to the jobs role', async () => {
    const grants = await rows<{ grantee: string; privilege: string }>(
      `select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
              a.privilege_type as privilege
       from pg_namespace n, aclexplode(n.nspacl) a
       where n.nspname = $1 and a.grantee <> n.nspowner
       order by 1, 2`,
      [QUEUE_SCHEMA],
    );
    expect(grants).toEqual([
      { grantee: JOBS_ROLE, privilege: 'USAGE' },
      { grantee: QUEUE_ROLE, privilege: 'CREATE' },
      { grantee: QUEUE_ROLE, privilege: 'USAGE' },
    ]);
  });
});

describe('roles', () => {
  it('none is a superuser, and only the sync role bypasses row-level security', async () => {
    const roles = await rows<{ name: string; superuser: boolean; bypass: boolean }>(
      `select rolname as name, rolsuper as superuser, rolbypassrls as bypass
       from pg_roles where rolname = any($1) order by 1`,
      [ROLES],
    );
    expect(roles).toEqual([
      { name: APP_ROLE, superuser: false, bypass: false },
      { name: JOBS_ROLE, superuser: false, bypass: false },
      { name: OWNER_ROLE, superuser: false, bypass: false },
      { name: QUEUE_ROLE, superuser: false, bypass: false },
      { name: SYNC_ROLE, superuser: false, bypass: true },
    ]);
  });

  it('no role is a member of another role, so none can switch to one', async () => {
    const memberships = await rows<{ member: string; role: string }>(
      `select pg_get_userbyid(member) as member, pg_get_userbyid(roleid) as role
       from pg_auth_members
       where pg_get_userbyid(member) = any($1) or pg_get_userbyid(roleid) = any($1)`,
      [ROLES],
    );
    expect(memberships).toEqual([]);
  });

  it('the app, queue and sync roles have no other power and no setting', async () => {
    const powers = await rows<Record<string, unknown>>(
      `select r.rolname as name, r.rolcreaterole as "createRole", r.rolcreatedb as "createDb",
              r.rolreplication as replication, r.rolinherit as inherit,
              exists (select 1 from pg_db_role_setting s where s.setrole = r.oid) as settings
       from pg_roles r where r.rolname = any($1) order by 1`,
      [[APP_ROLE, QUEUE_ROLE, SYNC_ROLE]],
    );
    const none = { createRole: false, createDb: false, inherit: false, settings: false };
    expect(powers).toEqual([
      { name: APP_ROLE, ...none, replication: false },
      { name: QUEUE_ROLE, ...none, replication: false },
      // Logical replication is the sync service's job (ADR 0022).
      { name: SYNC_ROLE, ...none, replication: true },
    ]);
  });

  it('the jobs role has no other power, and every statement it runs is logged without values', async () => {
    const [jobs] = await rows<Record<string, unknown>>(
      `select r.rolcreaterole as "createRole", r.rolcreatedb as "createDb",
              r.rolreplication as replication, r.rolinherit as inherit,
              array(select setting
                    from pg_db_role_setting s, unnest(s.setconfig) as setting
                    where s.setrole = r.oid and s.setdatabase = 0 order by 1) as settings
       from pg_roles r where r.rolname = $1`,
      [JOBS_ROLE],
    );
    expect(jobs).toEqual({
      createRole: false,
      createDb: false,
      replication: false,
      inherit: false,
      settings: ['log_parameter_max_length=0', 'log_statement=all'],
    });
  });

  it('the owner may create databases (local test runs) and nothing more', async () => {
    const [ownerRole] = await rows<Record<string, unknown>>(
      `select rolcreaterole as "createRole", rolreplication as replication
       from pg_roles where rolname = $1`,
      [OWNER_ROLE],
    );
    expect(ownerRole).toEqual({ createRole: false, replication: false });
  });
});
