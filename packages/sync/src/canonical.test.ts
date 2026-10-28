import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson, commandPayloadHash, sha256Hex } from './canonical.js';

// Fixed vectors (spec S04 rule 4): the PC, the hub and the server must produce these exact bytes
// and hashes; a change here breaks every signature made by an installed PC.

describe('canonical JSON', () => {
  it('sorts keys, drops whitespace and undefined keys, keeps array order', () => {
    expect(canonicalJson({ c: { x: 'y' }, b: [true, false, null], a: 1, z: undefined })).toBe(
      '{"a":1,"b":[true,false,null],"c":{"x":"y"}}',
    );
    expect(canonicalJson([3, undefined, 1])).toBe('[3,null,1]');
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [] })).toBe('{"a":[],"b":{"c":2,"d":1}}');
  });

  it('sorts keys by UTF-16 code units, not by locale', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, ب: 4, '10': 5, '9': 6 })).toBe(
      '{"10":5,"9":6,"B":2,"a":3,"b":1,"ب":4}',
    );
  });

  it('escapes strings as JSON does and keeps Arabic as is', () => {
    expect(canonicalJson({ text: 'مطعم "الشام"\n', n: -42 })).toBe(
      '{"n":-42,"text":"مطعم \\"الشام\\"\\n"}',
    );
  });

  it('writes -0 as 0 and refuses fractions, unsafe integers and non-JSON values', () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
    expect(() => canonicalJson({ price: 1.5 })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ big: 2 ** 53 })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ nan: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ when: new Date(0) })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ big: 1n })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
  });

  it('refuses what PostgreSQL’s jsonb cannot store: U+0000 and lone surrogates', () => {
    expect(() => canonicalJson({ note: 'a\u0000b' })).toThrow(CanonicalJsonError);
    // A note cut at a length limit through an emoji keeps half of it.
    expect(() => canonicalJson({ note: '😀'.slice(0, 1) })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ note: '\udc00x' })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ 'k\u0000': 1 })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ '\ud800': 1 })).toThrow(CanonicalJsonError);
    expect(canonicalJson({ note: 'طلب 😀' })).toBe('{"note":"طلب 😀"}');
  });
});

describe('hashes', () => {
  it('match fixed SHA-256 vectors over the UTF-8 bytes', () => {
    expect(sha256Hex(canonicalJson({ c: { x: 'y' }, b: [true, false, null], a: 1 }))).toBe(
      'd60ce0b2cb0bbf52b935d2bca2409ab5a89e9e5300bb9fc283383869001a81ca',
    );
    expect(sha256Hex(canonicalJson({ text: 'مطعم "الشام"\n', n: -42 }))).toBe(
      'ba616802ee3dee9943280e1d08a05b87d8db715141332e98fff843e644e75491',
    );
  });

  it('hash a command’s payload with its resolved version', () => {
    expect(
      commandPayloadHash(
        {
          sequence: 1,
          sentAt: '2026-10-28T10:00:00.000Z',
          run: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7f',
        },
        { receivedAt: '2026-10-28T10:00:00.120Z' },
      ),
    ).toBe('5edd24041cb485fc45a49ec10c5844f88a6e325013fd89fbdc7d57f98a1a80b9');
  });
});
