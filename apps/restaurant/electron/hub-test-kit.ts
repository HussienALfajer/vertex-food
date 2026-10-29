// @peculiar/x509 needs the metadata polyfill before it loads (as `pc-certificate.ts`).
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import {
  type DeviceMember,
  type HubCommand,
  type HubCommandAnswer,
  type HubHello,
  hubCommandAnswerSchema,
  hubHelloSchema,
} from '@vertex-food/contracts';
import type { HubClientTransport } from '@vertex-food/sync';
import { generateDeviceKey } from './device-key.js';
import { tempFolder } from './device-test-kit.js';
import { HubRuntime, type HubRuntimeDeps } from './hub-runtime.js';
import { generateDatabaseKey, type OpenedDatabase, openLocalDatabase } from './local-db.js';
import { certificateExpiry, type PcCertificate } from './pc-certificate.js';
import { uuidv7 } from './uuid.js';

// A branch on the loopback interface for the hub's tests on the real ports (spec S04 "Tests"): a
// branch CA made here as the API makes it, PCs at 127.0.0.x with their encrypted databases and
// certificates, members whose PINs are `pin:<digits>`, and a phone's HTTPS transport. Synthetic
// data only.

const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

type KeyPair = { privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey };

async function keyPair(): Promise<KeyPair> {
  return (await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify'])) as KeyPair;
}

async function pkcs8(key: webcrypto.CryptoKey): Promise<string> {
  return x509.PemConverter.encode(await webcrypto.subtle.exportKey('pkcs8', key), 'PRIVATE KEY');
}

export type TestCa = { certificate: string; keys: KeyPair; fingerprint: string };

export async function createBranchCa(): Promise<TestCa> {
  const keys = await keyPair();
  const now = new Date();
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: `CN=Test branch ${uuidv7()}, O=Vertex Food`,
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + 365 * 24 * 3600_000),
    keys: keys as unknown as CryptoKeyPair,
    signingAlgorithm: SIGNING,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });
  const thumbprint = await certificate.getThumbprint('SHA-256', webcrypto as unknown as Crypto);
  return {
    certificate: certificate.toString('pem'),
    keys,
    fingerprint: Buffer.from(thumbprint).toString('hex'),
  };
}

/** A PC certificate as the API issues it: `CN=<device id>`, its addresses, server and client. */
export async function issuePcCertificate(
  ca: TestCa,
  deviceId: string,
  addresses: readonly string[],
): Promise<PcCertificate> {
  const keys = await keyPair();
  const now = new Date();
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: Buffer.from(uuidv7().replaceAll('-', ''), 'hex').toString('hex'),
    subject: `CN=${deviceId}, O=Vertex Food`,
    issuer: new x509.X509Certificate(ca.certificate).subject,
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + 30 * 24 * 3600_000),
    publicKey: keys.publicKey as unknown as CryptoKey,
    signingKey: ca.keys.privateKey as unknown as CryptoKey,
    signingAlgorithm: SIGNING,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(
        [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth],
        true,
      ),
      new x509.SubjectAlternativeNameExtension(
        addresses.map((address) => ({ type: 'ip' as const, value: address })),
      ),
    ],
  });
  const pem = certificate.toString('pem');
  return {
    deviceId,
    privateKey: await pkcs8(keys.privateKey),
    certificate: pem,
    caCertificate: ca.certificate,
    caFingerprint: ca.fingerprint,
    lanAddresses: [...addresses],
    expiresAt: certificateExpiry(pem).toISOString(),
  };
}

/** A port free on the loopback interface now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export const MANAGER = uuidv7();
export const WAITER = uuidv7();

export const testMembers: DeviceMember[] = [
  {
    membershipId: MANAGER,
    name: 'مدير الصالة',
    roles: ['manager'],
    permissions: ['hub.manage', 'sync.attention.resolve'],
    pinVerifier: 'pin:246810',
    pinDisabled: false,
  },
  {
    membershipId: WAITER,
    name: 'نادل',
    roles: ['waiter'],
    permissions: [],
    pinVerifier: 'pin:135790',
    pinDisabled: false,
  },
];

export type TestPcRole = 'hub' | 'standby' | null;

export type TestPc = {
  deviceId: string;
  address: string;
  role: TestPcRole;
  publicKey: string;
  privateKey: string;
  certificate: PcCertificate;
  directory: string;
  databaseKey: string;
  local: OpenedDatabase | null;
  runtime: HubRuntime | null;
  session: string | null;
};

const BRANCH_ID = uuidv7();

/** A branch of PCs on the loopback interface, one port for all. */
export class LoopbackBranch {
  readonly pcs: TestPc[] = [];
  readonly pages = tempFolder();

  private constructor(
    readonly ca: TestCa,
    readonly port: number,
    readonly caPort: number,
  ) {
    mkdirSync(this.pages, { recursive: true });
    writeFileSync(join(this.pages, 'index.html'), '<!doctype html><title>hub</title>');
  }

  static async create(): Promise<LoopbackBranch> {
    return new LoopbackBranch(await createBranchCa(), await freePort(), await freePort());
  }

  async addPc(role: TestPcRole, address: string): Promise<TestPc> {
    const key = generateDeviceKey();
    const deviceId = uuidv7();
    const pc: TestPc = {
      deviceId,
      address,
      role,
      publicKey: key.publicKey,
      privateKey: key.privateKey,
      certificate: await issuePcCertificate(this.ca, deviceId, [address]),
      directory: tempFolder(),
      databaseKey: generateDatabaseKey(),
      local: null,
      runtime: null,
      session: MANAGER,
    };
    this.pcs.push(pc);
    return pc;
  }

