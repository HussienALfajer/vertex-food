import {
  type CommandEnvelope,
  commandEnvelopeSchema,
  type UnsignedCommandEnvelope,
} from '@vertex-food/contracts';
import { canonicalJson, commandPayloadHash } from './canonical.js';

// Signing and checking a command envelope (spec S04 rules 3, 4, 26). The executing PC signs; the
// server and a hub that receives a re-sent version verify against that PC's public key. The key
// operations are ports, so this file runs in any runtime; `@vertex-food/sync/node` implements them
// with Ed25519 from `node:crypto`.

/** Signs a UTF-8 message with the PC's device key; answers the base64 signature. */
export type SignMessage = (message: string) => string;

/** Whether `signature` is the executing PC's signature of `message`. */
export type VerifyMessage = (message: string, signature: string) => boolean;

/** The domain tag keeps a command signature valid for nothing else the device key signs. */
const DOMAIN = 'vertex-food/command/v1';

/** What the executing PC signs: the tag and the canonical JSON of the envelope without `signature`. */
export function envelopeSigningMessage(
  envelope: UnsignedCommandEnvelope | CommandEnvelope,
): string {
  const { signature: _ignored, ...unsigned } = envelope as CommandEnvelope;
  return `${DOMAIN}\n${canonicalJson(unsigned)}`;
}

/** Adds the payload hash and the signature to an envelope the executing PC resolved. */
export function signEnvelope(
  envelope: Omit<UnsignedCommandEnvelope, 'payloadHash'>,
  sign: SignMessage,
): CommandEnvelope {
  const unsigned: UnsignedCommandEnvelope = {
    ...envelope,
    payloadHash: commandPayloadHash(envelope.payload, envelope.resolved),
  };
  return { ...unsigned, signature: sign(envelopeSigningMessage(unsigned)) };
}

export type EnvelopeCheck =
  | { ok: true; envelope: CommandEnvelope }
  | { ok: false; reason: 'payload_invalid' | 'signature_invalid' };

/**
 * Checks an envelope as it arrives (rules 8, 26): its shape, that its payload hash is the hash of
 * its payload and resolved version, and its signature by the executing PC's key. A wrong hash is
 * a signature failure: the PC signed the hash, so the payload was changed after signing.
 */
export function checkEnvelope(value: unknown, verify: VerifyMessage): EnvelopeCheck {
  const parsed = commandEnvelopeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'payload_invalid' };
  const envelope = parsed.data;
  let hash: string;
  try {
    hash = commandPayloadHash(envelope.payload, envelope.resolved);
  } catch {
    return { ok: false, reason: 'payload_invalid' };
  }
  if (hash !== envelope.payloadHash) return { ok: false, reason: 'signature_invalid' };
  if (!verify(envelopeSigningMessage(envelope), envelope.signature)) {
    return { ok: false, reason: 'signature_invalid' };
  }
  return { ok: true, envelope };
}
