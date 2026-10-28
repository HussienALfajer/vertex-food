// @peculiar/x509 needs the metadata polyfill before it loads.
import 'reflect-metadata';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { numberBlockDates, numberBlockRange, SYNC_PROTOCOL } from '@vertex-food/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceApiError, type SyncApi } from './device-client.js';
import { generateDeviceKey } from './device-key.js';
import { commandEnvelope, fakeSealer, tempFolder, uuid7 } from './device-test-kit.js';
import { generateDatabaseKey } from './local-db.js';
import { LocalStore } from './local-store.js';
import { CertificateStore } from './pc-certificate.js';
import { pendingCounts } from './pending-work.js';
import { SyncService } from './sync-service.js';

const now = new Date('2026-10-27T09:00:00.000Z');
const serverAhead = 5 * 60_000;

const opened: LocalStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.opened.close()));
});

const key = generateDeviceKey();
const envelope = (deviceId: string, seq: number) =>
  commandEnvelope(key.privateKey, deviceId, seq, now);

/** A self-signed certificate standing in for the branch CA's answer. */
async function issuedFor(addresses: string[]) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    name: 'CN=test',
    keys,
    notBefore: now,
    notAfter: new Date(now.getTime() + 365 * 24 * 3600_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [
      new x509.SubjectAlternativeNameExtension(
        addresses.map((value) => ({ type: 'ip' as const, value })),
      ),
    ],
  });
  const pem = certificate.toString('pem');
  return { certificate: pem, caCertificate: pem, fingerprint: 'b'.repeat(64) };
}

async function setup() {
  const folder = tempFolder();
  const local = await LocalStore.open(folder, generateDatabaseKey());
  opened.push(local);
  const db = local.opened.db;
  if (!db) throw new Error('Expected a whole database');
  const registration = {
    tenantId: uuid7(),
    branchId: uuid7(),
    deviceId: uuid7(),
    privateKey: key.privateKey,
    publicKey: key.publicKey,
  };
  let elapsed = 0;
  const addresses = { value: ['192.168.1.20'] };
  const client = {
    challenge: vi.fn(async () => ({ nonce: 'nonce', expiresAt: now.toISOString() })),
    syncToken: vi.fn(async () => ({
      token: 'sync-token',
      expiresAt: now.toISOString(),
      endpoint: 'http://localhost:8080',
    })),
    uploadCommands: vi.fn<SyncApi['uploadCommands']>(async (_token, body) => ({
      results: body.commands.map(({ envelope: sent }) => ({
        id: sent.id,
        outcome: 'accepted' as const,
        replay: false,
      })),
    })),
    heartbeat: vi.fn<SyncApi['heartbeat']>(async () => ({
      serverTime: new Date(now.getTime() + serverAhead).toISOString(),
      connectivity: 'online' as const,
      minimumAppVersion: '0.0.0',
      protocols: [SYNC_PROTOCOL],
    })),
    numberBlocks: vi.fn<SyncApi['numberBlocks']>(async () => ({
      series: 'order' as const,
      blocks: numberBlockDates(now, '04:00').map((businessDate) => ({
        businessDate,
        ...numberBlockRange(1),
      })),
    })),
    certificate: vi.fn<SyncApi['certificate']>(async (_token, body) =>
      issuedFor(body.lanAddresses),
    ),
    quarantine: vi.fn(async () => ({ batchId: uuid7() })),
  } satisfies SyncApi;
  const recordServerTime = vi.fn();
  const onProtocolRefused = vi.fn();
  const certificates = new CertificateStore(join(folder, 'certificate.bin'), fakeSealer);
  const service = new SyncService({
    registration,
    local: local.opened,
    client,
    deviceCall: (call) => call('device-token'),
    recordServerTime,
    clockOffsetMs: () => 1234,
    now: () => now,
    elapsed: () => {
      elapsed += 100;
      return elapsed;
    },
    appVersion: '1.2.0',
    lanAddresses: () => addresses.value,
    certificates,
    onProtocolRefused,
    onChange: () => undefined,
  });
  const queue = async (count: number, mirrored = true) => {
    const made = Array.from({ length: count }, (_, index) =>
      envelope(registration.deviceId, index + 1),
    );
    await db.writeTransaction(async (tx) => {
      for (const sent of made) {
        await tx.execute('INSERT INTO commands (id, envelope, mirrored) VALUES (?, ?, ?)', [
          sent.id,
          JSON.stringify(sent),
          mirrored ? 1 : 0,
        ]);
      }
    });
    return made;
  };
  return {
    db,
    local,
    registration,
    client,
    service,
    queue,
    recordServerTime,
    onProtocolRefused,
    certificates,
    addresses,
  };
}

