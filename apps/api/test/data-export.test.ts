import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type DataExport, damascusDay, dataExportPolicy } from '@vertex-food/contracts';
import {
  auditEntries,
  createDatabase,
  dataExportChunks,
  dataExportLinks,
  dataExports,
  outboxEvents,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp, TEST_IDENTITY_ENV } from './app.js';
import { client, OPERATOR, ORIGIN, PASSWORD, pinFor, TestApi } from './staff.js';

// Spec S06's data export over the API: the owner's request (re-auth, one active, 3 a Damascus day,
// row, audit and event together), the history, links (10 minutes, audited, a ready export only),
// and the public file route (whole file or one range, `NOT_FOUND` alike for every dead link, the
// token in no log, a limit per address). The worker's build is stood in for by the owner
// connection, which moves an export and writes its chunks as `data-export.build` does.

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));
const owner = createDatabase(inject('ownerUrl'));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
  await owner.$client.end();
});

type Setup = Awaited<ReturnType<TestApi['ownerOnDevice']>>;

/** The owner's session of `ownerOnDevice` entered its password at registration: re-auth holds. */
const as = (setup: Setup) => setup.device.as(setup.owner);

async function request(setup: Setup): Promise<DataExport> {
  const response = await as(setup).post('/api/tenant/data-exports').expect(201);
  return response.body as DataExport;
}

/** What `data-export.build` leaves: the file's chunks and the export `ready` (rules 10, 14). */
async function markReady(tenantId: string, exportId: string, file: Buffer) {
  await withTenant(owner, tenantId, async (tx) => {
    const startedAt = new Date();
    await tx
      .update(dataExports)
      .set({ status: 'running', startedAt })
      .where(eq(dataExports.id, exportId));
    for (let seq = 0; seq * dataExportPolicy.chunkBytes < file.length; seq += 1) {
      const start = seq * dataExportPolicy.chunkBytes;
      await tx.insert(dataExportChunks).values({
        tenantId,
        exportId,
        seq,
        bytes: file.subarray(start, start + dataExportPolicy.chunkBytes),
      });
    }
    const finishedAt = new Date();
    await tx
      .update(dataExports)
      .set({
        status: 'ready',
        asOf: startedAt,
        finishedAt,
        expiresAt: new Date(finishedAt.getTime() + 7 * 86_400_000),
        fileName: 'vertex-food-test-20261029-1405.zip',
        byteSize: file.length,
        sha256: createHash('sha256').update(file).digest('hex'),
        rowCounts: { 'staff.csv': 1 },
      })
      .where(eq(dataExports.id, exportId));
  });
}

async function markFailed(tenantId: string, exportId: string) {
  await withTenant(owner, tenantId, (tx) =>
    tx
      .update(dataExports)
      .set({ status: 'failed', failure: 'too_large', finishedAt: new Date() })
      .where(eq(dataExports.id, exportId)),
  );
}

/** What `data-export/expire` does (rule 14). */
async function markExpired(tenantId: string, exportId: string) {
  await withTenant(owner, tenantId, async (tx) => {
    await tx.delete(dataExportChunks).where(eq(dataExportChunks.exportId, exportId));
    await tx.update(dataExports).set({ status: 'expired' }).where(eq(dataExports.id, exportId));
  });
}

/** A ready export of a fresh tenant, of `size` random bytes (over two chunks by default). */
async function readyExport(size = 2 * dataExportPolicy.chunkBytes + 1234) {
  const setup = await api.ownerOnDevice();
  const requested = await request(setup);
  const file = randomBytes(size);
  await markReady(setup.tenantId, requested.id, file);
  return { setup, exportId: requested.id, file };
}

async function link(setup: Setup, exportId: string): Promise<string> {
  const response = await as(setup).post(`/api/tenant/data-exports/${exportId}/link`).expect(201);
  return response.body.url as string;
}

/** Answers a download with its body as bytes. */
function download(path: string, range?: string) {
  const test = client(app)
    .get(path)
    .buffer(true)
    .parse((response, done) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => done(null, Buffer.concat(parts)));
    });
  return range ? test.set('range', range) : test;
}

