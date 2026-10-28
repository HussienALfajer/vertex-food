import {
  type CommandEnvelope,
  quarantineUploadMessage,
  SYNC_PROTOCOL,
} from '@vertex-food/contracts';
import { API_BODY_BYTES, DeviceApiError, type SyncApi } from './device-client.js';
import type { Registration } from './device-store.js';
import type { LocalReads } from './local-db.js';
import { pendingEnvelopes } from './pending-work.js';

/**
 * Splits the envelopes into parts whose JSON stays under `maxBytes` (the API's body limit), in
 * their order.
 */
export function quarantineParts(
  envelopes: readonly CommandEnvelope[],
  maxBytes = API_BODY_BYTES,
): CommandEnvelope[][] {
  const parts: CommandEnvelope[][] = [];
  let part: CommandEnvelope[] = [];
  let size = 0;
  for (const envelope of envelopes) {
    const bytes = Buffer.byteLength(JSON.stringify(envelope)) + 1;
    if (part.length > 0 && size + bytes > maxBytes) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(envelope);
    size += bytes;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

/**
 * Spec S04 rule 40: a revoked PC uploads its pending commands and the unacknowledged entries of
 * its journal to its revocation's one batch, each part with a fresh challenge nonce signed by its
 * device key. Any failure throws, so the wipe waits and the whole upload runs again later; the
 * server keeps the ids it already holds. A PC whose wipe the server already recorded
 * (`DEVICE_REVOKED`) has nothing more to send.
 */
export async function uploadQuarantine(input: {
  reads: LocalReads;
  registration: Registration;
  client: SyncApi;
  sign: (privateKey: string, message: string) => string;
}): Promise<void> {
  const { tenantId, deviceId, privateKey } = input.registration;
  const envelopes = await pendingEnvelopes(input.reads);
  for (const commands of quarantineParts(envelopes)) {
    const { nonce } = await input.client.challenge(tenantId, deviceId);
    try {
      await input.client.quarantine({
        tenantId,
        deviceId,
        nonce,
        signature: input.sign(privateKey, quarantineUploadMessage(nonce, deviceId)),
        protocol: SYNC_PROTOCOL,
        commands,
      });
    } catch (error) {
      if (error instanceof DeviceApiError && error.code === 'DEVICE_REVOKED') return;
      throw error;
    }
  }
}
