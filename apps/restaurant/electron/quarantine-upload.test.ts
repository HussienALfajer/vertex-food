import { createPublicKey, verify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CommandEnvelope,
  type QuarantineUpload,
  quarantineUploadMessage,
} from '@vertex-food/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DeviceApi, DeviceApiError, type SyncApi } from './device-client.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import {
  commandEnvelope,
  member,
  memberList,
  tempFolder,
  tempStore,
  uuid7,
  verifyPin,
} from './device-test-kit.js';
import { generateDatabaseKey, LOCAL_DB_FILE } from './local-db.js';
import { LocalStore } from './local-store.js';
import { pendingEnvelopes } from './pending-work.js';
import { quarantineParts, uploadQuarantine } from './quarantine-upload.js';

const now = new Date('2026-10-27T09:00:00.000Z');
const key = generateDeviceKey();

const opened: LocalStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.opened.close()));
});

function registrationOf(deviceId = uuid7()) {
  return {
    tenantId: uuid7(),
    branchId: uuid7(),
    deviceId,
    privateKey: key.privateKey,
    publicKey: key.publicKey,
  };
}

/** A queue of commands and a journal: settled by the log, by a local outcome, or not at all. */
async function withPendingWork(local: LocalStore, deviceId: string) {
  const db = local.opened.db;
  if (!db) throw new Error('Expected a whole database');
  const made = (epoch: number, seq: number): CommandEnvelope => ({
    ...commandEnvelope(key.privateKey, deviceId, seq, now),
    hubEpoch: epoch,
  });
  const queued = [made(2, 1), made(1, 7)];
  const unsettled = made(1, 3);
  const logged = made(1, 4);
  const answered = made(1, 5);
  await db.writeTransaction(async (tx) => {
    for (const sent of queued) {
      await tx.execute('INSERT INTO commands (id, envelope, mirrored) VALUES (?, ?, 1)', [
        sent.id,
        JSON.stringify(sent),
      ]);
    }
    // The journal also holds a queued one: it is sent once.
    for (const entry of [unsettled, logged, answered, queued[1] as CommandEnvelope]) {
      await tx.execute(
        "INSERT INTO hub_journal (id, seq, epoch, kind, body) VALUES (?, ?, ?, 'command', ?)",
        [
          entry.id,
          entry.hubSeq,
          entry.hubEpoch,
          JSON.stringify({ kind: 'command', envelope: entry, numberUsed: null }),
        ],
      );
    }
    await tx.execute("INSERT INTO command_log (id, outcome) VALUES (?, 'accepted')", [logged.id]);
    await tx.execute("INSERT INTO command_results (id, outcome) VALUES (?, 'rejected')", [
      answered.id,
    ]);
  });
  // Journal order: epoch, then sequence.
  return [unsettled, queued[1], queued[0]] as CommandEnvelope[];
}

function fakeSync(): SyncApi & { quarantine: ReturnType<typeof vi.fn> } {
  let nonces = 0;
  return {
    challenge: vi.fn(async () => {
      nonces += 1;
      return { nonce: `nonce-${nonces}`, expiresAt: now.toISOString() };
    }),
    quarantine: vi.fn(async (_body: QuarantineUpload) => ({ batchId: uuid7() })),
    syncToken: vi.fn(),
    uploadCommands: vi.fn(),
    heartbeat: vi.fn(),
    numberBlocks: vi.fn(),
    certificate: vi.fn(),
  };
}

const publicKey = createPublicKey({
  key: {
    kty: 'OKP',
    crv: 'Ed25519',
    x: Buffer.from(key.publicKey, 'base64').toString('base64url'),
  },
  format: 'jwk',
});

