import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyedHash, SecretBox, safeEqual } from './index.js';

describe('KeyedHash', () => {
  const hash = new KeyedHash(randomBytes(32));

  it('matches the same value for the same purpose only', () => {
    const value = hash.hash('otp', '123456');
    expect(hash.matches('otp', '123456', value)).toBe(true);
    expect(hash.matches('otp', '123457', value)).toBe(false);
    expect(hash.matches('recipient', '123456', value)).toBe(false);
  });

  it('differs under another key', () => {
    expect(new KeyedHash(randomBytes(32)).hash('otp', '1')).not.toBe(hash.hash('otp', '1'));
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('opens what it sealed in the same context', () => {
    const sealed = box.seal('platform_user:a:totp', 'نص سري');
    expect(sealed).not.toContain('نص');
    expect(box.open('platform_user:a:totp', sealed)).toBe('نص سري');
  });

  it('refuses another context, another key and an altered value', () => {
    const sealed = box.seal('a', 'secret');
    expect(box.open('b', sealed)).toBeUndefined();
    expect(new SecretBox(randomBytes(32)).open('a', sealed)).toBeUndefined();
    const parts = sealed.split('.');
    parts[2] = Buffer.from('other').toString('base64url');
    expect(box.open('a', parts.join('.'))).toBeUndefined();
    expect(box.open('a', 'v2.x.y.z')).toBeUndefined();
  });

  it('refuses a truncated authentication tag', () => {
    const parts = box.seal('a', 'secret').split('.');
    for (const bytes of [4, 12, 15]) {
      const tag = Buffer.from(parts[3] as string, 'base64url').subarray(0, bytes);
      const truncated = [...parts.slice(0, 3), tag.toString('base64url')].join('.');
      expect(box.open('a', truncated), `${bytes} bytes`).toBeUndefined();
    }
  });

  it('seals the same text differently each time', () => {
    expect(box.seal('a', 'x')).not.toBe(box.seal('a', 'x'));
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});
