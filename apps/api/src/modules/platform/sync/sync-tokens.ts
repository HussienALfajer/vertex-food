import { createHash, createPublicKey, type KeyObject, sign } from 'node:crypto';

/** A sync service token lasts 5 minutes (spec S04, "API and commands"). */
export const SYNC_TOKEN_TTL_SECONDS = 300;

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * The sync service's tokens (spec S04, ADR 0022): EdDSA JWTs with `aud: powersync`, the PC as
 * `sub` and the tenant, branch and device as claims, which the stream queries filter on. Signed
 * with `SYNC_TOKEN_KEY`, apart from identity's key, so the sync service trusts no other token.
 */
export class SyncTokenSigner {
  private readonly publicKey: KeyObject;
  private readonly keyId: string;

  constructor(private readonly privateKey: KeyObject) {
    this.publicKey = createPublicKey(privateKey);
    const raw = this.publicKey.export({ format: 'der', type: 'spki' });
    this.keyId = createHash('sha256').update(raw).digest('base64url').slice(0, 16);
  }

  sign(
    device: { tenantId: string; branchId: string; deviceId: string },
    now = new Date(),
  ): { token: string; expiresAt: Date } {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const exp = issuedAt + SYNC_TOKEN_TTL_SECONDS;
    const header = encode({ alg: 'EdDSA', typ: 'JWT', kid: this.keyId });
    const payload = encode({
      sub: device.deviceId,
      aud: 'powersync',
      iat: issuedAt,
      exp,
      tenant_id: device.tenantId,
      branch_id: device.branchId,
      device_id: device.deviceId,
    });
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.privateKey);
    return {
      token: `${header}.${payload}.${signature.toString('base64url')}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** The public key as a JSON Web Key Set, for the sync service. */
  jwks() {
    const { x } = this.publicKey.export({ format: 'jwk' }) as { x: string };
    return {
      keys: [
        {
          kty: 'OKP' as const,
          crv: 'Ed25519' as const,
          x,
          kid: this.keyId,
          alg: 'EdDSA' as const,
          use: 'sig' as const,
        },
      ],
    };
  }
}
