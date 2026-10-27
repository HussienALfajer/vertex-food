import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { leadingZeroBits, solveProofOfWork, solvesProofOfWork } from './proof-of-work.js';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('proof of work', () => {
  it('hashes with SHA-256 (FIPS 180-4 test vector)', () => {
    expect(hex(sha256(utf8ToBytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('counts leading zero bits as the API does', () => {
    expect(leadingZeroBits(Uint8Array.of(0x80))).toBe(0);
    expect(leadingZeroBits(Uint8Array.of(0x01, 0xff))).toBe(7);
    expect(leadingZeroBits(Uint8Array.of(0x00, 0x00, 0x10))).toBe(19);
    expect(leadingZeroBits(Uint8Array.of(0x00, 0x00))).toBe(16);
  });

  it('finds a nonce that solves the challenge at its difficulty', () => {
    const challenge = { challenge: 'abc.123.12.mac', difficulty: 12, expiresAt: '' };
    const solution = solveProofOfWork(challenge);
    expect(solution.challenge).toBe(challenge.challenge);
    expect(solvesProofOfWork(challenge.challenge, solution.nonce, 12)).toBe(true);
    expect(solution.nonce.length).toBeLessThanOrEqual(64);
  });
});