  /** The synced rows every PC of the branch holds after a checkpoint. */
  private async seed(pc: TestPc): Promise<void> {
    const db = pc.local?.db;
    if (!db) throw new Error('Expected a whole database');
    await db.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM devices');
      await tx.execute('DELETE FROM device_certificates');
      await tx.execute(
        `INSERT OR REPLACE INTO branches (id, business_day_ends_at, idle_lock_minutes)
         VALUES (?, '04:00:00', 5)`,
        [BRANCH_ID],
      );
      for (const other of this.pcs) {
        await tx.execute(
          'INSERT INTO devices (id, name, status, hub_role, public_key) VALUES (?, ?, ?, ?, ?)',
          [other.deviceId, `PC ${other.address}`, 'active', other.role, other.publicKey],
        );
        await tx.execute(
          `INSERT INTO device_certificates (id, device_id, fingerprint_sha256, lan_addresses,
             expires_at) VALUES (?, ?, ?, ?, ?)`,
          [
            uuidv7(),
            other.deviceId,
            'a'.repeat(64),
            JSON.stringify([other.address]),
            other.certificate.expiresAt,
          ],
        );
      }
    });
  }

  /** Marks a PC revoked in every running PC's synced device list (rule 42). */
  async revoke(target: TestPc): Promise<void> {
    for (const pc of this.pcs) {
      await pc.local?.db?.execute("UPDATE devices SET status = 'revoked' WHERE id = ?", [
        target.deviceId,
      ]);
      await pc.runtime?.refresh();
    }
  }

  async start(pc: TestPc, extra: Partial<HubRuntimeDeps> = {}): Promise<HubRuntime> {
    pc.local = await openLocalDatabase(pc.directory, pc.databaseKey);
    await this.seed(pc);
    const runtime = new HubRuntime({
      registration: { deviceId: pc.deviceId, branchId: BRANCH_ID, privateKey: pc.privateKey },
      local: pc.local,
      device: {
        members: () => testMembers,
        clock: () => null,
        checkPin: async (membershipId, pin) =>
          testMembers.find((m) => m.membershipId === membershipId)?.pinVerifier === `pin:${pin}`
            ? 'ok'
            : 'invalid',
        sessionMember: () => pc.session,
        afterOfflineWindow: () => false,
      },
      verifyPin: async (pin, verifier) => verifier === `pin:${pin}`,
      certificate: () => pc.certificate,
      connectivity: () => 'offline',
      online: () => false,
      appVersion: '1.0.0',
      pagesDirectory: this.pages,
      listen: { host: pc.address, port: this.port, caPort: this.caPort },
      onChange: () => undefined,
      onRoleChange: () => undefined,
      ...extra,
    });
    pc.runtime = runtime;
    await runtime.start();
    return runtime;
  }

  /** The power goes: the runtime and its server stop, and the database closes as it was. */
  async powerOff(pc: TestPc): Promise<void> {
    await pc.runtime?.stop();
    pc.runtime = null;
    await pc.local?.close();
    pc.local = null;
  }

  async stopAll(): Promise<void> {
    for (const pc of this.pcs) await this.powerOff(pc);
  }

  url(pc: TestPc, path: string): string {
    return `https://${pc.address}:${this.port}${path}`;
  }
}

export type HttpsAnswer = { status: number; body: unknown; headers: Record<string, unknown> };

/** A call as a phone's browser makes it: the branch CA trusted, no client certificate. */
export function phoneCall(
  url: string,
  options: {
    ca: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    cert?: { key: string; cert: string };
    timeoutMs?: number;
  },
): Promise<HttpsAnswer> {
  return new Promise((resolve, reject) => {
    const data = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        ca: options.ca,
        ...(options.cert ?? {}),
        agent: false,
        headers: {
          ...(data ? { 'content-type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            // Not JSON: a page or a certificate.
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), options.timeoutMs ?? 3000);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(data);
  });
}

/** A paired phone's transport to the hub, with its pairing token and PIN session. */
export function phoneTransport(
  branch: LoopbackBranch,
  phone: { token: string; session: string | null },
): HubClientTransport {
  const headers = (): Record<string, string> => ({
    authorization: `Bearer ${phone.token}`,
    ...(phone.session ? { 'x-hub-session': phone.session } : {}),
  });
  return {
    async hello(address, timeoutMs): Promise<HubHello> {
      const answer = await phoneCall(`https://${address}:${branch.port}/hub/hello`, {
        ca: branch.ca.certificate,
        headers: headers(),
        timeoutMs,
      });
      if (answer.status !== 200) throw new Error(`hello ${answer.status}`);
      return hubHelloSchema.parse(answer.body);
    },
    async command(address, command: HubCommand, timeoutMs): Promise<HubCommandAnswer> {
      const answer = await phoneCall(`https://${address}:${branch.port}/hub/commands`, {
        ca: branch.ca.certificate,
        method: 'POST',
        body: command,
        headers: headers(),
        timeoutMs,
      });
      if (answer.status !== 200 && answer.status !== 409) throw new Error(`${answer.status}`);
      return hubCommandAnswerSchema.parse(answer.body);
    },
  };
}

/** Waits until `check` holds, polling; fails with `what` after `timeoutMs`. */
export async function eventually(
  what: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs = 8000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
