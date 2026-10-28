import { createPublicKey, X509Certificate as NodeCertificate, verify } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SYNC_PROTOCOL } from '@vertex-food/contracts';
import {
  auditEntries,
  branchCertificateAuthorities,
  branchConnectivityChanges,
  createDatabase,
  deviceCertificates,
  deviceSyncStates,
  outboxEvents,
  withTenant,
} from '@vertex-food/db';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, TEST_SYNC_ENV } from './app.js';
import { pinFor, TestApi, TestDevice } from './staff.js';
import { certificateRequest, registerPc, signedCommand, upload, uploaded } from './sync.js';

// Spec S04 rules 17, 38, 39, 43–45 over HTTP: the sync service's token and its JWKS, heartbeats
// and the branch's connectivity, number blocks, the branch CA and PC certificates, hub roles and
// the branch's sync status; each refused without a token or permission, for a client PC on the
// hub-only routes, and for another tenant's branch.

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

/** A branch with its hub (the owner's PC), standby and a client PC. */
async function branch() {
  const setup = await api.ownerOnDevice(['main', 'east']);
  const [main, east] = setup.branchIds as [string, string];
  const standby = await registerPc(api, setup, main, 1);
  const client = await registerPc(api, setup, main, 2);
  return { ...setup, main, east, hub: setup.device, standby, client };
}

const heartbeat = (fields: Record<string, unknown> = {}) => ({
  lastRoundTripMs: 50,
  pendingUploads: 0,
  liveRole: 'hub',
  hubEpoch: 1,
  standbyInSync: true,
  appVersion: '0.1.0',
  protocol: SYNC_PROTOCOL,
  lanAddresses: ['192.168.1.20'],
  clockOffsetMs: 12,
  ...fields,
});

async function beat(device: TestDevice, fields: Record<string, unknown> = {}) {
  const http = await device.device();
  return http.post('/api/sync/heartbeat').send(heartbeat(fields));
}

