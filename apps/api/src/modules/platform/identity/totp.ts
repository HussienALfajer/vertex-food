import { createHmac, randomBytes } from 'node:crypto';
import { totpPolicy } from '@vertex-food/contracts';

// The console's second factor (spec S02 rule 39): TOTP as RFC 6238 with HMAC-SHA-1, the algorithm
// every authenticator app supports, and the codes people type (setup and recovery codes).

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new TOTP secret: 160 bits, base32, as RFC 4226 recommends. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The time step of `now` (30 seconds). */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / totpPolicy.stepSeconds);
}

/** The code of `step` for `secret` (base32), with `digits` digits (RFC 4226 truncation). */
export function totpCode(secret: string, step: number, digits: number = totpPolicy.digits): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] as number) & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step whose code `code` is, within one step of `now` either way, and later than `lastStep`
 * (a used step is refused, rule 39); undefined when none matches.
 */
export function matchingStep(
  secret: string,
  code: string,
  now: Date,
  lastStep: number | null,
): number | undefined {
  const current = totpStep(now);
  for (let delta = -totpPolicy.toleranceSteps; delta <= totpPolicy.toleranceSteps; delta += 1) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    if (totpCode(secret, step) === code) return step;
  }
  return undefined;
}

/** The `otpauth://` URI an authenticator app reads from the QR code. */
export function totpUri(secret: string, label: string): string {
  const issuer = 'Vertex Food';
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(totpPolicy.digits),
    period: String(totpPolicy.stepSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params}`;
}

/** A code people type: `groups` groups of four base32 characters (setup and recovery codes). */
export function typedCode(groups: number): string {
  const text = base32Encode(randomBytes(groups * 3)).slice(0, groups * 4);
  return text.match(/.{4}/g)?.join('-') ?? text;
}
