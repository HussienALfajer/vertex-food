import { argon2, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

// Keyed hashes (`KeyedHash`) and sealed values (`SecretBox`) are in `crypto.ts`.

/** A random URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Passwords and PINs: Argon2id (ADR 0032) in the PHC string format. Passwords take OWASP's
// minimum cost (19 MiB, two passes), so a sign-in costs tens of milliseconds; PIN verifiers take
// 64 MiB and three passes, because they travel to the branch's registered PCs and a six-digit PIN
// has few values (spec S02 "Abuse and failure cases").

type Cost = { memory: number; passes: number; parallelism: number; tagLength: number };

const ARGON2: Cost = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

export const PIN_ARGON2: Cost = { memory: 65_536, passes: 3, parallelism: 1, tagLength: 32 };

function derive(password: string, salt: Buffer, cost: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...cost }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string, cost: Cost = ARGON2): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  const { memory, passes, parallelism } = cost;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(key)}`;
}

/** A PIN's verifier, sent to the registered PCs of the member's branches (rule 28). */
export function hashPin(pin: string): Promise<string> {
  return hashPassword(pin, PIN_ARGON2);
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Whether `password` (or a PIN) matches the stored PHC string, at the cost it was made with. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash as string, 'base64');
  const key = await derive(password, Buffer.from(salt as string, 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(key, expected);
}

let decoy: Promise<string> | undefined;

/**
 * A hash no password matches, checked when the phone has no password, so a sign-in for an unknown
 * phone takes as long as one for a known phone (no account enumeration by timing).
 */
export function decoyPasswordHash(): Promise<string> {
  decoy ??= hashPassword(randomToken());
  return decoy;
}

/** Whether `signature` (base64) is the Ed25519 signature of `message` by `publicKey` (base64). */
export function verifyEd25519(publicKey: string, message: string, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(publicKey, 'base64').toString('base64url'),
      },
      format: 'jwk',
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
