import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DeviceApi, DeviceApiError } from './device-client.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import type { DeviceStore, StoredRecord } from './device-store.js';
import { member, memberList, tempFolder, tempStore, verifyPin } from './device-test-kit.js';
import { generateDatabaseKey } from './local-db.js';
import { LocalStore } from './local-store.js';

const now = new Date('2026-10-27T09:00:00.000Z');

// Open databases are closed before the folders go: Windows keeps an open file.
const opened: LocalStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.opened.close()));
});

/** The members the sealed file still holds, decoded. */
function sealedMembers(store: DeviceStore) {
  const record = store.read();
  return record?.state === 'registered' ? record.memberList.members : undefined;
}

/** Every route unreachable: the PC starts offline, so only what it holds is used. */
const offline = new Proxy({} as DeviceApi, {
  get: () => async () => {
    throw new DeviceApiError('NETWORK_ERROR');
  },
});

/** A PC registered with S02's app: its member list in the sealed file, no database key. */
async function s02Pc() {
  const owner = await member('مالك', '602847', { roles: ['owner'] });
  const cashier = await member('كاشير', '482916');
  const list = memberList([owner, cashier], now.toISOString());
  const { store } = tempStore();
  const key = generateDeviceKey();
  const record: StoredRecord = {
    state: 'registered',
    registration: {
      tenantId: list.tenant.id,
      branchId: list.branch.id,
      deviceId: list.device.id,
      privateKey: key.privateKey,
      publicKey: key.publicKey,
    },
    memberList: list,
    membersSyncedAt: now.toISOString(),
    highestSeenAt: now.toISOString(),
    // Two wrong PINs here, and the owner's first session on this PC (rules 25, 30).
    local: {
      [cashier.membershipId]: { failures: 2, disabled: false, firstSessionAt: null },
      [owner.membershipId]: {
        failures: 0,
        disabled: false,
        firstSessionAt: now.toISOString(),
      },
    },
  };
  store.write(record);
  const directory = tempFolder();
  const open = (client: DeviceApi = offline) =>
    DeviceService.open({
      store,
      client,
      verifyPin,
      generateKey: generateDeviceKey,
      sign: signWithDeviceKey,
      now: () => now,
      elapsed: () => now.getTime(),
      os: 'win32 10.0',
      appVersion: '0.0.0',
      onChange: () => undefined,
      openData: async (_deviceId, databaseKey) => {
        const local = await LocalStore.open(directory, databaseKey);
        opened.push(local);
        return local;
      },
      generateDatabaseKey,
      quarantine: async () => undefined,
    });
  const restart = async (client: DeviceApi = offline) => {
    await Promise.all(opened.splice(0).map((local) => local.opened.close()));
    return open(client);
  };
  /** A file the PC's key does not open stands in for a damaged one. */
  const damage = async () => {
    await (await LocalStore.open(directory, generateDatabaseKey())).opened.close();
  };
  return { store, owner, cashier, list, open, restart, damage };
}

describe('the member list moves into local_members (S02 rule 29, spec S04)', () => {
  it('moves an S02 list out of the sealed file, keeping each local record', async () => {
    const { store, cashier, owner, open, restart } = await s02Pc();
    const service = await open();
    // The verifiers left the sealed file; the database key is in it now.
    expect(sealedMembers(store)).toBeUndefined();
    const stored = store.read();
    expect(stored?.state === 'registered' && stored.registration.databaseKey).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(service.status()).toMatchObject({
      state: 'registered',
      members: [
        { membershipId: owner.membershipId, usedThisDevice: true },
        { membershipId: cashier.membershipId, usedThisDevice: false },
      ],
    });
    // After a restart the list comes from the database: an offline PIN still opens a session,
    // and the two wrong PINs counted before the move still count (5 disable it).
    const again = await restart();
    for (let i = 0; i < 2; i += 1) {
      expect(await again.signIn({ membershipId: cashier.membershipId, pin: '000000' })).toEqual({
        ok: false,
        code: 'INVALID_PIN',
      });
    }
    expect(await again.signIn({ membershipId: cashier.membershipId, pin: '000000' })).toEqual({
      ok: false,
      code: 'PIN_DISABLED',
    });
    expect(await again.signIn({ membershipId: owner.membershipId, pin: '602847' })).toEqual({
      ok: true,
    });
    expect((await restart()).status()).toMatchObject({
      members: [{ pinDisabledHere: false }, { pinDisabledHere: true }],
    });
  });

  it('repeats the move when the PC stopped between the database and the sealed file', async () => {
    const { store, open, restart, list } = await s02Pc();
    // The key is written, then the members reach the database, then the cut.
    const real = store.write.bind(store);
    let writes = 0;
    const write = vi.spyOn(store, 'write').mockImplementation((record) => {
      writes += 1;
      if (writes === 2) throw new Error('power cut');
      real(record);
    });
    await expect(open()).rejects.toThrow('power cut');
    write.mockRestore();
    expect(sealedMembers(store)).toHaveLength(2);
    const service = await restart();
    expect(sealedMembers(store)).toBeUndefined();
    expect(service.status()).toMatchObject({ members: list.members.map(() => ({})) });
  });

  it('fetches the whole list again when the rows disagree with the sealed version', async () => {
    const { store, open, restart } = await s02Pc();
    await open();
    const stored = store.read();
    if (stored?.state !== 'registered') throw new Error('Expected a registered PC');
    // A list whose header reached the sealed file but whose members never reached the database.
    store.write({ ...stored, memberList: { ...stored.memberList, version: 'v2' } });
    const members = vi.fn(async () => {
      throw new DeviceApiError('NETWORK_ERROR');
    });
    const online = {
      ...offline,
      challenge: async () => ({ nonce: 'nonce' }),
      token: async () => ({ deviceToken: 'device-token', expiresAt: now.toISOString() }),
      members,
    } as unknown as DeviceApi;
    const service = await restart(online);
    // The members it holds still sign in offline meanwhile.
    expect(service.status()).toMatchObject({ members: [{}, {}] });
    await service.refresh();
    expect(members).toHaveBeenCalledWith('device-token', '');
  });

  it('keeps the members in the sealed file while the database is read-only', async () => {
    const { store, cashier, open, damage } = await s02Pc();
    await damage();
    const service = await open();
    expect(service.status()).toMatchObject({ localDatabase: 'corrupt', members: [{}, {}] });
    expect(sealedMembers(store)).toHaveLength(2);
    // PINs still work offline, and their failures are kept in the sealed file.
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '000000' })).toEqual({
      ok: false,
      code: 'INVALID_PIN',
    });
    expect(await service.signIn({ membershipId: cashier.membershipId, pin: '482916' })).toEqual({
      ok: true,
    });
  });
});