function claims(token: string) {
  const [, payload] = token.split('.') as [string, string];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('the sync service token (rule 45)', () => {
  it('names the PC, its tenant and branch for 5 minutes, signed by the JWKS key', async () => {
    const b = await api.ownerOnDevice();
    const http = await b.device.device();
    const response = await http.get('/api/sync/token').expect(200);
    expect(response.body.endpoint).toBe(TEST_SYNC_ENV.SYNC_ENDPOINT);
    const token = response.body.token as string;
    const body = claims(token);
    expect(body).toMatchObject({
      sub: b.device.deviceId,
      aud: 'powersync',
      tenant_id: b.tenantId,
      branch_id: b.branchIds[0],
      device_id: b.device.deviceId,
    });
    expect(body.exp - body.iat).toBe(300);
    expect(new Date(response.body.expiresAt).getTime()).toBe(body.exp * 1000);

    const jwks = await api.http().get('/api/.well-known/jwks.json').expect(200);
    const [key] = jwks.body.keys;
    expect(key).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).kid).toBe(key.kid);
    const publicKey = createPublicKey({ key: key, format: 'jwk' });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('refuses a request without a device token', async () => {
    const response = await api.http().get('/api/sync/token');
    expect([response.status, response.body.code]).toEqual([401, 'UNAUTHENTICATED']);
  });

  it('answers UPDATE_REQUIRED below the minimum app version, while uploads still run', async () => {
    const b = await api.ownerOnDevice();
    const strict = await createTestApp({ env: { SYNC_MINIMUM_APP_VERSION: '9.0.0' } });
    try {
      const strictApi = new TestApi(strict, db);
      const device = new TestDevice(
        strictApi,
        b.tenantId,
        b.device.deviceId,
        b.device.privateKey,
        b.device.registration,
      );
      const http = await device.device();
      const token = await http.get('/api/sync/token');
      expect([token.status, token.body.code]).toEqual([426, 'UPDATE_REQUIRED']);
      const blocks = await http.post('/api/sync/number-blocks').send({ series: 'order' });
      expect([blocks.status, blocks.body.code]).toEqual([426, 'UPDATE_REQUIRED']);
      const command = signedCommand(device, { membershipId: b.ownerMembershipId });
      const uploadedCommand = await upload(device, [uploaded(command)], 200);
      expect(uploadedCommand.body.results[0]).toMatchObject({ outcome: 'accepted' });
    } finally {
      await strict.close();
    }
  });
});

describe('heartbeats and connectivity (rules 43, 44)', () => {
  it('records the PC’s state and moves the branch online after four healthy heartbeats', async () => {
    const b = await branch();
    const first = await beat(b.hub, { lastRoundTripMs: null });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      connectivity: 'weak',
      minimumAppVersion: '0.0.0',
      protocols: [SYNC_PROTOCOL],
    });
    expect(Math.abs(new Date(first.body.serverTime).getTime() - Date.now())).toBeLessThan(10_000);
    for (let i = 0; i < 3; i++) await beat(b.hub);
    const fourth = await beat(b.hub, { pendingUploads: 3 });
    expect(fourth.body.connectivity).toBe('online');
    const [state] = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(deviceSyncStates).where(eq(deviceSyncStates.deviceId, b.hub.deviceId)),
    );
    expect(state).toMatchObject({
      recentRttMs: [50, 50, 50, 50],
      pendingUploads: 3,
      liveRole: 'hub',
      standbyInSync: true,
      lanAddresses: ['192.168.1.20'],
      clockOffsetMs: 12,
    });
    const changes = await withTenant(db, b.tenantId, (tx) =>
      tx
        .select({
          from: branchConnectivityChanges.fromState,
          to: branchConnectivityChanges.toState,
        })
        .from(branchConnectivityChanges)
        .where(eq(branchConnectivityChanges.branchId, b.main)),
    );
    expect(changes).toEqual([
      { from: 'offline', to: 'weak' },
      { from: 'weak', to: 'online' },
    ]);
    const events = await withTenant(db, b.tenantId, (tx) =>
      tx
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.type, 'branch.connectivity_changed.v1')),
    );
    expect(events.map((event) => event.payload)).toEqual([
      { tenantId: b.tenantId, branchId: b.main, from: 'offline', to: 'weak' },
      { tenantId: b.tenantId, branchId: b.main, from: 'weak', to: 'online' },
    ]);
    // Three slow round trips of the last five make it weak again.
    for (let i = 0; i < 3; i++) await beat(b.hub, { lastRoundTripMs: 4000 });
    expect((await beat(b.standby.device, { liveRole: 'standby' })).body.connectivity).toBe('weak');
  });

  it('refuses a client PC', async () => {
    const b = await branch();
    const response = await beat(b.client.device, { liveRole: 'client' });
    expect([response.status, response.body.code]).toEqual([403, 'DEVICE_NOT_HUB_CAPABLE']);
  });
});

describe('number blocks (rule 17)', () => {
  it('gives the hub the lowest free block and the standby the next, idempotently', async () => {
    const b = await branch();
    const request = async (device: TestDevice) => {
      const http = await device.device();
      return http.post('/api/sync/number-blocks').send({ series: 'order' });
    };
    const hub = await request(b.hub);
    expect(hub.status).toBe(200);
    expect(hub.body.series).toBe('order');
    expect(hub.body.blocks).toHaveLength(7);
    expect(hub.body.blocks.every((block: { first: number }) => block.first === 1)).toBe(true);
    expect(hub.body.blocks[0].last).toBe(4999);
    const dates = hub.body.blocks.map((block: { businessDate: string }) => block.businessDate);
    expect([...dates].sort()).toEqual(dates);
    expect((await request(b.hub)).body).toEqual(hub.body);
    const standby = await request(b.standby.device);
    expect(standby.body.blocks.map((block: { first: number }) => block.first)).toEqual(
      Array(7).fill(5001),
    );
    const client = await request(b.client.device);
    expect([client.status, client.body.code]).toEqual([403, 'DEVICE_NOT_HUB_CAPABLE']);
  });

  it('keeps the first block for the hub when the standby asks first', async () => {
    const b = await branch();
    const standby = await (await b.standby.device.device())
      .post('/api/sync/number-blocks')
      .send({ series: 'order' })
      .expect(200);
    expect(standby.body.blocks[0].first).toBe(5001);
    const hub = await (await b.hub.device())
      .post('/api/sync/number-blocks')
      .send({ series: 'order' })
      .expect(200);
    expect(hub.body.blocks[0].first).toBe(1);
  });
});

