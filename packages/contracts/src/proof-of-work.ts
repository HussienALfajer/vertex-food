import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { ProofOfWorkChallenge, ProofOfWorkSolution } from './identity.js';

/**
 * The client's side of the proof of work on sign-in and OTP requests (ADR 0016, spec S02 rule
 * 12): a `nonce` such that SHA-256 of `<challenge>:<nonce>` (UTF-8) starts with `difficulty` zero
 * bits. Pure JavaScript, so the restaurant app and the console solve it under a CSP without WASM.
 */

/** Leading zero bits of `digest`. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function solvesProofOfWork(challenge: string, nonce: string, difficulty: number): boolean {
  return leadingZeroBits(sha256(utf8ToBytes(`${challenge}:${nonce}`))) >= difficulty;
}

/** Tries nonces in order until one solves the challenge (2^difficulty tries on average). */
export function solveProofOfWork(challenge: ProofOfWorkChallenge): ProofOfWorkSolution {
  for (let attempt = 0; ; attempt += 1) {
    const nonce = attempt.toString(36);
    if (solvesProofOfWork(challenge.challenge, nonce, challenge.difficulty)) {
      return { challenge: challenge.challenge, nonce };
    }
  }
}
