// @peculiar/x509 resolves its algorithms through tsyringe, which needs the metadata polyfill
// before it loads; Nest loads it too, so this changes nothing in the API process.
import 'reflect-metadata';
import { createHash, webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { BRANCH_CA_YEARS, DEVICE_CERTIFICATE_DAYS } from '@vertex-food/contracts';

// The branch certificate authority and the PC certificates (spec S04 rules 38, 39, ADR 0035):
// ECDSA P-256 with SHA-256. A CA is made at a branch's first PC registration and lasts 10 years;
// it signs each PC's certificate for the PC's private LAN addresses, naming the PC's device id, so
// the PCs authenticate each other by mutual TLS and hub clients trust the branch once.

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const subtle = webcrypto.subtle;
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY_MS = 86_400_000;

/** SHA-256 of a certificate's DER bytes in lower-case hex, as the hub's pairing screen shows it. */
export function certificateFingerprint(pem: string): string {
  return createHash('sha256')
    .update(new Uint8Array(new x509.X509Certificate(pem).rawData))
    .digest('hex');
}

export type NewAuthority = {
  certificatePem: string;
  /** The private key, PKCS #8 DER in base64, sealed before it is stored. */
  privateKeyPkcs8: string;
  fingerprint: string;
};

/** A new branch CA, self-signed, valid `BRANCH_CA_YEARS` from `now`. */
export async function createBranchAuthority(branchId: string, now: Date): Promise<NewAuthority> {
  const keys = (await subtle.generateKey(EC, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + BRANCH_CA_YEARS);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    name: `CN=Vertex Food branch ${branchId}, O=Vertex Food`,
    keys,
    signingAlgorithm: SIGNING,
    notBefore: now,
    notAfter,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const pkcs8 = await subtle.exportKey('pkcs8', keys.privateKey);
  const certificatePem = certificate.toString('pem');
  return {
    certificatePem,
    privateKeyPkcs8: Buffer.from(pkcs8).toString('base64'),
    fingerprint: certificateFingerprint(certificatePem),
  };
}

/** Why a certificate request is refused; the API answers `VALIDATION_FAILED`. */
export class CertificateRequestError extends Error {
  override readonly name = 'CertificateRequestError';
}

/**
 * A PC certificate for `request`, a PKCS #10 request in PEM for a P-256 key that the PC proves it
 * holds (the request's own signature), signed by the branch CA: the device id as its subject, the
 * private addresses as its only names, for server and client authentication, valid
 * `DEVICE_CERTIFICATE_DAYS`. The caller has checked the addresses.
 */
export async function issueDeviceCertificate(input: {
  request: string;
  deviceId: string;
  lanAddresses: readonly string[];
  authority: { certificatePem: string; privateKeyPkcs8: string };
  now: Date;
}): Promise<{ certificatePem: string; fingerprint: string; expiresAt: Date }> {
  let request: x509.Pkcs10CertificateRequest;
  try {
    request = new x509.Pkcs10CertificateRequest(input.request);
  } catch {
    throw new CertificateRequestError('The certificate request does not parse');
  }
  const algorithm = request.publicKey.algorithm as webcrypto.EcKeyAlgorithm;
  if (algorithm.name !== 'ECDSA' || algorithm.namedCurve !== 'P-256') {
    throw new CertificateRequestError('The certificate request is not for a P-256 key');
  }
  if (!(await request.verify())) {
    throw new CertificateRequestError('The certificate request signature does not verify');
  }
  const authority = new x509.X509Certificate(input.authority.certificatePem);
  const signingKey = await subtle.importKey(
    'pkcs8',
    Buffer.from(input.authority.privateKeyPkcs8, 'base64'),
    EC,
    false,
    ['sign'],
  );
  const expiresAt = new Date(input.now.getTime() + DEVICE_CERTIFICATE_DAYS * DAY_MS);
  const certificate = await x509.X509CertificateGenerator.create({
    subject: `CN=${input.deviceId}, O=Vertex Food`,
    issuer: authority.subject,
    publicKey: request.publicKey,
    signingKey,
    signingAlgorithm: SIGNING,
    notBefore: input.now,
    notAfter: expiresAt,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(
        [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth],
        false,
      ),
      new x509.SubjectAlternativeNameExtension(
        input.lanAddresses.map((address) => ({ type: 'ip' as const, value: address })),
        false,
      ),
      await x509.SubjectKeyIdentifierExtension.create(request.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(authority.publicKey),
    ],
  });
  const certificatePem = certificate.toString('pem');
  return { certificatePem, fingerprint: certificateFingerprint(certificatePem), expiresAt };
}