describe('the upload connector (spec S04 rules 7–11)', () => {
  it('sends batches of 100 with `mirrored`, keeps every final outcome and empties the queue', async () => {
    const { service, client, queue, local, db } = await setup();
    const made = [...(await queue(120, true)), ...(await queue(30, false))];
    client.uploadCommands.mockImplementation(async (_token, body) => ({
      results: body.commands.map(({ envelope: sent }, index) => ({
        id: sent.id,
        outcome: index === 0 ? ('quarantined' as const) : ('accepted' as const),
        replay: false,
      })),
    }));
    await service.drain();
    expect(client.uploadCommands).toHaveBeenCalledTimes(2);
    const [first, second] = client.uploadCommands.mock.calls.map(([, body]) => body);
    expect(first?.protocol).toBe(SYNC_PROTOCOL);
    expect(first?.commands).toHaveLength(100);
    expect(second?.commands).toHaveLength(50);
    expect(second?.commands.at(-1)).toEqual({ envelope: made.at(-1), mirrored: false });
    expect(await pendingCounts(local.opened.reads)).toEqual({ uploads: 0, unsettled: 0 });
    const results = await db.getAll<{ outcome: string }>('SELECT outcome FROM command_results');
    expect(results).toHaveLength(150);
    expect(results.filter((row) => row.outcome === 'quarantined')).toHaveLength(2);
  });

  it('keeps the batch when the upload fails or an answer is missing', async () => {
    const { service, client, queue, local } = await setup();
    await queue(3);
    client.uploadCommands.mockRejectedValueOnce(new DeviceApiError('NETWORK_ERROR'));
    await expect(service.drain()).rejects.toThrow('NETWORK_ERROR');
    client.uploadCommands.mockResolvedValueOnce({ results: [] });
    await expect(service.drain()).rejects.toThrow('misses a command');
    expect((await pendingCounts(local.opened.reads)).uploads).toBe(3);
    await service.drain();
    expect((await pendingCounts(local.opened.reads)).uploads).toBe(0);
  });

  it('keeps the queue on 426 PROTOCOL_UNSUPPORTED and tells the update gate', async () => {
    const { service, client, queue, local, onProtocolRefused } = await setup();
    await queue(2);
    client.uploadCommands.mockRejectedValueOnce(new DeviceApiError('PROTOCOL_UNSUPPORTED'));
    await expect(service.drain()).rejects.toThrow('PROTOCOL_UNSUPPORTED');
    expect(service.status().protocolRefused).toBe(true);
    expect(onProtocolRefused).toHaveBeenCalled();
    // Nothing is sent again until the update.
    await expect(service.drain()).rejects.toThrow('PROTOCOL_UNSUPPORTED');
    expect(client.uploadCommands).toHaveBeenCalledTimes(1);
    expect((await pendingCounts(local.opened.reads)).uploads).toBe(2);
  });
});

describe('the PowerSync connection (rules 43, 45)', () => {
  it('fetches its credentials with the device token', async () => {
    const { service } = await setup();
    await expect(service.connector.fetchCredentials()).resolves.toEqual({
      endpoint: 'http://localhost:8080',
      token: 'sync-token',
    });
  });

  it('stops downloading below the minimum version and still uploads', async () => {
    const { service, client, queue } = await setup();
    client.syncToken.mockRejectedValueOnce(new DeviceApiError('UPDATE_REQUIRED'));
    await expect(service.connector.fetchCredentials()).rejects.toThrow('UPDATE_REQUIRED');
    expect(service.status().updateRequired).toBe(true);
    await queue(1);
    await service.drain();
    expect(client.uploadCommands).toHaveBeenCalledTimes(1);
  });
});

