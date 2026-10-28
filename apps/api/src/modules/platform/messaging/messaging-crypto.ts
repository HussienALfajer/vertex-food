import { KeyedHash, SecretBox } from '@vertex-food/crypto';
import type { MessagingCrypto } from '@vertex-food/db';
import type { Config } from '../../../core/config/config.js';

/** The messaging keys (`MESSAGING_HASH_KEY`, `MESSAGING_ENCRYPTION_KEY`), never identity's. */
export const MESSAGING_CRYPTO = Symbol('MessagingCrypto');

export function messagingCrypto(keys: Config['messaging']): MessagingCrypto {
  return { hash: new KeyedHash(keys.hashKey), box: new SecretBox(keys.encryptionKey) };
}

/**
 * The context of a session's sealed QR code (`whatsapp_sessions.qr_sealed`), which the gateway
 * seals with the messaging key and the console reads while linking (spec S03 rule 4).
 */
export function whatsappQrSealContext(sessionId: string): string {
  return `whatsapp-qr:${sessionId}`;
}
