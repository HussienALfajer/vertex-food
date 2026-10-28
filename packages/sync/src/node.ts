import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from 'node:crypto';
import type { SignMessage, VerifyMessage } from './envelope.js';

// Ed25519 for the envelope's ports, from `node:crypto`: the restaurant PC's main process signs with
// its device key (S02), and the API and the hub verify with the executing PC's public key. Only
// Node runtimes import `@vertex-food/sync/node`; hub client pages never sign or verify.

/** Signs with a device key given as PKCS #8 DER in base64 (S02's `device-key.ts`). */
export function ed25519Signer(privateKeyPkcs8: string): SignMessage {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return (message) => sign(null, Buffer.from(message, 'utf8'), key).toString('base64');
}

/** Verifies with a raw 32-byte public key in base64 (`publicKeySchema`); a bad key verifies nothing. */
export function ed25519Verifier(publicKey: string): VerifyMessage {
  let key: KeyObject;
  try {
    key = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(publicKey, 'base64').toString('base64url'),
      },
      format: 'jwk',
    });
  } catch {
    return () => false;
  }
  return (message, signature) => {
    try {
      return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  };
}
