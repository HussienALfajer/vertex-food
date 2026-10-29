import { type HubPairResult, hubPairResultSchema } from '@vertex-food/contracts';
import type { OutboxItem, OutboxStore } from '@vertex-food/sync';

// What a hub client keeps in IndexedDB (spec S04, "On a hub client"): the pairing (token, kind,
// both hub-capable PCs' addresses, the CA fingerprint) and the outbox, pending commands and
// versions answered `mirrored: false`, each with its schema version. The PIN session token is
// kept in memory only. IndexedDB belongs to the page's origin: a page reloaded from the other PC
// after a failover starts without them (Q17 decides between these pages and an app).

const DATABASE = 'vertex-food-hub-client';
const PAIRING = 'pairing';
const OUTBOX = 'outbox';
const PAIRING_KEY = 'current';

/** The version of an outbox record; a record of another version is left for the page that wrote it. */
const OUTBOX_VERSION = 1;

type OutboxRecord = { id: string; schemaVersion: number; item: OutboxItem };

export type StoredPairing = HubPairResult & { pairedAt: string };

let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PAIRING);
      // Ids are UUIDv7, so the key order is the order the commands were made in.
      request.result.createObjectStore(OUTBOX, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error);
    };
  });
  return opened;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (objects: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        // Resolved once the transaction is durable, not when the request is answered.
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export async function readPairing(): Promise<StoredPairing | null> {
  const value: unknown = await run(PAIRING, 'readonly', (objects) => objects.get(PAIRING_KEY));
  const parsed = hubPairResultSchema.safeParse(value);
  if (!parsed.success || typeof (value as { pairedAt?: unknown }).pairedAt !== 'string') {
    return null;
  }
  return { ...parsed.data, pairedAt: (value as { pairedAt: string }).pairedAt };
}

export async function savePairing(pairing: StoredPairing): Promise<void> {
  await run(PAIRING, 'readwrite', (objects) => objects.put(pairing, PAIRING_KEY));
}

/** The pairing ended (revoked or expired): the token goes; the outbox stays for a new pairing. */
export async function clearPairing(): Promise<void> {
  await run(PAIRING, 'readwrite', (objects) => objects.delete(PAIRING_KEY));
}

/** The outbox of `HubClient`, surviving a reload or a closed browser. */
export const indexedDbOutbox: OutboxStore = {
  async list() {
    const records: OutboxRecord[] = await run(OUTBOX, 'readonly', (objects) => objects.getAll());
    return records.filter((r) => r.schemaVersion === OUTBOX_VERSION).map((r) => r.item);
  },
  async put(item) {
    const record: OutboxRecord = { id: item.command.id, schemaVersion: OUTBOX_VERSION, item };
    await run(OUTBOX, 'readwrite', (objects) => objects.put(record));
  },
  async delete(id) {
    await run(OUTBOX, 'readwrite', (objects) => objects.delete(id));
  },
};
