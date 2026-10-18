// Prepares a local PostgreSQL 17 for Vertex Food: creates or updates the five roles, then the
// development database owned by the owner role (packages/db/CLAUDE.md, Roles):
// - owner: runs migrations, owns the tables; may create the throwaway test databases;
// - app: what the apps connect as; cannot bypass RLS;
// - jobs: the worker's cross-tenant platform jobs; cannot bypass RLS, every statement it runs is
//   logged without its values;
// - queue: pg-boss, in its own schema only;
// - sync: the sync service's replication role (ADR 0022, Vertex Shifa ADR 0021); REPLICATION and
//   BYPASSRLS, with SELECT only on the tables a migration publishes to it. REPLICATION also lets
//   it decode the whole WAL with any output plugin the server has, so servers carry pgoutput only
//   (packages/db/CLAUDE.md, open question Q20).
// Safe to run again: it only creates what is missing and resets the roles' passwords and
// attributes. It never drops anything and does not migrate (`pnpm db:migrate` does).
// Run from the repository root: `pnpm db:setup-local`, with the six URLs of .env.example in .env
// or the environment. Local machines and CI only: servers get their roles from deploy/.
import pg from 'pg';

const ROLES = {
  DATABASE_OWNER_URL: {
    name: 'food_owner',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION CREATEDB',
  },
  DATABASE_APP_URL: {
    name: 'food_app',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
  DATABASE_JOBS_URL: {
    name: 'food_jobs',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
  DATABASE_QUEUE_URL: {
    name: 'food_queue',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
  // Its snapshot reads would return no rows under RLS, so it bypasses it; it is granted no
  // write (ADR 0022). Isolation of the data it streams to devices rests on the sync rules' filters.
  DATABASE_SYNC_URL: {
    name: 'food_sync',
    attributes: 'NOSUPERUSER BYPASSRLS NOCREATEROLE REPLICATION NOCREATEDB NOINHERIT',
  },
} as const;

function url(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: copy .env.example to .env and fill it in`);
  return new URL(value);
}

const admin = url('DATABASE_ADMIN_URL');
const roles = Object.entries(ROLES).map(([variable, role]) => ({
  ...role,
  variable,
  url: url(variable),
}));
const database = decodeURIComponent(url('DATABASE_OWNER_URL').pathname.slice(1));

for (const role of roles) {
  if (role.url.username !== role.name) {
    throw new Error(`${role.variable} must use the role ${role.name}`);
  }
  if (decodeURIComponent(role.url.pathname.slice(1)) !== database) {
    throw new Error('The owner, app, jobs, queue and sync URLs must name the same database');
  }
}
if (!database) throw new Error('DATABASE_OWNER_URL must name the database');

const client = new pg.Client({ connectionString: admin.href });
await client.connect();
try {
  const { rows } = await client.query<{ version: number }>(
    "select current_setting('server_version_num')::int as version",
  );
  if ((rows[0]?.version ?? 0) < 170000) throw new Error('PostgreSQL 17 or later is required');

  for (const role of roles) {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [role.name]);
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    await client.query(
      `${verb} ROLE ${client.escapeIdentifier(role.name)} WITH LOGIN ${role.attributes} PASSWORD ${client.escapeLiteral(decodeURIComponent(role.url.password))}`,
    );
    process.stdout.write(`${verb === 'CREATE' ? 'created' : 'updated'} role ${role.name}\n`);
  }
  // The audit of the platform-jobs role (ADR 0004): every statement it runs goes to the server log,
  // without its parameter values, which carry outbox payloads into pg-boss (ADR 0016). Only a
  // superuser may change either setting, so its sessions cannot turn this off.
  await client.query(`ALTER ROLE ${ROLES.DATABASE_JOBS_URL.name} SET log_statement = 'all'`);
  await client.query(`ALTER ROLE ${ROLES.DATABASE_JOBS_URL.name} SET log_parameter_max_length = 0`);

  const existing = await client.query<{ owner: string }>(
    'select pg_get_userbyid(datdba) as owner from pg_database where datname = $1',
    [database],
  );
  const owner = ROLES.DATABASE_OWNER_URL.name;
  const current = existing.rows[0];
  if (!current) {
    await client.query(
      `CREATE DATABASE ${client.escapeIdentifier(database)} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0`,
    );
    process.stdout.write(`created database ${database}\n`);
  } else if (current.owner !== owner) {
    throw new Error(`Database ${database} exists and belongs to ${current.owner}, not ${owner}`);
  } else {
    process.stdout.write(`database ${database} exists\n`);
  }
} finally {
  await client.end();
}
