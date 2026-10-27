import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Copied from Vertex Shifa's `packages/crypto` (ADR 0032); the API is its only user here.

/**
 * Keyed hashes of values the server only compares (OTP codes, tokens, rate-limit keys):
 * HMAC-SHA-256 under `IDENTITY_HASH_KEY` (spec S02). Each use names its purpose, so a hash
 * made for one never matches another.
 */
export class KeyedHash {
  constructor(private readonly key: Buffer) {}

  hash(purpose: string, value: string): string {
    return createHmac('sha256', this.key).update(`${purpose}\n${value}`).digest('base64url');
  }

  matches(purpose: string, value: string, hash: string): boolean {
    return safeEqual(this.hash(purpose, value), hash);
  }
}

/** GCM tags are always the full 128 bits. */
const TAG_BYTES = 16;

/**
 * Values the server must read back (console TOTP secrets), encrypted with AES-256-GCM under
 * `IDENTITY_ENCRYPTION_KEY` (spec S02). Each one is
 * bound to what it belongs to (`context`, such as `platform_user:<id>:totp`), so a value copied to
 * another row does not decrypt.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {}

  seal(context: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, sealed, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** The plaintext, or undefined when the value was altered, moved or sealed with another key. */
  open(context: string, value: string): string | undefined {
    const [version, iv, sealed, tag] = value.split('.');
    if (version !== 'v1' || !iv || sealed === undefined || !tag) return undefined;
    const authTag = Buffer.from(tag, 'base64url');
    // A shorter tag would weaken the check (Node accepts down to 4 bytes unless told the length).
    if (authTag.length !== TAG_BYTES) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(authTag);
      const plain = Buffer.concat([
        decipher.update(Buffer.from(sealed, 'base64url')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      return undefined;
    }
  }
}

/** The AES-256-GCM box of identity (`IDENTITY_ENCRYPTION_KEY`), for the console's TOTP secrets. */
export const SECRET_BOX = Symbol('SecretBox');

/** Compares two strings in time independent of where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
