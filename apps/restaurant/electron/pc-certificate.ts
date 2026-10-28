// @peculiar/x509 resolves its algorithms through tsyringe, which needs the metadata polyfill
// before it loads (as in the API's `certificates.ts`).
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';
import * as x509 from '@peculiar/x509';
import { instantSchema, isPrivateIpv4, sha256HexSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import { SealedFile, type Sealer } from './device-store.js';

// The PC's certificate for the branch LAN (spec S04 rule 39, ADR 0035): a new P-256 key and a
// PKCS #10 request naming the PC's private IPv4 addresses, signed by the branch CA on the server.
// The key and the certificate are sealed by `safeStorage` beside the device record; the hub's
// HTTPS server and the peers' mutual TLS (PR 5) use them.

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** A certificate this close to its end is asked for again (a PC certificate lasts a year). */
export const CERTIFICATE_RENEW_MS = 30 * 24 * 3600_000;

export const pcCertificateSchema = z.object({
  /** PKCS #8 PEM. */
  privateKey: z.string().min(1),
  certificate: z.string().min(1),
  caCertificate: z.string().min(1),
  /** The branch CA's SHA-256 fingerprint. */
  caFingerprint: sha256HexSchema,
  lanAddresses: z.array(z.ipv4()),
  expiresAt: instantSchema,
});

export type PcCertificate = z.infer<typeof pcCertificateSchema>;

export class CertificateStore extends SealedFile<PcCertificate> {
  constructor(path: string, sealer: Sealer) {
    super(path, sealer, pcCertificateSchema);
  }
}

/** The PC's private IPv4 addresses (RFC 1918), sorted, at most 8 (`lanAddressesSchema`). */
export function privateLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const addresses = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((info) => info.family === 'IPv4' && !info.internal && isPrivateIpv4(info.address))
    .map((info) => info.address);
  return [...new Set(addresses)].sort().slice(0, 8);
}

/** A certificate is asked for when there is none, the addresses changed, or it nears its end. */
export function needsCertificate(
  current: PcCertificate | null,
  addresses: readonly string[],
  now: Date,
): boolean {
  if (addresses.length === 0) return false;
  if (!current) return true;
  const same =
    current.lanAddresses.length === addresses.length &&
    [...current.lanAddresses].sort().every((address, index) => address === addresses[index]);
  return !same || Date.parse(current.expiresAt) - now.getTime() < CERTIFICATE_RENEW_MS;
}

/** A new P-256 key and its signed request for the PC's addresses. */
export async function certificateRequest(
  deviceId: string,
  lanAddresses: readonly string[],
): Promise<{ csr: string; privateKey: string }> {
  const keys = (await webcrypto.subtle.generateKey(EC, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const request = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${deviceId}`,
    keys: keys as unknown as CryptoKeyPair,
    signingAlgorithm: SIGNING,
    extensions: [
      new x509.SubjectAlternativeNameExtension(
        lanAddresses.map((address) => ({ type: 'ip' as const, value: address })),
      ),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    csr: request.toString('pem'),
    privateKey: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'),
  };
}

/** When a PEM certificate ends. */
export function certificateExpiry(pem: string): Date {
  return new x509.X509Certificate(pem).notAfter;
}
