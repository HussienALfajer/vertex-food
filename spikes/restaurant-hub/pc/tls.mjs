// A branch certificate authority and the hub PCs' certificates (spike only).
// Hub clients trust the branch CA once, at pairing, so they also trust the standby PC without a second pairing.
import crypto from 'node:crypto';
import os from 'node:os';
import forge from 'node-forge';

function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' })),
    publicKey: forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' })),
  };
}

function baseCert(publicKey, cn, years) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = `01${crypto.randomBytes(15).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + years * 365 * 86400000);
  cert.setSubject([{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Vertex Food spike' }]);
  return cert;
}

export function createBranchCa(cn) {
  const keys = keyPair();
  const cert = baseCert(keys.publicKey, cn, 10);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4').map((a) => a.address);
}

export function issueHubCert(ca, cn) {
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
  const keys = keyPair();
  const cert = baseCert(keys.publicKey, cn, 2);
  cert.setIssuer(caCert.subject.attributes);
  const ips = [...new Set(['127.0.0.1', ...lanAddresses()])];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))] },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

// A certificate that no branch CA signed, for the man-in-the-middle check.
export function selfSignedCert(cn) {
  const keys = keyPair();
  const cert = baseCert(keys.publicKey, cn, 1);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

export const fingerprint = (pem) => new crypto.X509Certificate(pem).fingerprint256;
