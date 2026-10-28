import 'reflect-metadata';
import { X509Certificate as NodeCertificate, webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { describe, expect, it } from 'vitest';
import {
  CertificateRequestError,
  certificateFingerprint,
  createBranchAuthority,
  issueDeviceCertificate,
} from './certificates.js';

const DEVICE_ID = '01960000-0000-7000-8000-000000000001';
const now = new Date('2026-10-28T10:00:00Z');

/** A PC's certificate request for a new key of `algorithm`, as the restaurant app makes it. */
async function certificateRequest(
  algorithm: webcrypto.EcKeyGenParams | webcrypto.RsaHashedKeyGenParams = {
    name: 'ECDSA',
    namedCurve: 'P-256',
  },
): Promise<string> {
  const keys = (await webcrypto.subtle.generateKey(algorithm, false, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const request = await x509.Pkcs10CertificateRequestGenerator.create({
    name: 'CN=restaurant-pc',
    keys,
    signingAlgorithm:
      algorithm.name === 'ECDSA'
        ? { name: 'ECDSA', hash: 'SHA-256' }
        : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  });
  return request.toString('pem');
}

describe('the branch CA (spec S04 rule 38)', () => {
  it('is a self-signed P-256 CA for 10 years whose fingerprint is its DER hash', async () => {
    const authority = await createBranchAuthority('01960000-0000-7000-8000-0000000000aa', now);
    const certificate = new NodeCertificate(authority.certificatePem);
    expect(certificate.ca).toBe(true);
    expect(certificate.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(certificate.checkIssued(certificate)).toBe(true);
    expect(new Date(certificate.validTo).getUTCFullYear()).toBe(2036);
    expect(authority.fingerprint).toBe(
      certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    );
    expect(certificateFingerprint(authority.certificatePem)).toBe(authority.fingerprint);
  });
});

describe('PC certificates (spec S04 rule 39)', () => {
  it('names the device and its private addresses, signed by the branch CA, for a year', async () => {
    const authority = await createBranchAuthority('01960000-0000-7000-8000-0000000000aa', now);
    const issued = await issueDeviceCertificate({
      request: await certificateRequest(),
      deviceId: DEVICE_ID,
      lanAddresses: ['192.168.1.20', '10.0.0.5'],
      authority,
      now,
    });
    const certificate = new NodeCertificate(issued.certificatePem);
    const ca = new NodeCertificate(authority.certificatePem);
    expect(certificate.checkIssued(ca)).toBe(true);
    expect(certificate.verify(ca.publicKey)).toBe(true);
    expect(certificate.ca).toBe(false);
    expect(certificate.subject).toContain(`CN=${DEVICE_ID}`);
    expect(certificate.subjectAltName).toBe('IP Address:192.168.1.20, IP Address:10.0.0.5');
    expect(certificate.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(issued.expiresAt).toEqual(new Date('2027-10-28T10:00:00Z'));
    expect(issued.fingerprint).toBe(certificate.fingerprint256.replaceAll(':', '').toLowerCase());
  });

  it('refuses a request that does not parse, for another key type, or with a bad signature', async () => {
    const authority = await createBranchAuthority('01960000-0000-7000-8000-0000000000aa', now);
    const issue = (request: string) =>
      issueDeviceCertificate({
        request,
        deviceId: DEVICE_ID,
        lanAddresses: ['192.168.1.20'],
        authority,
        now,
      });
    await expect(issue('not a request')).rejects.toBeInstanceOf(CertificateRequestError);
    const rsa = await certificateRequest({
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    });
    await expect(issue(rsa)).rejects.toBeInstanceOf(CertificateRequestError);
    // The same request with one byte of its signature changed.
    const der = Buffer.from(
      (await certificateRequest()).replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
      'base64',
    );
    der[der.length - 1] = (der[der.length - 1] as number) ^ 0x01;
    const forged = `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString('base64')}\n-----END CERTIFICATE REQUEST-----`;
    await expect(issue(forged)).rejects.toBeInstanceOf(CertificateRequestError);
  });
});