describe('requesting an export (rules 6–9)', () => {
  it('queues one with its audit entry and event, after a password entered in 5 minutes', async () => {
    const setup = await api.ownerOnDevice();
    const requested = await request(setup);
    expect(requested).toMatchObject({
      status: 'queued',
      formatVersion: 1,
      requestedBy: { name: 'مالك تجريبي' },
      asOf: null,
      fileName: null,
    });
    const [entry] = await withTenant(db, setup.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'data_export.requested')),
    );
    expect(entry).toMatchObject({ entityId: requested.id, actorKind: 'staff', branchId: null });
    const [event] = await withTenant(db, setup.tenantId, (tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.type, 'data_export.requested.v1')),
    );
    expect(event?.payload).toEqual({ tenantId: setup.tenantId, exportId: requested.id });

    // A PIN session has entered no password.
    const pinSession = await setup.device.signIn(setup.ownerMembershipId, pinFor(0));
    const refused = await setup.device.as(pinSession).post('/api/tenant/data-exports');
    expect([refused.status, refused.body.code]).toEqual([403, 'REAUTH_REQUIRED']);
    await setup.device
      .as(pinSession)
      .post('/api/sessions/current/reauth')
      .send({ password: PASSWORD })
      .expect(204);
    // One active export per tenant (rule 7): the second owner's request names it.
    const second = await setup.device.as(pinSession).post('/api/tenant/data-exports');
    expect([second.status, second.body.code, second.body.details]).toEqual([
      409,
      'EXPORT_IN_PROGRESS',
      { exportId: requested.id },
    ]);
  });

  it('lets one of two requests at once in, and names it to the other (edge case 7)', async () => {
    const setup = await api.ownerOnDevice();
    const [a, b] = await Promise.all([
      as(setup).post('/api/tenant/data-exports'),
      as(setup).post('/api/tenant/data-exports'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const created = a.status === 201 ? a : b;
    const refused = a.status === 201 ? b : a;
    expect(refused.body).toMatchObject({
      code: 'EXPORT_IN_PROGRESS',
      details: { exportId: created.body.id },
    });
  });

  it('allows 3 a Damascus day, failed ones not counted (rule 8, edge case 6)', async () => {
    const setup = await api.ownerOnDevice();
    // Three exports of yesterday, the last a minute before Damascus midnight, count for nothing.
    const { start, end } = damascusDay(new Date());
    await withTenant(owner, setup.tenantId, async (tx) => {
      for (const minutes of [600, 300, 1]) {
        const [row] = await tx
          .insert(dataExports)
          .values({
            tenantId: setup.tenantId,
            requestedBy: await api.accountId(setup.ownerPhone),
            requestedAt: new Date(start.getTime() - minutes * 60_000),
          })
          .returning({ id: dataExports.id });
        await tx
          .update(dataExports)
          .set({ status: 'failed', failure: 'server_error', finishedAt: new Date() })
          .where(eq(dataExports.id, row?.id as string));
      }
    });
    const first = await request(setup);
    await markFailed(setup.tenantId, first.id);
    for (let index = 0; index < 3; index += 1) {
      const next = await request(setup);
      await markReady(setup.tenantId, next.id, randomBytes(10));
    }
    const page = await as(setup).get('/api/tenant/data-exports').expect(200);
    expect(page.body).toMatchObject({ remainingToday: 0, nextAllowedAt: end.toISOString() });
    const fourth = await as(setup).post('/api/tenant/data-exports');
    expect([fourth.status, fourth.body.code, fourth.body.details]).toEqual([
      429,
      'EXPORT_LIMIT_REACHED',
      { nextAllowedAt: end.toISOString() },
    ]);
  });

  it('is the owner’s alone, and passes while the tenant is suspended or closed', async () => {
    const setup = await api.ownerOnDevice();
    const manager = await setup.device.addMember(
      setup.owner,
      {
        displayName: 'مدير',
        roles: ['manager'],
        branchScope: { allBranches: true },
      },
      pinFor(2),
    );
    const session = await setup.device.signIn(manager.id, pinFor(2));
    for (const [method, path] of [
      ['post', '/api/tenant/data-exports'],
      ['get', '/api/tenant/data-exports'],
    ] as const) {
      const refused = await setup.device.as(session)[method](path);
      expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    }
    const anonymous = await client(app).get('/api/tenant/data-exports');
    expect(anonymous.status).toBe(401);

    await owner
      .update(tenants)
      .set({
        status: 'suspended',
        statusReason: 'non_payment',
        onboardingCompletedAt: new Date(),
        activatedAt: new Date(),
      })
      .where(eq(tenants.id, setup.tenantId));
    const requested = await request(setup);
    await markReady(setup.tenantId, requested.id, randomBytes(10));
    await link(setup, requested.id);

    // Closed: the owner keeps a personal session for 90 days, and the export (S01 rule 9).
    await app
      .get(TenancyService)
      .changeStatus(OPERATOR, setup.tenantId, { to: 'closed', reason: 'other' });
    const { ticket } = await api.signInWithOtp(setup.ownerPhone, 'personal');
    const opened = await api
      .http()
      .post('/api/auth/personal-session')
      .set('x-sign-in-ticket', ticket)
      .send({ tenantId: setup.tenantId })
      .expect(200);
    const cookie = (opened.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('__Secure-vf-session='))
      ?.split(';')[0] as string;
    const personal = (method: 'get' | 'post', path: string) =>
      client(app)[method](path).set('cookie', cookie).set('origin', ORIGIN);
    const list = await personal('get', '/api/tenant/data-exports').expect(200);
    expect(list.body.items.map((item: DataExport) => item.id)).toEqual([requested.id]);
    await personal('post', `/api/tenant/data-exports/${requested.id}/link`).expect(201);
  });
});

describe('the history and an export (rule 8)', () => {
  it('lists the tenant’s exports newest first with the allowance, never another tenant’s', async () => {
    const { setup, exportId } = await readyExport(10);
    const second = await request(setup);
    const page = await as(setup).get('/api/tenant/data-exports').expect(200);
    expect(page.body.items.map((item: DataExport) => item.id)).toEqual([second.id, exportId]);
    expect(page.body).toMatchObject({ nextBefore: null, remainingToday: 1, nextAllowedAt: null });
    expect(page.body.items[1]).toMatchObject({
      status: 'ready',
      byteSize: 10,
      rowCounts: { 'staff.csv': 1 },
    });
    const older = await as(setup).get(`/api/tenant/data-exports?before=${second.id}`).expect(200);
    expect(older.body.items.map((item: DataExport) => item.id)).toEqual([exportId]);
    await as(setup).get(`/api/tenant/data-exports/${exportId}`).expect(200);

    const other = await api.ownerOnDevice();
    const foreign = await as(other).get(`/api/tenant/data-exports/${exportId}`);
    expect([foreign.status, foreign.body.code]).toEqual([404, 'NOT_FOUND']);
    const otherList = await as(other).get('/api/tenant/data-exports').expect(200);
    expect(otherList.body.items).toEqual([]);
  });
});

describe('download links (rule 16)', () => {
  it('links a ready export for 10 minutes, audited, and nothing else', async () => {
    const setup = await api.ownerOnDevice();
    const requested = await request(setup);
    const early = await as(setup).post(`/api/tenant/data-exports/${requested.id}/link`);
    expect([early.status, early.body.code]).toEqual([409, 'EXPORT_NOT_READY']);
    await markReady(setup.tenantId, requested.id, randomBytes(10));
    const response = await as(setup)
      .post(`/api/tenant/data-exports/${requested.id}/link`)
      .expect(201);
    const { url, expiresAt } = response.body as { url: string; expiresAt: string };
    expect(url).toMatch(/^\/api\/data-exports\/files\/[A-Za-z0-9_-]{43}$/);
    const token = url.split('/').at(-1) as string;
    const [stored] = await withTenant(db, setup.tenantId, (tx) =>
      tx.select().from(dataExportLinks).where(eq(dataExportLinks.exportId, requested.id)),
    );
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toContain(token);
    expect(Date.parse(expiresAt) - (stored?.createdAt.getTime() ?? 0)).toBe(600_000);
    const entries = await withTenant(db, setup.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'data_export.downloaded')),
    );
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(token);

    // Another tenant's owner links nothing; a failed or expired export is not found.
    const other = await api.ownerOnDevice();
    const foreign = await as(other).post(`/api/tenant/data-exports/${requested.id}/link`);
    expect([foreign.status, foreign.body.code]).toEqual([404, 'NOT_FOUND']);
    await markExpired(setup.tenantId, requested.id);
    const expired = await as(setup).post(`/api/tenant/data-exports/${requested.id}/link`);
    expect([expired.status, expired.body.code]).toEqual([404, 'NOT_FOUND']);
    const failed = await request(setup);
    await markFailed(setup.tenantId, failed.id);
    const failedLink = await as(setup).post(`/api/tenant/data-exports/${failed.id}/link`);
    expect([failedLink.status, failedLink.body.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('the file route (rule 17)', () => {
  it('serves the whole file and any one range across chunks', async () => {
    const { setup, exportId, file } = await readyExport();
    const path = await link(setup, exportId);
    const sha256 = createHash('sha256').update(file).digest('hex');

    const whole = await download(path).expect(200);
    expect(Buffer.compare(whole.body as Buffer, file)).toBe(0);
    expect(whole.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="vertex-food-test-20261029-1405.zip"',
      'content-length': String(file.length),
      'accept-ranges': 'bytes',
      etag: `"${sha256}"`,
      'cache-control': 'no-store',
    });

    const start = dataExportPolicy.chunkBytes - 10;
    const end = 2 * dataExportPolicy.chunkBytes + 5;
    const part = await download(path, `bytes=${start}-${end}`).expect(206);
    expect(Buffer.compare(part.body as Buffer, file.subarray(start, end + 1))).toBe(0);
    expect(part.headers['content-range']).toBe(`bytes ${start}-${end}/${file.length}`);
    expect(part.headers['content-length']).toBe(String(end - start + 1));

    const tail = await download(path, 'bytes=-100').expect(206);
    expect(Buffer.compare(tail.body as Buffer, file.subarray(file.length - 100))).toBe(0);
    const resumed = await download(path, `bytes=${file.length - 7}-`).expect(206);
    expect((resumed.body as Buffer).length).toBe(7);

    const bad = await download(path, `bytes=${file.length}-`).expect(416);
    expect(bad.headers['content-range']).toBe(`bytes */${file.length}`);
  });

  it('answers the same NOT_FOUND for an unknown, expired or dead link, never logging the token', async () => {
    const { setup, exportId } = await readyExport(100);
    const written: string[] = [];
    const capture = (stream: NodeJS.WriteStream) =>
      vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    const spies = [capture(process.stdout), capture(process.stderr)];
    try {
      const unknown = await client(app)
        .get(`/api/data-exports/files/${randomBytes(32).toString('base64url')}`)
        .expect(404);
      expect(unknown.body.code).toBe('NOT_FOUND');

      // A link created half an hour ago (the test's clock runs ahead of the database's) is past
      // its 10 minutes.
      const token = randomBytes(32).toString('base64url');
      const createdAt = new Date(Date.now() - 30 * 60_000);
      await withTenant(owner, setup.tenantId, (tx) =>
        tx.insert(dataExportLinks).values({
          tenantId: setup.tenantId,
          exportId,
          createdBy: setup.ownerMembershipId,
          tokenHash: createHmac(
            'sha256',
            Buffer.from(TEST_IDENTITY_ENV.IDENTITY_HASH_KEY, 'base64'),
          )
            .update(`data-export.link\n${token}`)
            .digest('hex'),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 600_000),
        }),
      );
      const late = await client(app).get(`/api/data-exports/files/${token}`).expect(404);
      expect(late.body).toEqual(unknown.body);

      // The export expires while the link lives (edge case 13).
      const live = await link(setup, exportId);
      await download(live).expect(200);
      await markExpired(setup.tenantId, exportId);
      const gone = await client(app).get(live).expect(404);
      expect(gone.body).toEqual(unknown.body);

      const malformed = await client(app).get('/api/data-exports/files/short');
      expect(malformed.body.code).toBe('VALIDATION_FAILED');
      expect(written.join('')).not.toContain(token);
      expect(written.join('')).not.toContain(live.split('/').at(-1) as string);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('limits the reads of one address', async () => {
    const http = client(app);
    const path = `/api/data-exports/files/${randomBytes(32).toString('base64url')}`;
    for (let index = 0; index < 120; index += 1) await http.get(path).expect(404);
    const limited = await http.get(path);
    expect([limited.status, limited.body.code]).toEqual([429, 'RATE_LIMITED']);
  });
});
