import { recoveryCodeSchema, setupCodeSchema } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  matchingStep,
  newTotpSecret,
  totpCode,
  totpStep,
  totpUri,
  typedCode,
} from './totp.js';

// RFC 6238 appendix B, SHA-1: the secret is the ASCII of "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches RFC 6238 at %i seconds', (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)), 8)).toBe(code);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts one step either way and refuses a used step', () => {
    const secret = newTotpSecret();
    const now = new Date(1_800_000_000_000);
    const step = totpStep(now);
    expect(matchingStep(secret, totpCode(secret, step), now, null)).toBe(step);
    expect(matchingStep(secret, totpCode(secret, step - 1), now, null)).toBe(step - 1);
    expect(matchingStep(secret, totpCode(secret, step + 1), now, null)).toBe(step + 1);
    expect(matchingStep(secret, totpCode(secret, step - 2), now, null)).toBeUndefined();
    expect(matchingStep(secret, totpCode(secret, step), now, step)).toBeUndefined();
    expect(matchingStep(secret, totpCode(secret, step - 1), now, step - 1)).toBeUndefined();
    expect(matchingStep(secret, totpCode(secret, step + 1), now, step)).toBe(step + 1);
  });

  it('makes codes people type in the contract shapes', () => {
    expect(setupCodeSchema.parse(typedCode(3))).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(recoveryCodeSchema.parse(typedCode(2))).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(totpUri('ABCD', 'Admin')).toBe(
      'otpauth://totp/Vertex%20Food%3AAdmin?secret=ABCD&issuer=Vertex+Food&algorithm=SHA1&digits=6&period=30',
    );
  });
});
