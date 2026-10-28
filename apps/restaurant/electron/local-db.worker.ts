import { workerData } from 'node:worker_threads';
import { startPowerSyncWorker } from '@powersync/node/worker.js';
import Database from 'better-sqlite3-multiple-ciphers';

// The PowerSync database worker on SQLite3MultipleCiphers (spec S04 "On the PC", ADR 0022), from
// Spike A's tested `encrypted.worker.mjs`. The key is applied in the connection's constructor: the
// SDK's `initializeConnection` hook runs after `powersync_update_hooks('install')`, which already
// fails with "file is not a database" on an encrypted file. Nothing here imports app code, so the
// unit tests run this file as TypeScript in a worker thread.

const { hexKey } = workerData as { hexKey: string };
if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('A 256-bit hex key is required');

class EncryptedDatabase extends Database {
  constructor(file: string, options?: Database.Options) {
    super(file, options);
    this.pragma(`hexkey='${hexKey}'`);
    // Fails at once on a wrong key instead of at the first query.
    this.pragma('user_version');
    // The SDK leaves synchronous=NORMAL, which in WAL mode can lose the last commits on a power cut.
    if (!options?.readonly) this.pragma('synchronous = FULL');
  }
}

startPowerSyncWorker({ loadBetterSqlite3: async () => EncryptedDatabase });
