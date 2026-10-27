import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

/**
 * The installation's Ed25519 device key (spec S02 rule 16): the private key never leaves the main
 * process and is stored sealed by `safeStorage` (`device-store.ts`); only the public key is sent.
 */
export type DeviceKey = {
  /** PKCS#8 DER, base64. */
  privateKey: string;
  /** The raw 32-byte public key, base64, as `publicKeySchema` expects. */
  publicKey: string;
};

export function generateDeviceKey(): DeviceKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  if (!x) throw new Error('The Ed25519 key has no public part');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: Buffer.from(x, 'base64url').toString('base64'),
  };
}

/** The device key's signature of `message` (UTF-8), base64. */
export function signWithDeviceKey(privateKey: string, message: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(message, 'utf8'), key).toString('base64');
}
