// One SQLite database for the queue (shared core) and a few settings. Opened once per process: the screen
// and a background start of the location task use the same module.
import { getRandomBytes } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Outbox } from '../../core/outbox.js';
import { uuidv7 } from '../../core/uuid7.js';

const raw = SQLite.openDatabaseSync('driver.db');
raw.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
raw.execSync('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');

const db = {
  run: (sql, params) => raw.runSync(sql, params),
  all: (sql, params) => raw.getAllSync(sql, params),
  tx: (fn) => raw.withTransactionSync(fn),
};

const newId = (ms) => uuidv7(ms, (n) => getRandomBytes(n));
// A new run id each time the process starts: the monotonic clock below is only valid within one run.
export const RUN = newId(Date.now());
export const clock = { run: RUN, stamp: () => ({ wall: Date.now(), mono: Math.round(performance.now()), run: RUN }) };
export const outbox = new Outbox(db, { clock, newId });

export function get(k, fallback = null) {
  const row = raw.getFirstSync('SELECT v FROM kv WHERE k = ?', [k]);
  return row ? JSON.parse(row.v) : fallback;
}

export function set(k, v) {
  raw.runSync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [k, JSON.stringify(v)]);
}

// Counters for the spike's diagnostics (sent to the server with each batch: counts only, no locations).
export function bump(k, by = 1) {
  set(k, get(k, 0) + by);
}
