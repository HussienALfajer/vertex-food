import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDeviceKey } from './device-key.js';
import type { DeviceRecord } from './device-store.js';
import { fakeSealer, member, memberList, tempStore, uuid7 } from './device-test-kit.js';

async function registeredRecord(): Promise<DeviceRecord> {
  const key = generateDeviceKey();
  const list = memberList([await member('كاشير', '482916')], '2026-10-20T08:00:00.000Z');
  return {
    state: 'registered',
    registration: {
      tenantId: list.tenant.id,
      branchId: list.branch.id,
      deviceId: list.device.id,
      ...key,
    },
    memberList: list,
    membersSyncedAt: list.issuedAt,
    highestSeenAt: list.issuedAt,
    local: {},
  };
}

describe('DeviceStore', () => {
  it('reads back what it wrote, sealed: no verifier, key or name in clear on disk', async () => {
    const { store, path } = tempStore();
    expect(store.read()).toBeNull();
    const record = await registeredRecord();
    store.write(record);
    expect(store.read()).toEqual(record);
    const disk = readFileSync(path, 'utf8');
    expect(disk.startsWith('sealed:')).toBe(true);
    expect(disk).not.toContain('argon2id');
    expect(disk).not.toContain('registered');
  });

  it('refuses to write when encryption is unavailable', async () => {
    const { store } = tempStore({ ...fakeSealer, isEncryptionAvailable: () => false });
    expect(() => store.write({ state: 'wiped', tenantName: 'مطعم' })).toThrow();
    expect(store.read()).toBeNull();
  });

  it('treats a damaged or foreign file as no registration', () => {
    const { store, path } = tempStore();
    writeFileSync(path, 'not sealed');
    expect(store.read()).toBeNull();
    writeFileSync(path, fakeSealer.encryptString(JSON.stringify({ state: 'other', id: uuid7() })));
    expect(store.read()).toBeNull();
  });

  it('removes the record on a wipe', () => {
    const { store } = tempStore();
    store.write({ state: 'wiped', tenantName: 'مطعم' });
    store.remove();
    expect(store.read()).toBeNull();
  });
});
