import type { Nonces } from './single-use.js';

/**
 * A registered PC's proof of its device key outside a device token (spec S04 rule 40): the nonce
 * of the device-token challenge (`POST /api/devices/token/challenge`), used up once, which the PC
 * signs with its key. A revoked PC proves itself this way to upload its quarantine batch.
 */
export class DeviceProofs {
  constructor(private readonly nonces: Nonces) {}

  /** Uses up the nonce issued to the PC, or refuses with `SIGNATURE_INVALID`. */
  takeNonce(tenantId: string, deviceId: string, nonce: string): void {
    this.nonces.take(nonce, `device:${tenantId}:${deviceId}`);
  }
}
