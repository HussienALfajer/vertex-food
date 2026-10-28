import { createHash, createPublicKey, type KeyObject, sign, verify } from 'node:crypto';
import { signInIntentSchema } from '@vertex-food/contracts';
import { z } from 'zod';

/**
 * The API's signed tokens (spec S02 rule 44): EdDSA JWTs (RFC 7519, RFC 8037) signed with
 * `IDENTITY_TOKEN_KEY`. Access tokens name a staff session on a registered PC, device tokens a
 * registered PC, tickets a person in the middle of signing in, console steps a platform user in
 * the middle of signing in to the console. Each kind has its own claims, so one
 * is never accepted as another; the header must be exactly EdDSA with this key's id. Copied from
 * Vertex Shifa and adapted.
 */

const ISSUER = 'vertex-food-api';

/** What a ticket allows next: setting a password, or acting as the signed-in account. */
export const ticketPurposes = ['set_password', 'signed_in'] as const;

export type TicketPurpose = (typeof ticketPurposes)[number];

const claimsOf = {
  access: z.object({ tid: z.uuid(), sid: z.uuid(), mid: z.uuid(), did: z.uuid() }),
  device: z.object({ tid: z.uuid(), did: z.uuid() }),
  ticket: z.object({
    jti: z.string(),
    purpose: z.enum(ticketPurposes),
    intent: signInIntentSchema,
    acc: z.uuid(),
    /** A keyed hash of the account's password when issued, so a password change voids it. */
    ref: z.string(),
    /** The registered PC the person signed in on, whose device token came with the sign-in. */
    did: z.uuid().nullable(),
    tid: z.uuid().nullable(),
    /** The personal device of a `personal` sign-in. */
    pd: z.uuid().nullable(),
  }),
  /**
   * A console sign-in step (rules 38, 39): the platform user who passed the password or setup
   * code, and, for setup, their new TOTP secret, sealed.
   */
  console_step: z.object({
    jti: z.string(),
    uid: z.uuid(),
    step: z.enum(['totp', 'setup']),
    sec: z.string().nullable(),
    /** A keyed hash of what the step rests on, so a reset or a password change voids it. */
    ref: z.string(),
  }),
} as const;

export type TokenKind = keyof typeof claimsOf;

export type Claims<K extends TokenKind> = z.infer<(typeof claimsOf)[K]> & { exp: number };

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

export class TokenSigner {
  private readonly publicKey: KeyObject;
  private readonly keyId: string;

  constructor(private readonly privateKey: KeyObject) {
    this.publicKey = createPublicKey(privateKey);
    const raw = this.publicKey.export({ format: 'der', type: 'spki' });
    this.keyId = createHash('sha256').update(raw).digest('base64url').slice(0, 16);
  }

  /** Signs `claims` of `kind`, valid `ttlSeconds` from now. */
  sign<K extends TokenKind>(
    kind: K,
    claims: z.infer<(typeof claimsOf)[K]>,
    ttlSeconds: number,
    now = new Date(),
  ): { token: string; expiresAt: Date } {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const exp = issuedAt + ttlSeconds;
    const header = encode({ alg: 'EdDSA', typ: 'JWT', kid: this.keyId });
    const payload = encode({ ...claims, kind, iss: ISSUER, iat: issuedAt, exp });
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.privateKey);
    return {
      token: `${header}.${payload}.${signature.toString('base64url')}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** The claims of a valid, unexpired token of `kind`, or undefined. */
  verify<K extends TokenKind>(token: string, kind: K, now = new Date()): Claims<K> | undefined {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const [header, payload, signature] = parts as [string, string, string];
    const head = decode(header) as { alg?: unknown; kid?: unknown } | undefined;
    if (head?.alg !== 'EdDSA' || head.kid !== this.keyId) return undefined;
    const valid = verify(
      null,
      Buffer.from(`${header}.${payload}`),
      this.publicKey,
      Buffer.from(signature, 'base64url'),
    );
    if (!valid) return undefined;
    const body = decode(payload) as { kind?: unknown; iss?: unknown; exp?: unknown } | undefined;
    if (body?.kind !== kind || body.iss !== ISSUER || typeof body.exp !== 'number') {
      return undefined;
    }
    if (body.exp * 1000 <= now.getTime()) return undefined;
    const claims = claimsOf[kind].safeParse(body);
    return claims.success ? ({ ...claims.data, exp: body.exp } as unknown as Claims<K>) : undefined;
  }

  /** The public key as a JSON Web Key Set, for the sync service (S04, rule 44). */
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
