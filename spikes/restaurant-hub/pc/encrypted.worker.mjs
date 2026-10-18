// PowerSync database worker backed by SQLite3MultipleCiphers (encrypted SQLite). Copied from Vertex Shifa's Spike A.
//
// The key is applied in the connection's constructor. The documented `initializeConnection` hook is too late:
// @powersync/node 1.1.x runs `SELECT powersync_update_hooks('install')` on the writer before calling it, which
// fails with "file is not a database" whenever an existing encrypted file is reopened.
import { workerData } from 'node:worker_threads';
import Database from 'better-sqlite3-multiple-ciphers';
import { startPowerSyncWorker } from '@powersync/node/worker.js';

const { hexKey } = workerData;
if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('a 256-bit hex key is required');

class EncryptedDatabase extends Database {
  constructor(file, options) {
    super(file, options);
    this.pragma(`hexkey='${hexKey}'`);
    this.pragma('user_version'); // fails early on a wrong key
    // The SDK leaves synchronous=NORMAL; in WAL mode that can lose the last commits on a power cut.
    if (!options?.readonly) this.pragma('synchronous = FULL');
  }
}

startPowerSyncWorker({ loadBetterSqlite3: async () => EncryptedDatabase });