describe('the quarantine upload (spec S04 rule 40)', () => {
  it('gathers the queue and the unsettled journal once each, in journal order', async () => {
    const registration = registrationOf();
    const local = await LocalStore.open(tempFolder(), generateDatabaseKey());
    opened.push(local);
    const expected = await withPendingWork(local, registration.deviceId);
    expect(await pendingEnvelopes(local.opened.reads)).toEqual(expected);
  });

  it('splits a batch into parts under the API body limit', () => {
    const envelopes = Array.from({ length: 10 }, (_, seq) =>
      commandEnvelope(key.privateKey, uuid7(), seq + 1, now),
    );
    const size = Buffer.byteLength(JSON.stringify(envelopes[0])) + 1;
    const parts = quarantineParts(envelopes, size * 4);
    expect(parts.map((part) => part.length)).toEqual([4, 4, 2]);
    expect(parts.flat()).toEqual(envelopes);
  });

  it('signs each part over a fresh challenge nonce', async () => {
    const registration = registrationOf();
    const local = await LocalStore.open(tempFolder(), generateDatabaseKey());
    opened.push(local);
    await withPendingWork(local, registration.deviceId);
    const client = fakeSync();
    await uploadQuarantine({
      reads: local.opened.reads,
      registration,
      client,
      sign: signWithDeviceKey,
    });
    const [body] = client.quarantine.mock.calls.map(([sent]) => sent as QuarantineUpload);
    expect(body).toMatchObject({
      tenantId: registration.tenantId,
      deviceId: registration.deviceId,
      nonce: 'nonce-1',
    });
    expect(body?.commands).toHaveLength(3);
    const message = Buffer.from(quarantineUploadMessage('nonce-1', registration.deviceId));
    expect(verify(null, message, publicKey, Buffer.from(body?.signature ?? '', 'base64'))).toBe(
      true,
    );
  });

  it('fails while the API cannot be reached, and stops once the server recorded the wipe', async () => {
    const registration = registrationOf();
    const local = await LocalStore.open(tempFolder(), generateDatabaseKey());
    opened.push(local);
    await withPendingWork(local, registration.deviceId);
    const client = fakeSync();
    const input = { reads: local.opened.reads, registration, client, sign: signWithDeviceKey };
    client.quarantine.mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    await expect(uploadQuarantine(input)).rejects.toThrow('NETWORK_ERROR');
    client.quarantine.mockRejectedValueOnce(new DeviceApiError('DEVICE_REVOKED'));
    await expect(uploadQuarantine(input)).resolves.toBeUndefined();
  });
});

describe('the wipe after the quarantine upload (rule 40, S02 rule 19)', () => {
  it('uploads, then deletes the database and the keys, retried until the upload succeeds', async () => {
    const owner = await member('مالك', '602847', { roles: ['owner'] });
    const list = memberList([owner], now.toISOString());
    const { store } = tempStore();
    const folder = tempFolder();
    const registration = { ...registrationOf(list.device.id), databaseKey: generateDatabaseKey() };
    store.write({
      state: 'registered',
      registration,
      memberList: list,
      membersSyncedAt: now.toISOString(),
      highestSeenAt: now.toISOString(),
      local: {},
    });
    const sync = fakeSync();
    sync.quarantine.mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    // The device token is refused: the PC is revoked.
    const revoked = vi.fn(async () => {
      throw new DeviceApiError('DEVICE_REVOKED');
    });
    const api = {
      challenge: sync.challenge,
      token: revoked,
      wiped: revoked,
    } as unknown as DeviceApi;
    const service = await DeviceService.open({
      store,
      client: api,
      verifyPin,
      generateKey: generateDeviceKey,
      sign: signWithDeviceKey,
      now: () => now,
      elapsed: () => now.getTime(),
      os: 'win32 10.0',
      appVersion: '0.0.0',
      onChange: () => undefined,
      openData: async (databaseKey) => {
        const local = await LocalStore.open(folder, databaseKey);
        opened.push(local);
        return local;
      },
      generateDatabaseKey,
      quarantine: async (from, data) => {
        if (!(data instanceof LocalStore)) throw new Error('Unknown local data');
        await uploadQuarantine({
          reads: data.opened.reads,
          registration: from,
          client: sync,
          sign: signWithDeviceKey,
        });
      },
    });
    const local = opened[0];
    if (!local) throw new Error('Expected the database open');
    const pending = await withPendingWork(local, registration.deviceId);
    // The first upload fails: the database and the key stay.
    await service.refresh();
    expect(store.read()).toMatchObject({ state: 'wiping', quarantined: false });
    expect(existsSync(join(folder, LOCAL_DB_FILE))).toBe(true);
    await service.refresh();
    const sent = sync.quarantine.mock.calls.at(-1)?.[0] as QuarantineUpload | undefined;
    expect(sent?.commands.map((command) => command.id)).toEqual(pending.map((p) => p.id));
    expect(existsSync(join(folder, LOCAL_DB_FILE))).toBe(false);
    // Only the notice is left: no key, no database key.
    expect(store.read()).toEqual({ state: 'wiped', tenantName: list.tenant.nameAr });
  });
});
