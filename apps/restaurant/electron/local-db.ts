import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { column, PowerSyncDatabase, Schema, Table } from '@powersync/node';
import Database from 'better-sqlite3-multiple-ciphers';

// The PC's local database (spec S04 "On the PC", ADR 0008, 0022): PowerSync on SQLite3MultipleCiphers,
// encrypted with a 256-bit key per installation that `safeStorage` seals (`device-store.ts`), with
// `synchronous=FULL` (`local-db.worker.ts`). Synced tables mirror the columns of the streams in
// `packages/sync/powersync/sync-config.yaml`; local-only tables are never uploaded and never touched
// by a checkpoint. PowerSync keeps every table as JSON behind a view, so adding a column is a change
// of this schema, not a migration.

const text = column.text;
const int = column.integer;

export const localSchema = new Schema({
  // Synced, read-only on the PC (the streams' columns).
  tenants: new Table({ name_ar: text, status: text, logo_file_id: text }),
  branches: new Table({
    name_ar: text,
    name_latin: text,
    default_currency: text,
    accepted_currencies: text,
    business_day_ends_at: text,
    idle_lock_minutes: int,
  }),
  devices: new Table({ name: text, status: text, hub_role: text, public_key: text }),
  device_certificates: new Table({
    device_id: text,
    fingerprint_sha256: text,
    lan_addresses: text,
    expires_at: text,
  }),
  branch_certificate_authorities: new Table({ certificate_pem: text, fingerprint_sha256: text }),
  command_log: new Table({
    branch_id: text,
    name: text,
    outcome: text,
    reason: text,
    details: text,
    executed_by_device_id: text,
    origin_device_id: text,
    membership_id: text,
    received_at: text,
  }),
  attention_items: new Table({
    command_id: text,
    kind: text,
    membership_id: text,
    created_at: text,
  }),
  attention_resolutions: new Table({
    item_id: text,
    reason: text,
    resolved_by_membership_id: text,
    resolved_at: text,
  }),
  // The upload queue (ADR 0021 of Vertex Shifa): one row per signed command, never stored locally,
  // only queued; `envelope` is its JSON, `mirrored` whether the standby held it (rule 5).
  commands: new Table({ envelope: text, mirrored: int }, { insertOnly: true }),
  // Local-only (rules 5, 18, 21–36). The hub's ports (PR 5) read and write them.
  hub_state: new Table(
    {
      role: text,
      epoch: int,
      applied_seq: int,
      hub_device_id: text,
      rejoining: int,
      hub_seq: int,
      last_heartbeat_at: text,
      notice: text,
    },
    { localOnly: true },
  ),
  hub_journal: new Table(
    {
      seq: int,
      epoch: int,
      kind: text,
      /** The journal body as JSON: a command's signed envelope, or a local entry. */
      body: text,
      payload_hash: text,
      mirrored: int,
      mirrored_at: text,
      committed_at: text,
      own_lineage: int,
      forwarded_at: text,
    },
    { localOnly: true, indexes: { by_seq: ['seq'] } },
  ),
  hub_pairings: new Table(
    {
      kind: text,
      name: text,
      token_hash: text,
      created_at: text,
      last_used_at: text,
      revoked_at: text,
    },
    { localOnly: true },
  ),
  // id = `<series>:<business date>`.
  number_blocks_local: new Table(
    { series: text, business_date: text, first_number: int, last_number: int, last_used: int },
    { localOnly: true },
  ),
  // S02's member list (rule 29), id = membership id: the listed member and this PC's own record of
  // them; a member no longer listed keeps only the local part (`listed = 0`).
  local_members: new Table(
    {
      listed: int,
      list_version: text,
      name: text,
      roles: text,
      permissions: text,
      pin_verifier: text,
      pin_disabled: int,
      failures: int,
      disabled_here: int,
      first_session_at: text,
    },
    { localOnly: true },
  ),
  // A client PC's outbox (rule 31).
  local_outbox: new Table(
    { command: text, state: text, answer: text, created_at: text },
    { localOnly: true },
  ),
  // Every command this PC made or executed, with its outcome once the server answers (rule 11).
  command_results: new Table(
    {
      name: text,
      membership_id: text,
      payload: text,
      resolved: text,
      outcome: text,
      reason: text,
      details: text,
      made_at: text,
      answered_at: text,
    },
    { localOnly: true },
  ),
  // Offline audit events waiting for `audit.record_local_events`.
  local_events: new Table(
    { action: text, at: text, membership_id: text, pairing_id: text, details: text },
    { localOnly: true },
  ),
});

