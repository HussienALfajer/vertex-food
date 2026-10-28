import { generateKeyPairSync } from 'node:crypto';
import type { CommandEnvelope } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { checkEnvelope, envelopeSigningMessage, signEnvelope } from './envelope.js';
import { ed25519Signer, ed25519Verifier } from './node.js';

// A fixed Ed25519 key (seed 1..32): its signature of a fixed message must never change.
const FIXED_PRIVATE_KEY = 'MC4CAQAwBQYDK2VwBCIEIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g';
const FIXED_PUBLIC_KEY = 'ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=';

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: Buffer.from(x, 'base64url').toString('base64'),
  };
}

const unsigned = {
  id: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b',
  name: 'sync.network_check',
  version: 1,
  protocol: 1,
  originKind: 'hub_client' as const,
  originDeviceId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c',
  executedByDeviceId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7d',
  actor: {
    kind: 'member' as const,
    membershipId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7e',
    sessionKind: 'hub_client' as const,
  },
  deviceTime: '2026-10-28T10:00:00.000Z',
  clockOffsetMs: -1200,
  highestSeenTime: '2026-10-28T10:00:00.000Z',
  afterOfflineWindow: false,
  hubEpoch: 1,
  hubSeq: 7,
  payload: {
    sentAt: '2026-10-28T10:00:00.000Z',
    sequence: 1,
    run: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7f',
  },
  resolved: { receivedAt: '2026-10-28T10:00:00.120Z' },
};

describe('Ed25519 keys', () => {
  it('sign a fixed message with a fixed key to a fixed signature', () => {
    const signature = ed25519Signer(FIXED_PRIVATE_KEY)('vertex-food/command/v1\n{"a":1}');
    expect(signature).toBe(
      'Acowjp+k8Lxz/H8UVh+jOPHvevt/ujYiH5wRu7b7vOkJbBM522xAWsgQ8T5HiV3Ik/x1LXw8I8N/uqN7IfmwCg==',
    );
    expect(ed25519Verifier(FIXED_PUBLIC_KEY)('vertex-food/command/v1\n{"a":1}', signature)).toBe(
      true,
    );
  });

  it('verify nothing with a malformed key or signature', () => {
    expect(ed25519Verifier('not-a-key')('message', 'AAAA')).toBe(false);
    expect(ed25519Verifier(FIXED_PUBLIC_KEY)('message', 'not base64 at all')).toBe(false);
  });
});

describe('signed envelopes (rules 3, 4)', () => {
  const key = newKey();
  const envelope = signEnvelope(unsigned, ed25519Signer(key.privateKey));
  const verify = ed25519Verifier(key.publicKey);

  it('sign the canonical envelope without its signature, behind a domain tag', () => {
    expect(envelope.payloadHash).toBe(
      '5edd24041cb485fc45a49ec10c5844f88a6e325013fd89fbdc7d57f98a1a80b9',
    );
    const message = envelopeSigningMessage(envelope);
    expect(message.startsWith('vertex-food/command/v1\n{"actor":')).toBe(true);
    expect(message).not.toContain('"signature"');
    expect(envelopeSigningMessage({ ...envelope, signature: `${'B'.repeat(86)}==` })).toBe(message);
  });

  it('check as valid only with the executing PC’s key', () => {
    expect(checkEnvelope(envelope, verify)).toEqual({ ok: true, envelope });
    expect(checkEnvelope(envelope, ed25519Verifier(newKey().publicKey))).toEqual({
      ok: false,
      reason: 'signature_invalid',
    });
  });

  it('refuse a version changed after signing: a forged zero price or another number', () => {
    const forged: CommandEnvelope = {
      ...envelope,
      resolved: { receivedAt: '2026-10-28T09:00:00.000Z' },
    };
    expect(checkEnvelope(forged, verify)).toEqual({ ok: false, reason: 'signature_invalid' });
    const rehashed = signEnvelope({ ...unsigned, hubSeq: 8 }, ed25519Signer(newKey().privateKey));
    expect(checkEnvelope({ ...rehashed, signature: envelope.signature }, verify)).toEqual({
      ok: false,
      reason: 'signature_invalid',
    });
    expect(checkEnvelope({ ...envelope, hubEpoch: 2 }, verify).ok).toBe(false);
  });

  it('refuse an envelope that is not one, or whose payload cannot be canonical', () => {
    expect(checkEnvelope({ ...envelope, name: 'Bad' }, verify)).toEqual({
      ok: false,
      reason: 'payload_invalid',
    });
    expect(checkEnvelope({ ...envelope, payload: { amount: 1.5 } }, verify)).toEqual({
      ok: false,
      reason: 'payload_invalid',
    });
  });
});
