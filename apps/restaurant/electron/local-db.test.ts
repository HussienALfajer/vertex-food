import { closeSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { describe, expect, it } from 'vitest';
import { tempFolder } from './device-test-kit.js';
import {
  destroyLocalDatabase,
  generateDatabaseKey,
  LOCAL_DB_FILE,
  type OpenedDatabase,
  openLocalDatabase,
} from './local-db.js';

const marker = 'synthetic-marker-1f3a';

async function withRows(directory: string, key: string, rows = 1): Promise<void> {
  const opened = await openLocalDatabase(directory, key);
  if (!opened.db) throw new Error('Expected a whole database');
  await opened.db.writeTransaction(async (tx) => {
    for (let index = 0; index < rows; index += 1) {
      await tx.execute(
        'INSERT INTO local_events (id, action, at, details) VALUES (uuid(), ?, ?, ?)',
        ['pin.failed', new Date().toISOString(), `${marker}-${index}-${'x'.repeat(200)}`],
      );
    }
  });
  await opened.close();
}

async function count(opened: OpenedDatabase): Promise<number> {
  const row = await opened.reads.getOptional<{ n: number }>(
    'SELECT count(*) AS n FROM local_events',
  );
  return row?.n ?? 0;
}

describe('the encrypted local database (spec S04 "On the PC")', () => {
  it('reopens with its key, keeps nothing in clear and writes with synchronous=FULL', async () => {
    const directory = tempFolder();
    const key = generateDatabaseKey();
    await withRows(directory, key);
    const reopened = await openLocalDatabase(directory, key);
    expect(reopened.state).toBe('ok');
    expect(await count(reopened)).toBe(1);
    const synchronous = await reopened.db?.writeLock((tx) =>
      tx.get<{ synchronous: number }>('PRAGMA synchronous'),
    );
    // 2 = FULL: a power cut in WAL mode keeps the last commits.
    expect(synchronous?.synchronous).toBe(2);
    await reopened.close();
    const file = readFileSync(join(directory, LOCAL_DB_FILE));
    expect(file.includes(Buffer.from(marker))).toBe(false);
    expect(file.subarray(0, 15).toString()).not.toBe('SQLite format 3');
  });

  it('opens read-only without a write handle when the key does not open the file', async () => {
    const directory = tempFolder();
    await withRows(directory, generateDatabaseKey());
    const opened = await openLocalDatabase(directory, generateDatabaseKey());
    expect(opened.state).toBe('corrupt');
    expect(opened.db).toBeNull();
    // Nothing is read as "nothing pending": every read throws.
    await expect(count(opened)).rejects.toThrow('cannot be read');
    await opened.close();
  });

  it('opens read-only when integrity_check fails, and never answers a damaged read empty', async () => {
    const directory = tempFolder();
    const key = generateDatabaseKey();
    await withRows(directory, key, 400);
    const path = join(directory, LOCAL_DB_FILE);
    // Every commit is in the main file before a page in its middle is damaged.
    const raw = new Database(path);
    raw.pragma(`hexkey='${key}'`);
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.close();
    // Every page after the first is damaged: which pages a read touches depends on the random
    // rows' layout, so damaging one page left some reads whole (a flaky test).
    const size = statSync(path).size;
    const handle = openSync(path, 'r+');
    for (let page = 4096; page < size; page += 4096) {
      writeSync(handle, Buffer.alloc(512, 0x5a), 0, 512, page + 100);
    }
    closeSync(handle);
    const opened = await openLocalDatabase(directory, key);
    expect(opened.state).toBe('corrupt');
    expect(opened.db).toBeNull();
    // A damaged page throws rather than reading as "nothing pending".
    await expect(count(opened)).rejects.toThrow();
    await opened.close();
  });

  it('opens read-only, never failing, when the database cannot open at all', async () => {
    // A folder that cannot be made (a file in its place) stands in for a full disk.
    const parent = tempFolder();
    const blocked = join(parent, 'data');
    writeFileSync(blocked, 'not a folder');
    const opened = await openLocalDatabase(blocked, generateDatabaseKey());
    expect(opened.state).toBe('corrupt');
    // Nothing is read as "nothing pending": every read throws.
    await expect(count(opened)).rejects.toThrow('cannot be read');
    await opened.close();
  });

  it('deletes the file and its WAL when a revoked PC wipes (rule 40)', async () => {
    const directory = tempFolder();
    const key = generateDatabaseKey();
    await withRows(directory, key);
    const opened = await openLocalDatabase(directory, key);
    await destroyLocalDatabase(directory, opened);
    expect(() => statSync(join(directory, LOCAL_DB_FILE))).toThrow();
    expect(() => statSync(join(directory, `${LOCAL_DB_FILE}-wal`))).toThrow();
  });
});
