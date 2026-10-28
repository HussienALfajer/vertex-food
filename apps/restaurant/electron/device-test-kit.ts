import { argon2, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandEnvelope,
  type DeviceMember,
  type MemberList,
  SYNC_PROTOCOL,
} from '@vertex-food/contracts';
import { argon2Verify } from 'hash-wasm';
import { afterEach, vi } from 'vitest';
import { signWithDeviceKey } from './device-key.js';
import { DeviceStore, type Sealer } from './device-store.js';
import type { VerifyPin } from './local-pins.js';
import type { LocalData, StoredMembers } from './local-store.js';

// Helpers of the main process's unit tests (not compiled into the app: `tsconfig.electron.json`
// excludes `*.test.ts` and this file).

/** A sealer that marks and scrambles, so a test sees nothing is written in clear. */
export const fakeSealer: Sealer = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  decryptString: (data) => {
    const text = data.toString();
    if (!text.startsWith('sealed:')) throw new Error('Not sealed');
    return Buffer.from(text.slice('sealed:'.length), 'base64').toString();
  },
};

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A folder removed after the test. */
export function tempFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'vf-device-'));
  folders.push(folder);
  return folder;
}

export function tempStore(sealer: Sealer = fakeSealer): { store: DeviceStore; path: string } {
  const folder = tempFolder();
  const path = join(folder, 'device.bin');
  return { store: new DeviceStore(path, sealer), path };
}

/**
 * A PIN verifier in the API's format (`secrets.ts`), made by Node's Argon2id at a test cost, so
 * the app's WASM check is tested against what the server writes.
 */
export async function pinVerifier(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const cost = { memory: 1024, passes: 1, parallelism: 1, tagLength: 32 };
  const key = await new Promise<Buffer>((resolve, reject) =>
    argon2('argon2id', { message: pin, nonce: salt, ...cost }, (error, derived) =>
      error ? reject(error) : resolve(derived),
    ),
  );
  const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${cost.memory},t=${cost.passes},p=1$${b64(salt)}$${b64(key)}`;
}

export const verifyPin: VerifyPin = (pin, verifier) =>
  argon2Verify({ password: pin, hash: verifier });

/** The local database in memory, for the tests of `DeviceService` (`local-store.test.ts` has the real one). */
export function memoryData(state: LocalData['state'] = 'ok') {
  let stored: StoredMembers | null = null;
  const data = {
    state,
    destroyed: false as boolean,
    loadMembers: vi.fn(async () => stored),
    saveMembers: vi.fn(async (members: StoredMembers) => {
      if (data.state !== 'ok') throw new Error('The local database is read-only');
      stored = members;
    }),
    destroy: vi.fn(async () => {
      stored = null;
      data.destroyed = true;
    }),
  } satisfies LocalData & { destroyed: boolean };
  return data;
}

/** A UUIDv7-shaped id (`idSchema`). */
export function uuid7(): string {
  const hex = randomUUID().replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function member(
  name: string,
  pin: string | null,
  overrides: Partial<DeviceMember> = {},
): Promise<DeviceMember> {
  return {
    membershipId: uuid7(),
    name,
    roles: ['cashier'],
    permissions: ['tenant.view'],
    pinVerifier: pin ? await pinVerifier(pin) : null,
    pinDisabled: false,
    ...overrides,
  };
}

export function memberList(members: DeviceMember[], issuedAt: string, version = 'v1'): MemberList {
  return {
    version,
    issuedAt,
    tenant: { id: uuid7(), nameAr: 'مطعم تجريبي', status: 'active', logoFileId: null },
    branch: { id: uuid7(), nameAr: 'فرع اعزاز', idleLockMinutes: 5 },
    device: { id: uuid7(), name: 'الكاشير 1' },
    members,
  };
}

/** A signed-shaped envelope of `sync.network_check`; the server's checks are faked. */
export function commandEnvelope(
  privateKey: string,
  deviceId: string,
  seq: number,
  now: Date,
): CommandEnvelope {
  return {
    id: uuid7(),
    name: 'sync.network_check',
    version: 1,
    protocol: SYNC_PROTOCOL,
    originKind: 'pc',
    originDeviceId: deviceId,
    executedByDeviceId: deviceId,
    actor: { kind: 'member', membershipId: uuid7(), sessionKind: 'pc' },
    deviceTime: now.toISOString(),
    clockOffsetMs: 0,
    highestSeenTime: now.toISOString(),
    afterOfflineWindow: false,
    hubEpoch: 1,
    hubSeq: seq,
    payload: { sentAt: now.toISOString(), sequence: seq, run: 'test' },
    resolved: {},
    payloadHash: 'a'.repeat(64),
    signature: signWithDeviceKey(privateKey, `command ${seq}`),
  };
}
