import { createPublicKey, verify } from 'node:crypto';
import { deviceTokenMessage, publicKeySchema, signatureSchema } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';

describe('device key', () => {
  it('makes an Ed25519 key whose public part has the contract shape', () => {
    const key = generateDeviceKey();
    expect(publicKeySchema.safeParse(key.publicKey).success).toBe(true);
    expect(generateDeviceKey().publicKey).not.toBe(key.publicKey);
  });

  it('signs a device token message that the public key verifies, as the API does', () => {
    const key = generateDeviceKey();
    const message = deviceTokenMessage('nonce-1', 'device-1');
    const signature = signWithDeviceKey(key.privateKey, message);
    expect(signatureSchema.safeParse(signature).success).toBe(true);
    const publicKey = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(key.publicKey, 'base64').toString('base64url'),
      },
      format: 'jwk',
    });
    expect(verify(null, Buffer.from(message), publicKey, Buffer.from(signature, 'base64'))).toBe(
      true,
    );
    expect(
      verify(null, Buffer.from(`${message}x`), publicKey, Buffer.from(signature, 'base64')),
    ).toBe(false);
  });
});
