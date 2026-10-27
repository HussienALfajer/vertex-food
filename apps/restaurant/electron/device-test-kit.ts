import { argon2, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceMember, MemberList } from '@vertex-food/contracts';
import { argon2Verify } from 'hash-wasm';
import { afterEach } from 'vitest';
import { DeviceStore, type Sealer } from './device-store.js';
import type { VerifyPin } from './local-pins.js';

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

export function tempStore(sealer: Sealer = fakeSealer): { store: DeviceStore; path: string } {
  const folder = mkdtempSync(join(tmpdir(), 'vf-device-'));
  folders.push(folder);
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