describe('the branch CA and PC certificates (rules 38, 39)', () => {
  it('makes the branch CA with its first PC and certifies each PC for its private addresses', async () => {
    const b = await branch();
    const authorities = await withTenant(db, b.tenantId, (tx) =>
      tx
        .select()
        .from(branchCertificateAuthorities)
        .where(eq(branchCertificateAuthorities.branchId, b.main)),
    );
    expect(authorities).toHaveLength(1);
    const authority = authorities[0] as (typeof authorities)[number];
    for (const pc of [b.hub, b.client.device]) {
      const response = await (await pc.device())
        .post('/api/sync/certificates')
        .send({ csr: await certificateRequest(), lanAddresses: ['192.168.1.20', '10.0.0.7'] });
      expect(response.status).toBe(201);
      expect(response.body.fingerprint).toBe(authority.fingerprintSha256);
      expect(response.body.caCertificate).toBe(authority.certificatePem);
      const certificate = new NodeCertificate(response.body.certificate);
      const ca = new NodeCertificate(authority.certificatePem);
      expect(certificate.checkIssued(ca) && certificate.verify(ca.publicKey)).toBe(true);
      expect(certificate.subject).toContain(`CN=${pc.deviceId}`);
      expect(certificate.subjectAltName).toBe('IP Address:192.168.1.20, IP Address:10.0.0.7');
    }
    const issued = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(deviceCertificates).where(eq(deviceCertificates.deviceId, b.hub.deviceId)),
    );
    expect(issued[0]).toMatchObject({
      branchId: b.main,
      lanAddresses: ['192.168.1.20', '10.0.0.7'],
    });
    const audited = await withTenant(db, b.tenantId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    const actions = audited.map((entry) => entry.action);
    expect(actions.filter((action) => action === 'branch_ca.created')).toHaveLength(1);
    expect(actions.filter((action) => action === 'device_certificate.issued')).toHaveLength(2);
  });

  it('refuses a public address and a request that is not a P-256 key’s', async () => {
    const b = await api.ownerOnDevice();
    const http = await b.device.device();
    const csr = await certificateRequest();
    const publicAddress = await http
      .post('/api/sync/certificates')
      .send({ csr, lanAddresses: ['192.168.1.20', '8.8.8.8'] });
    expect([publicAddress.status, publicAddress.body.code]).toEqual([
      400,
      'CERTIFICATE_ADDRESS_INVALID',
    ]);
    const rsa = await certificateRequest({
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    });
    const wrongKey = await http
      .post('/api/sync/certificates')
      .send({ csr: rsa, lanAddresses: ['192.168.1.20'] });
    expect([wrongKey.status, wrongKey.body.code]).toEqual([400, 'VALIDATION_FAILED']);
  });
});

