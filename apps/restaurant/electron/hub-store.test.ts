import type { PowerSyncDatabase } from '@powersync/node';
import { type CommandEnvelope, SYNC_PROTOCOL } from '@vertex-food/contracts';
import { type JournalEntry, signEnvelope } from '@vertex-food/sync';
import { ed25519Signer } from '@vertex-food/sync/node';
import { afterEach, describe, expect, it } from 'vitest';
import { generateDeviceKey } from './device-key.js';
import { tempFolder } from './device-test-kit.js';
import { LocalHubStore } from './hub-store.js';
import { generateDatabaseKey, type OpenedDatabase, openLocalDatabase } from './local-db.js';
import { pendingEnvelopes } from './pending-work.js';
import { uuidv7 } from './uuid.js';

// The hub's storage port on the real encrypted database (spec S04 rules 5, 18, 21–29): what the
// memory store of `packages/sync` models, checked on SQLite3MultipleCiphers through PowerSync.

const deviceId = uuidv7();
const sign = ed25519Signer(generateDeviceKey().privateKey);
const opened: OpenedDatabase[] = [];

afterEach(async () => {
  for (const database of opened.splice(0)) await database.close();
});

async function openStore(): Promise<{ store: LocalHubStore; db: PowerSyncDatabase }> {
  const database = await openLocalDatabase(tempFolder(), generateDatabaseKey());
  opened.push(database);
  if (!database.db) throw new Error('Expected a whole database');
  return { store: new LocalHubStore(database.db, deviceId), db: database.db };
}

function envelope(seq: number, overrides: { number?: number } = {}): CommandEnvelope {
  const now = new Date().toISOString();
  return signEnvelope(
    {
      id: uuidv7(),
      name: 'sync.network_check',
      version: 1,
      protocol: SYNC_PROTOCOL,
      originKind: 'pc',
      originDeviceId: deviceId,
      executedByDeviceId: deviceId,
      actor: { kind: 'member', membershipId: uuidv7(), sessionKind: 'pc' },
      deviceTime: now,
      clockOffsetMs: 0,
      highestSeenTime: now,
      afterOfflineWindow: false,
      hubEpoch: 1,
      hubSeq: seq,
      payload: { sentAt: now, sequence: seq, run: uuidv7(), ...overrides },
      resolved: { receivedAt: now },
    },
    sign,
  );
}

function commandEntry(seq: number, number?: number): JournalEntry {
  const signed = envelope(seq);
  return {
    id: signed.id,
    seq,
    epoch: 1,
    body: {
      kind: 'command',
      envelope: signed,
      numberUsed: number ? { series: 'order', businessDate: '2026-10-28', number } : null,
    },
    mirrored: true,
    mirroredAt: signed.deviceTime,
    committedAt: signed.deviceTime,
    ownLineage: false,
    forwardedAt: null,
  };
}