describe('the heartbeat (rules 14, 17, 39, 43)', () => {
  it('reports the PC, measures the clock offset and keeps the round trip', async () => {
    const { service, client, recordServerTime, queue } = await setup();
    // Uploads that fail stay pending, and the heartbeat says how many.
    client.uploadCommands.mockRejectedValue(new DeviceApiError('NETWORK_ERROR'));
    await queue(4);
    await service.tick();
    expect(client.heartbeat).toHaveBeenLastCalledWith('device-token', {
      lastRoundTripMs: null,
      pendingUploads: 4,
      liveRole: 'client',
      hubEpoch: 0,
      standbyInSync: null,
      appVersion: '1.2.0',
      protocol: SYNC_PROTOCOL,
      lanAddresses: ['192.168.1.20'],
      clockOffsetMs: 1234,
    });
    // A round trip of 100 ms: the server's time is taken at its middle.
    expect(recordServerTime).toHaveBeenLastCalledWith(
      new Date(now.getTime() + serverAhead),
      serverAhead - 50,
    );
    await service.tick();
    expect(client.heartbeat.mock.lastCall?.[1].lastRoundTripMs).toBe(100);
    expect(service.status()).toMatchObject({ connectivity: 'online', updateRequired: false });
  });

  it('marks an update required when the answer names a higher minimum version', async () => {
    const { service, client } = await setup();
    client.heartbeat.mockResolvedValueOnce({
      serverTime: now.toISOString(),
      connectivity: 'online',
      minimumAppVersion: '1.3.0',
      protocols: [SYNC_PROTOCOL],
    });
    await service.tick();
    expect(service.status().updateRequired).toBe(true);
  });

  it('holds the blocks of 7 business days, asks again only for a missing day, never replaces one', async () => {
    const { service, client, db, registration } = await setup();
    await service.roleChanged();
    expect(client.numberBlocks).toHaveBeenCalledWith('device-token', 'order');
    await db.execute('UPDATE number_blocks_local SET last_used = 12');
    await db.execute("INSERT INTO branches (id, business_day_ends_at) VALUES (?, '04:00:00')", [
      registration.branchId,
    ]);
    // Every day held: the heartbeat asks for nothing.
    await service.tick();
    expect(client.numberBlocks).toHaveBeenCalledTimes(1);
    const [last] = numberBlockDates(now, '04:00').slice(-1);
    await db.execute('DELETE FROM number_blocks_local WHERE business_date = ?', [last]);
    await service.tick();
    expect(client.numberBlocks).toHaveBeenCalledTimes(2);
    const blocks = await db.getAll<{ business_date: string; last_used: number | null }>(
      'SELECT business_date, last_used FROM number_blocks_local',
    );
    expect(blocks).toHaveLength(7);
    // The answer filled the missing day and left the others' counters.
    expect(blocks.filter((block) => block.last_used === 12)).toHaveLength(6);
  });

  it('asks for no blocks and sends no heartbeat on a client PC', async () => {
    const { service, client, db, registration } = await setup();
    await db.execute("INSERT INTO devices (id, name, status) VALUES (?, 'PC 3', 'active')", [
      registration.deviceId,
    ]);
    await service.tick();
    await service.roleChanged();
    expect(client.heartbeat).not.toHaveBeenCalled();
    expect(client.numberBlocks).not.toHaveBeenCalled();
  });

  it('asks for a certificate at first, again only when the addresses change', async () => {
    const { service, client, certificates, addresses, registration } = await setup();
    await service.tick();
    expect(client.certificate).toHaveBeenCalledTimes(1);
    const sent = client.certificate.mock.calls[0]?.[1];
    const request = new x509.Pkcs10CertificateRequest(sent?.csr ?? '');
    expect(await request.verify()).toBe(true);
    expect(request.subject).toBe(`CN=${registration.deviceId}`);
    expect(certificates.read()).toMatchObject({ lanAddresses: ['192.168.1.20'] });
    await service.tick();
    expect(client.certificate).toHaveBeenCalledTimes(1);
    addresses.value = ['10.0.0.7'];
    await service.tick();
    expect(client.certificate).toHaveBeenCalledTimes(2);
    expect(certificates.read()).toMatchObject({ lanAddresses: ['10.0.0.7'] });
  });
});
