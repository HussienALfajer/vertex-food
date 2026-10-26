import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * A migrated throwaway database: the URLs of the owner, app, jobs, queue and sync roles for it,
 * and how to drop it.
 */
export type TestDatabase = {
  ownerUrl: string;
  appUrl: string;
  jobsUrl: string;
  queueUrl: string;
  syncUrl: string;
  drop: () => Promise<void>;
};

function url(name: string): URL {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Tests that use the database need a local PostgreSQL 17: copy ` +
        '.env.example to .env, then run pnpm db:setup-local (packages/db/CLAUDE.md).',
    );
  }
  return new URL(value);
}

// Far longer than any run: a test database this old was left by a run that was killed before its
// global teardown dropped it.
const STALE_AFTER_MS = 6 * 60 * 60_000;

/** Whether a database is a test run's (`food_test_<time>_<random>`) created long enough ago. */
export function isStaleTestDatabase(name: string, now: number): boolean {
  const created = /^food_test_(\d+)_[0-9a-f]{6}$/.exec(name)?.[1];
  return created !== undefined && now - Number(created) >= STALE_AFTER_MS;
}

/**
 * Drops the test databases that killed runs left behind (`isStaleTestDatabase`) and nobody is
 * connected to. A plain `DROP` refuses a database still in use, so a run of another checkout that
 * is still going keeps its own.
 */
async function dropStaleTestDatabases(admin: pg.Client): Promise<void> {
  const now = Date.now();
  const { rows } = await admin.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname LIKE 'food_test_%'",
  );
  for (const { datname } of rows) {
    if (!isStaleTestDatabase(datname, now)) continue;
    try {
      await admin.query(`DROP DATABASE ${datname}`);
    } catch (error) {
      // 55006: still in use; 3D000: another run dropped it first.
      const code = (error as { code?: string }).code;
      if (code !== '55006' && code !== '3D000') throw error;
    }
  }
}

/**
 * Creates a fresh database as the owner role (from `DATABASE_OWNER_URL`, `DATABASE_APP_URL`,
 * `DATABASE_JOBS_URL`, `DATABASE_QUEUE_URL` and `DATABASE_SYNC_URL`) and applies every migration
 * to it, so test runs never share or leave data behind. For a package's or app's test global
 * setup; call `drop` when the run ends.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const owner = url('DATABASE_OWNER_URL');
  const roles = [
    'DATABASE_APP_URL',
    'DATABASE_JOBS_URL',
    'DATABASE_QUEUE_URL',
    'DATABASE_SYNC_URL',
  ];
  const [app, jobs, queue, sync] = roles.map(url) as [URL, URL, URL, URL];
  const name = `food_test_${Date.now()}_${randomBytes(3).toString('hex')}`;

  const admin = new pg.Client({ connectionString: owner.href });
  await admin.connect();
  await dropStaleTestDatabases(admin);
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  const drop = async () => {
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  };

  for (const role of [owner, app, jobs, queue, sync]) role.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: owner.href, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
  } catch (error) {
    await drop();
    throw error;
  } finally {
    await pool.end();
  }

  return {
    ownerUrl: owner.href,
    appUrl: app.href,
    jobsUrl: jobs.href,
    queueUrl: queue.href,
    syncUrl: sync.href,
    drop,
  };
}