describe('LocalHubStore', () => {
  it('commits a command with its journal row, its upload and its result in one transaction', async () => {
    const { store, db } = await openStore();
    const first = commandEntry(1);
    const second = commandEntry(2);
    await store.transaction(async (tx) => {
      await tx.appendEntry(first);
      await tx.appendEntry(second);
      await tx.saveState({
        role: 'hub',
        epoch: 1,
        appliedSeq: 2,
        hubDeviceId: deviceId,
        rejoining: false,
        hubSeq: 2,
        lastHeartbeatAt: null,
        notice: null,
      });
    });
    expect(await store.entry(first.id)).toEqual(first);
    expect((await store.entryAt(2))?.id).toBe(second.id);
    expect((await store.entriesAfter(0)).map((e) => e.id)).toEqual([first.id, second.id]);
    expect((await store.entriesAfter(0, 1)).map((e) => e.id)).toEqual([first.id]);
    expect(await store.oldestSeq()).toBe(1);
    expect((await store.recentCommands('sync.network_check', 1)).map((e) => e.id)).toEqual([
      second.id,
    ]);
    expect(await store.loadState()).toMatchObject({ role: 'hub', appliedSeq: 2 });
    // The upload queue holds both signed envelopes, in journal order.
    expect((await pendingEnvelopes(db)).map((e) => e.id)).toEqual([first.id, second.id]);
    const result = await db.getOptional<{ name: string; outcome: string | null }>(
      'SELECT name, outcome FROM command_results WHERE id = ?',
      [first.id],
    );
    expect(result).toEqual({ name: 'sync.network_check', outcome: null });
    expect(await store.isSettled(first.id)).toBe(false);
    await db.execute("UPDATE command_results SET outcome = 'accepted' WHERE id = ?", [first.id]);
    expect(await store.isSettled(first.id)).toBe(true);
  });

  it('writes nothing of a transaction cut before its commit, as a power cut', async () => {
    const { store, db } = await openStore();
    const entry = commandEntry(1);
    await expect(
      store.transaction(async (tx) => {
        await tx.appendEntry(entry);
        throw new Error('power cut');
      }),
    ).rejects.toThrow('power cut');
    expect(await store.entry(entry.id)).toBeNull();
    expect(await pendingEnvelopes(db)).toEqual([]);
    expect(await db.getAll('SELECT id FROM command_results')).toEqual([]);
    await expect(
      store.transaction(async (tx) => {
        await tx.appendEntry(entry);
        await tx.appendEntry(entry);
      }),
    ).rejects.toThrow();
  });

  it('advances its own block counter and finds a number another entry holds', async () => {
    const { store, db } = await openStore();
    await db.execute(
      `INSERT INTO number_blocks_local (id, series, business_date, first_number, last_number,
         last_used) VALUES ('order:2026-10-28', 'order', '2026-10-28', 1, 4999, NULL)`,
    );
    const numbered = commandEntry(1, 7);
    await store.transaction((tx) => tx.appendEntry(numbered));
    expect(await store.localBlock('order', '2026-10-28')).toMatchObject({ lastUsed: 7 });
    const use = { series: 'order' as const, businessDate: '2026-10-28', number: 7 };
    expect(await store.numberTaken(use, uuidv7())).toBe(true);
    expect(await store.numberTaken(use, numbered.id)).toBe(false);
  });

  it('moves, marks and replaces entries for a rejoin (rules 24, 25)', async () => {
    const { store, db } = await openStore();
    const shared = commandEntry(1);
    const alone = commandEntry(2);
    await store.transaction(async (tx) => {
      await tx.appendEntry(shared);
      await tx.appendEntry(alone);
      await tx.markOwnLineage([alone.id]);
      await tx.markForwarded([alone.id, shared.id], '2026-10-28T10:00:00.000Z');
    });
    expect((await store.ownLineage()).map((e) => e.id)).toEqual([alone.id]);
    expect((await store.ownLineage())[0]?.forwardedAt).toBe('2026-10-28T10:00:00.000Z');
    expect((await store.entry(shared.id))?.forwardedAt).toBeNull();
    expect(await store.entryAt(2)).toBeNull();
    await store.transaction((tx) => tx.moveEntry(alone.id, 5, 2));
    expect(await store.entryAt(5)).toMatchObject({ id: alone.id, epoch: 2, ownLineage: false });

    // The hub's version of `shared` replaces this PC's, in the journal and the upload queue.
    const hubVersion = { ...envelope(1), id: shared.id };
    const signed = signEnvelope(
      { ...hubVersion, payload: { ...hubVersion.payload, sequence: 9 } },
      sign,
    );
    await store.transaction((tx) =>
      tx.replaceEntry({ ...shared, body: { kind: 'command', envelope: signed, numberUsed: null } }),
    );
    const queued = await pendingEnvelopes(db);
    expect(queued.filter((e) => e.id === shared.id)).toEqual([signed]);
    expect(await store.entry(shared.id)).toMatchObject({ body: { envelope: signed } });

    await store.transaction((tx) => tx.deleteEntries([shared.id]));
    expect(await store.entry(shared.id)).toBeNull();
    expect(await store.oldestSeq()).toBe(5);
  });

  it('keeps pairings, sessions, PIN locks and local events (rules 33–35)', async () => {
    const { store, db } = await openStore();
    const pairingId = uuidv7();
    const membershipId = uuidv7();
    const at = '2026-10-28T09:00:00.000Z';
    const later = '2026-10-28T09:05:00.000Z';
    await store.transaction(async (tx) => {
      for (const [seq, body] of [
        [
          1,
          {
            kind: 'hub.pairing' as const,
            pairingId,
            pairingKind: 'personal' as const,
            name: 'هاتف الصالة',
            tokenHash: 'a'.repeat(64),
            createdAt: at,
          },
        ],
        [
          2,
          {
            kind: 'hub.session' as const,
            sessionId: uuidv7(),
            pairingId,
            membershipId,
            tokenHash: 'b'.repeat(64),
            startedAt: at,
          },
        ],
        [3, { kind: 'hub.pin_disabled' as const, membershipId, at }],
      ] as const) {
        await tx.appendEntry({
          id: uuidv7(),
          seq,
          epoch: 1,
          body,
          mirrored: false,
          mirroredAt: null,
          committedAt: at,
          ownLineage: false,
          forwardedAt: null,
        });
      }
      await tx.recordLocalEvent({ action: 'hub.promoted', at, details: { toEpoch: 2 } });
    });
    const [pairing] = await store.pairings();
    expect(pairing).toMatchObject({ id: pairingId, kind: 'personal', lastUsedAt: at });
    const [session] = await store.sessions();
    expect(session).toMatchObject({ pairingId, membershipId, endedAt: null });
    expect(await store.pinDisabled(membershipId)).toBe(true);
    // A local entry is settled at once; it never uploads.
    expect(await store.isSettled((await store.entryAt(1))?.id ?? '')).toBe(true);
    expect(await pendingEnvelopes(db)).toEqual([]);

    await store.transaction(async (tx) => {
      await tx.touchPairing(pairingId, later);
      await tx.touchPairing(pairingId, at);
      await tx.revokePairing(pairingId, later);
      await tx.touchSession(session?.id ?? '', later);
      await tx.endSession(session?.id ?? '', later);
    });
    expect(await store.pairings()).toMatchObject([{ lastUsedAt: later, revokedAt: later }]);
    expect(await store.sessions()).toMatchObject([{ lastInputAt: later, endedAt: later }]);
    expect(
      await db.getAll<{ action: string; details: string }>(
        'SELECT action, details FROM local_events',
      ),
    ).toEqual([{ action: 'hub.promoted', details: '{"toEpoch":2}' }]);
  });
});
