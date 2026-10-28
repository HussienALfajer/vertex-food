import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import {
  type CommandEnvelope,
  SYNC_PROTOCOL,
  type UnsignedCommandEnvelope,
  type UploadedCommand,
} from '@vertex-food/contracts';
import type { Database } from '@vertex-food/db';
import { signEnvelope } from '@vertex-food/sync';
import { ed25519Signer } from '@vertex-food/sync/node';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { pinFor, type TestApi, type TestDevice } from './staff.js';

// Signed commands and hub-capable PCs for the sync tests (spec S04): envelopes signed with a
// test PC's device key as the restaurant app signs them, and the branch's second and third PCs,
// registered by managers of the branch so no phone receives two OTPs.

/** The database's clock: `received_at` is the transaction's start, which tests compare with. */
export async function serverNow(db: Database): Promise<Date> {
  const result = await db.execute<{ now: Date }>(sql`select now() as now`);
  return new Date(result.rows[0]?.now as Date);
}

let sequence = 0;

export type CommandFields = Partial<Omit<UnsignedCommandEnvelope, 'payloadHash'>>;

/** A command executed and signed by `executor`: a network check of `membershipId` by default. */
export function signedCommand(
  executor: TestDevice,
  fields: CommandFields & { membershipId?: string; at?: Date } = {},
): CommandEnvelope {
  const { membershipId, at, ...rest } = fields;
  const time = (at ?? new Date()).toISOString();
  sequence += 1;
  const unsigned = {
    id: uuidv7(),
    name: 'sync.network_check',
    version: 1,
    protocol: SYNC_PROTOCOL,
    originKind: 'pc' as const,
    originDeviceId: executor.deviceId,
    executedByDeviceId: executor.deviceId,
    actor: membershipId
      ? { kind: 'member' as const, membershipId, sessionKind: 'pc' as const }
      : { kind: 'device' as const },
    deviceTime: time,
    clockOffsetMs: 0,
    highestSeenTime: time,
    afterOfflineWindow: false,
    hubEpoch: 1,
    hubSeq: sequence,
    payload: { sentAt: time, sequence: 1, run: uuidv7() },
    resolved: { receivedAt: time },
    ...rest,
  };
  return signEnvelope(unsigned, signerOf(executor));
}

/** Signs an envelope again after a test changed it, as a PC would sign its own version. */
export function resign(executor: TestDevice, envelope: CommandEnvelope): CommandEnvelope {
  const { signature: _signature, payloadHash: _hash, ...unsigned } = envelope;
  return signEnvelope(unsigned, signerOf(executor));
}

function signerOf(device: TestDevice) {
  return ed25519Signer(
    device.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  );
}

export const uploaded = (envelope: CommandEnvelope, mirrored = true): UploadedCommand => ({
  envelope,
  mirrored,
});

/** `POST /api/sync/commands` from `device`, answering with `status` when one is given. */
export async function upload(device: TestDevice, commands: UploadedCommand[], status?: number) {
  const http = await device.device();
  const request = http.post('/api/sync/commands').send({ protocol: SYNC_PROTOCOL, commands });
  return status === undefined ? request : request.expect(status);
}

/**
 * A manager of `branchId`, who registers another PC there; with a PIN when the branch is the one
 * of `setup`'s PC (a PIN is set on a PC of the member's branch).
 */
export async function registerPc(
  api: TestApi,
  setup: { tenantId: string; device: TestDevice; owner: Parameters<TestDevice['as']>[0] },
  branchId: string,
  seed: number,
) {
  const manager = await setup.device.addMember(
    setup.owner,
    {
      displayName: 'مدير',
      roles: ['manager'],
      branchScope: { allBranches: false, branchIds: [branchId] },
    },
    branchId === setup.device.registration.device.branchId ? pinFor(seed) : undefined,
  );
  const { ticket } = await api.firstSignIn(manager.phone);
  const device = await api.registerDevice(ticket, setup.tenantId, branchId);
  return { device, manager };
}

/** A PC's certificate request for a new key, as the restaurant app makes it (P-256 by default). */
export async function certificateRequest(
  algorithm: webcrypto.EcKeyGenParams | webcrypto.RsaHashedKeyGenParams = {
    name: 'ECDSA',
    namedCurve: 'P-256',
  },
): Promise<string> {
  const keys = (await webcrypto.subtle.generateKey(algorithm, false, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const request = await x509.Pkcs10CertificateRequestGenerator.create(
    {
      name: 'CN=restaurant-pc',
      keys,
      signingAlgorithm:
        algorithm.name === 'ECDSA'
          ? { name: 'ECDSA', hash: 'SHA-256' }
          : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    },
    webcrypto as unknown as Parameters<typeof x509.Pkcs10CertificateRequestGenerator.create>[1],
  );
  return request.toString('pem');
}