describe('hub roles and the branch’s sync status (rule 38)', () => {
  it('starts with the first two PCs as hub and standby, and lets the owner swap them', async () => {
    const b = await branch();
    const status = await b.hub.as(b.owner).get(`/api/branches/${b.main}/sync-status`).expect(200);
    expect(status.body.branchId).toBe(b.main);
    expect(status.body.connectivity.state).toBe('offline');
    expect(
      status.body.pcs.map((pc: { deviceId: string; hubRole: string | null }) => [
        pc.deviceId,
        pc.hubRole,
      ]),
    ).toEqual([
      [b.hub.deviceId, 'hub'],
      [b.standby.device.deviceId, 'standby'],
      [b.client.device.deviceId, null],
    ]);
    const swapped = await b.hub
      .as(b.owner)
      .put(`/api/branches/${b.main}/hub-roles`)
      .send({ hubDeviceId: b.standby.device.deviceId, standbyDeviceId: b.hub.deviceId })
      .expect(200);
    expect(
      swapped.body.pcs.map((pc: { deviceId: string; hubRole: string | null }) => [
        pc.deviceId,
        pc.hubRole,
      ]),
    ).toEqual([
      [b.hub.deviceId, 'standby'],
      [b.standby.device.deviceId, 'hub'],
      [b.client.device.deviceId, null],
    ]);
    const audited = await withTenant(db, b.tenantId, (tx) =>
      tx
        .select({ details: auditEntries.details })
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.action, 'branch.hub_roles_changed'),
            eq(auditEntries.entityId, b.main),
          ),
        ),
    );
    expect(audited).toEqual([
      {
        details: {
          before: { hubDeviceId: b.hub.deviceId, standbyDeviceId: b.standby.device.deviceId },
          after: { hubDeviceId: b.standby.device.deviceId, standbyDeviceId: b.hub.deviceId },
        },
      },
    ]);
    // A client PC with no role is now refused on the hub-only routes; the new hub uploads.
    const command = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    await upload(b.standby.device, [uploaded(command)], 200);
  });

  it('refuses to leave the live hub without a role (HUB_ROLE_ACTIVE)', async () => {
    const b = await branch();
    await beat(b.hub, { liveRole: 'hub', hubEpoch: 1 });
    await beat(b.standby.device, { liveRole: 'standby', hubEpoch: 1 });
    const response = await b.hub
      .as(b.owner)
      .put(`/api/branches/${b.main}/hub-roles`)
      .send({ hubDeviceId: b.standby.device.deviceId, standbyDeviceId: b.client.device.deviceId });
    expect([response.status, response.body.code]).toEqual([409, 'HUB_ROLE_ACTIVE']);
    // Once the standby is promoted (a higher epoch), the old hub may lose its role.
    await beat(b.standby.device, { liveRole: 'hub', hubEpoch: 2 });
    await b.hub
      .as(b.owner)
      .put(`/api/branches/${b.main}/hub-roles`)
      .send({ hubDeviceId: b.standby.device.deviceId, standbyDeviceId: b.client.device.deviceId })
      .expect(200);
  });

  it('refuses unknown PCs, another branch’s PC, members without hub.manage and other tenants', async () => {
    const b = await branch();
    const east = await registerPc(api, b, b.east, 3);
    const roles = (body: object) =>
      b.hub.as(b.owner).put(`/api/branches/${b.main}/hub-roles`).send(body);
    for (const hubDeviceId of [uuidv7(), east.device.deviceId]) {
      const response = await roles({ hubDeviceId });
      expect([response.status, response.body.code]).toEqual([401, 'DEVICE_UNKNOWN']);
    }
    const same = await roles({ hubDeviceId: b.hub.deviceId, standbyDeviceId: b.hub.deviceId });
    expect([same.status, same.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const cashier = await b.hub.addMember(
      b.owner,
      {
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [b.main] },
      },
      pinFor(5),
    );
    const session = await b.hub.signIn(cashier.id, pinFor(5));
    const refused = await b.hub.as(session).get(`/api/branches/${b.main}/sync-status`);
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const put = await b.hub
      .as(session)
      .put(`/api/branches/${b.main}/hub-roles`)
      .send({ hubDeviceId: b.hub.deviceId });
    expect([put.status, put.body.code]).toEqual([403, 'FORBIDDEN']);
    // The standby's manager holds hub.manage in the main branch only.
    const manager = await b.hub.signIn(b.standby.manager.id, pinFor(1));
    const elsewhere = await b.hub.as(manager).get(`/api/branches/${b.east}/sync-status`);
    expect([elsewhere.status, elsewhere.body.code]).toEqual([403, 'FORBIDDEN']);
    const other = await api.ownerOnDevice();
    const foreign = await b.hub.as(b.owner).get(`/api/branches/${other.branchIds[0]}/sync-status`);
    expect([foreign.status, foreign.body.code]).toEqual([404, 'NOT_FOUND']);
    const anonymous = await api.http().get(`/api/branches/${b.main}/sync-status`);
    expect(anonymous.status).toBe(401);
  });
});