/** What the PC reads and writes, whether the database opened whole or read-only. */
export type LocalReads = Pick<PowerSyncDatabase, 'getAll' | 'getOptional'>;

export type LocalDatabaseState = 'ok' | 'corrupt';

/**
 * The opened database. A file that fails `integrity_check` (a disk fault, a power cut on a disk
 * that lies about its cache) is opened read-only: what it still holds can be read, nothing is
 * written, and the app shows the corrupt-database notice ("Abuse and failure cases"); the standby
 * or the other PC holds the journal.
 */
export type OpenedDatabase = (
  | { state: 'ok'; db: PowerSyncDatabase }
  | { state: 'corrupt'; db: null }
) & { reads: LocalReads; close(): Promise<void> };

export const LOCAL_DB_FILE = 'local.sqlite';

/** A new installation's key: 256 random bits, hex. */
export function generateDatabaseKey(): string {
  return randomBytes(32).toString('hex');
}

const hexKeyPattern = /^[0-9a-f]{64}$/;

/** The worker file next to this one: TypeScript under the unit tests, JavaScript when built. */
function workerUrl(): URL {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  return new URL(`./local-db.worker.${extension}`, import.meta.url);
}

/** Opens the file with its key outside PowerSync, for the integrity check and read-only use. */
function openRaw(path: string, hexKey: string, readonly: boolean): Database {
  const db = new Database(path, { readonly, fileMustExist: true });
  try {
    db.pragma(`hexkey='${hexKey}'`);
    db.pragma('user_version');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** `integrity_check` answers one row `ok`; a wrong key or a damaged header throws. */
export function passesIntegrityCheck(path: string, hexKey: string): boolean {
  let db: Database | null = null;
  try {
    db = openRaw(path, hexKey, false);
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    return rows.length === 1 && rows[0]?.integrity_check === 'ok';
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** The views of a damaged file, read synchronously; nothing is written. */
function readOnly(path: string, hexKey: string): OpenedDatabase {
  let db: Database | null = null;
  try {
    db = openRaw(path, hexKey, true);
  } catch {
    // Nothing readable: every read answers empty.
  }
  const all = <T>(sql: string, parameters: unknown[] = []): T[] => {
    if (!db) return [];
    try {
      return db.prepare(sql).all(...parameters) as T[];
    } catch {
      return [];
    }
  };
  return {
    state: 'corrupt',
    db: null,
    reads: {
      getAll: async <T>(sql: string, parameters?: unknown[]) => all<T>(sql, parameters),
      getOptional: async <T>(sql: string, parameters?: unknown[]) =>
        all<T>(sql, parameters)[0] ?? null,
    },
    close: async () => {
      db?.close();
      db = null;
    },
  };
}

/**
 * Opens the PC's database in `directory` with its key, after `integrity_check` when the file
 * exists. The key never leaves the main process: it reaches the workers as their start data.
 */
export async function openLocalDatabase(
  directory: string,
  hexKey: string,
): Promise<OpenedDatabase> {
  if (!hexKeyPattern.test(hexKey)) throw new Error('A 256-bit hex key is required');
  const path = join(directory, LOCAL_DB_FILE);
  let db: PowerSyncDatabase | null = null;
  try {
    mkdirSync(directory, { recursive: true });
    if (existsSync(path) && !passesIntegrityCheck(path, hexKey)) return readOnly(path, hexKey);
    db = new PowerSyncDatabase({
      schema: localSchema,
      database: {
        dbFilename: LOCAL_DB_FILE,
        dbLocation: directory,
        openWorker: (_url, options) =>
          new Worker(workerUrl(), { ...options, workerData: { hexKey } }),
      },
    });
    await db.init();
    const opened = db;
    return { state: 'ok', db: opened, reads: opened, close: () => opened.close() };
  } catch {
    // A full disk, a worker or driver that does not load: the app still opens, read-only, with
    // the corrupt-database notice, never without a window.
    await db?.close().catch(() => undefined);
    return readOnly(path, hexKey);
  }
}

/**
 * Deletes the database of a revoked PC (spec S04 rule 40): PowerSync's data and queue first, then
 * the file and its WAL, so nothing of it is left on the disk.
 */
export async function destroyLocalDatabase(
  directory: string,
  opened: OpenedDatabase | null,
): Promise<void> {
  await opened?.db?.disconnectAndClear({ clearLocal: true });
  await opened?.close();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(join(directory, `${LOCAL_DB_FILE}${suffix}`), { force: true });
  }
}
