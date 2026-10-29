import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { eventCatalog, exportManifestSchema } from '@vertex-food/contracts';
import {
  accounts,
  and,
  asc,
  auditEntries,
  branches,
  createDatabase,
  dataExportChunks,
  dataExports,
  type ExportDataset,
  eq,
  exportDatasets,
  files,
  outboxEvents,
  staffMemberships,
  tenantSlugs,
  tenants,
  withTenant,
} from '@vertex-food/db';
import type { Job } from 'pg-boss';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { OutboxJobData } from '../src/core/queue/queue-job.js';
import {
  DataExportBuildJob,
  type DataExportBuildSettings,
} from '../src/jobs/data-export/build.job.js';
import { DataExportExpireJob } from '../src/jobs/data-export/expire.job.js';
import { unzip } from './unzip.js';
import { startWorker } from './worker.js';

// Spec S06's export jobs: data-export.build, fed by data_export.requested.v1 through the outbox,
// writes one tenant's snapshot as a ZIP in chunks; data-export/expire deletes a ready file's chunks
// after 7 days. Synthetic tenants and requests written as the app role, as the API would.

const app = createDatabase(inject('appUrl'));
const jobsDb = createDatabase(inject('jobsUrl'));
let worker: INestApplication;

beforeAll(async () => {
  worker = await startWorker({ events: [DataExportBuildJob] });
});
afterAll(async () => {
  await worker.close();
  await app.$client.end();
  await jobsDb.$client.end();
});

/** Small chunks, so even a test tenant's file spans several. */
const job = (settings: Partial<DataExportBuildSettings> = {}) =>
  new DataExportBuildJob(jobsDb, { chunkBytes: 1024, ...settings });

let counter = 0;

async function seedTenant(label: string) {
  counter += 1;
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const accountId = uuidv7();
  const fileId = uuidv7();
  const phone = `+96393${String(Date.now() % 1_000_000).padStart(6, '0')}${counter % 10}`;
  const slug = `x-${tenantId.slice(-12)}`;
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: `مطعم ${label}`, defaultCurrency: 'USD' });
    await tx.insert(tenantSlugs).values({ slug, subjectTenantId: tenantId, isPrimary: true });
    await tx.insert(accounts).values({ id: accountId, phone, nameAr: `مالك ${label}` });
  });
  const png = Buffer.from(`synthetic logo ${label}`);
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(branches).values({
      id: branchId,
      tenantId,
      nameAr: `فرع ${label}`,
      code: 'main',
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD'],
    });
    await tx.insert(files).values({
      id: fileId,
      tenantId,
      purpose: 'logo',
      mediaType: 'image/png',
      bytes: png,
      byteSize: png.length,
      width: 512,
      height: 512,
      sha256: 'b'.repeat(64),
    });
    await tx.insert(staffMemberships).values({
      tenantId,
      accountId,
      roles: ['owner'],
      allBranches: true,
      displayName: `مالك ${label}`,
    });
  });
  await app.update(tenants).set({ logoFileId: fileId }).where(eq(tenants.id, tenantId));
  return { tenantId, branchId, accountId, fileId, phone, slug, png };
}

/** The owner's request, as the API writes it: the row, and optionally its outbox event. */
async function request(tenant: { tenantId: string; accountId: string }, withEvent = false) {
  const exportId = uuidv7();
  await withTenant(app, tenant.tenantId, async (tx) => {
    await tx.insert(dataExports).values({
      id: exportId,
      tenantId: tenant.tenantId,
      requestedBy: tenant.accountId,
      requestedAt: new Date(),
    });
    if (withEvent) {
      await tx.insert(outboxEvents).values({
        tenantId: tenant.tenantId,
        type: 'data_export.requested.v1',
        payload: eventCatalog['data_export.requested.v1'].parse({
          tenantId: tenant.tenantId,
          exportId,
        }),
      });
    }
  });
  return exportId;
}

/** The export's row, chunks, file and audit entries, read as the app role reads them. */
const read = (tenantId: string, exportId: string) =>
  withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(dataExports).where(eq(dataExports.id, exportId));
    const chunks = await tx
      .select({ seq: dataExportChunks.seq, bytes: dataExportChunks.bytes })
      .from(dataExportChunks)
      .where(eq(dataExportChunks.exportId, exportId))
      .orderBy(asc(dataExportChunks.seq));
    const audited = await tx
      .select({
        action: auditEntries.action,
        actorKind: auditEntries.actorKind,
        actorName: auditEntries.actorName,
        details: auditEntries.details,
      })
      .from(auditEntries)
      .where(and(eq(auditEntries.entityType, 'data_export'), eq(auditEntries.entityId, exportId)))
      .orderBy(asc(auditEntries.occurredAt));
    return { row, chunks, file: Buffer.concat(chunks.map((chunk) => chunk.bytes)), audited };
  });

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A CSV's data rows as cells (no quoted line breaks in these tests). */
const csvRows = (bytes: Buffer) =>
  bytes
    .toString('utf8')
    .replace(/^﻿/, '')
    .split('\r\n')
    .filter((line) => line !== '')
    .slice(1);

/** A pg-boss job of the event, as the queue hands it over. */
const outboxJob = (tenantId: string, exportId: string) =>
  ({
    id: uuidv7(),
    name: 'data-export.build',
    data: {
      tenantId,
      type: 'data_export.requested.v1',
      payload: { tenantId, exportId },
    },
    retryCount: 0,
  }) as unknown as Job<OutboxJobData>;

describe('data-export.build (rules 10–12, 15)', () => {
  it('builds the ZIP from the outbox event: every file, the manifest’s hashes, nothing of another tenant', async () => {
    const a = await seedTenant('أ');
    const b = await seedTenant('ب');
    const exportId = await request(a, true);
    await vi.waitFor(
      async () => expect((await read(a.tenantId, exportId)).row?.status).toBe('ready'),
      { timeout: 20_000, interval: 250 },
    );
    const { row, chunks, file, audited } = await read(a.tenantId, exportId);
    if (!row?.asOf || !row.finishedAt) throw new Error('not built');

    // Chunks of 1 MiB but the last, from 0, adding up to the file and its hash.
    expect(chunks.map((chunk) => chunk.seq)).toEqual(chunks.map((_, index) => index));
    expect(chunks.slice(0, -1).every((chunk) => chunk.bytes.length === 1024 ** 2)).toBe(true);
    expect(row.byteSize).toBe(file.length);
    expect(row.sha256).toBe(sha(file));
    expect(row.fileName).toMatch(new RegExp(`^vertex-food-${a.slug}-\\d{8}-\\d{4}\\.zip$`));
    expect(row.expiresAt?.getTime()).toBe(row.finishedAt.getTime() + 7 * 86_400_000);
    expect(row.startedAt?.getTime()).toBeLessThanOrEqual(row.asOf.getTime() + 1);

    const entries = unzip(file);
    const byPath = new Map(entries.map((entry) => [entry.path, entry.bytes]));
    expect(entries.map((entry) => entry.path)).toEqual([
      'README.txt',
      'columns.csv',
      ...exportDatasets.flatMap((dataset) =>
        dataset.stem === 'restaurant'
          ? ['restaurant.csv', `files/${a.fileId}.png`]
          : [`${dataset.stem}.csv`],
      ),
      'manifest.json',
    ]);
    expect(byPath.get(`files/${a.fileId}.png`)?.equals(a.png)).toBe(true);

    const manifest = exportManifestSchema.parse(
      JSON.parse(byPath.get('manifest.json')?.toString('utf8') ?? ''),
    );
    expect(manifest).toMatchObject({
      formatVersion: 1,
      tenantId: a.tenantId,
      slug: a.slug,
      asOf: row.asOf.toISOString(),
    });
    expect(manifest.files.map((entry) => entry.path)).toEqual(
      entries.map((entry) => entry.path).filter((path) => path !== 'manifest.json'),
    );
    for (const entry of manifest.files) {
      const bytes = byPath.get(entry.path);
      if (!bytes) throw new Error(entry.path);
      expect(entry.sha256, entry.path).toBe(sha(bytes));
      if (entry.path.endsWith('.csv') && entry.path !== 'columns.csv') {
        expect(entry.rows, entry.path).toBe(csvRows(bytes).length);
        expect((row.rowCounts as Record<string, number>)[entry.path], entry.path).toBe(entry.rows);
      } else {
        expect(entry.rows, entry.path).toBeNull();
      }
    }

    // The files agree with the database: the restaurant, its branch, its owner with the phone.
    const text = (path: string) => byPath.get(path)?.toString('utf8') ?? '';
    expect(csvRows(byPath.get('restaurant.csv') ?? Buffer.alloc(0))).toHaveLength(1);
    expect(text('restaurant.csv')).toContain(a.tenantId);
    expect(csvRows(byPath.get('branches.csv') ?? Buffer.alloc(0))).toHaveLength(1);
    expect(text('branches.csv')).toContain(a.branchId);
    expect(text('staff.csv')).toContain(a.phone);
    expect(text('README.txt')).toMatch(/^﻿تصدير بيانات المطعم/);
    expect(text('columns.csv')).toContain('staff.csv,phone,');
    // Every file is UTF-8 with a byte-order mark (Excel, Notepad).
    for (const entry of entries) {
      if (/\.(csv|txt)$/.test(entry.path))
        expect(entry.bytes.subarray(0, 3).toString('hex')).toBe('efbbbf');
    }

    // Nothing of the other tenant anywhere in the file.
    const all = entries.map((entry) => entry.bytes.toString('latin1')).join('\n');
    const allUtf8 = entries.map((entry) => entry.bytes.toString('utf8')).join('\n');
    for (const value of [b.tenantId, b.branchId, b.accountId, b.fileId, b.phone, b.slug]) {
      expect(all).not.toContain(value);
    }
    expect(allUtf8).not.toContain('مطعم ب');

    expect(audited).toEqual([
      {
        action: 'data_export.completed',
        actorKind: 'system',
        actorName: 'data-export/build',
        details: { byteSize: file.length, rowCounts: row.rowCounts },
      },
    ]);
  });

  it('reads one snapshot: a row committed during the build is not in the file', async () => {
    const a = await seedTenant('ج');
    const exportId = await request(a);
    const lateBranch = uuidv7();
    // A dataset read first that commits a new branch from another connection meanwhile.
    const writer: ExportDataset = {
      stem: 'restaurant',
      tables: [],
      reads: [],
      columns: [{ name: 'id', kind: 'text' }],
      async *rows() {
        await withTenant(app, a.tenantId, async (tx) => {
          await tx.insert(branches).values({
            id: lateBranch,
            tenantId: a.tenantId,
            nameAr: 'فرع جديد',
            code: 'late',
            defaultCurrency: 'USD',
            acceptedCurrencies: ['USD'],
          });
        });
        yield { id: a.tenantId };
      },
    };
    const branchesDataset = exportDatasets.find((dataset) => dataset.stem === 'branches');
    if (!branchesDataset) throw new Error('branches');
    expect(await job({ datasets: [writer, branchesDataset] }).build(a.tenantId, exportId)).toBe(
      'ready',
    );
    const { row, file } = await read(a.tenantId, exportId);
    const entries = new Map(unzip(file).map((entry) => [entry.path, entry.bytes]));
    const csv = entries.get('branches.csv')?.toString('utf8') ?? '';
    expect(csv).toContain(a.branchId);
    expect(csv).not.toContain(lateBranch);
    expect(row?.rowCounts).toEqual({ 'restaurant.csv': 1, 'branches.csv': 1 });
  });

  it('skips an export already ready on a second run', async () => {
    const a = await seedTenant('د');
    const exportId = await request(a);
    const build = job();
    expect(await build.build(a.tenantId, exportId)).toBe('ready');
    const first = await read(a.tenantId, exportId);
    await build.work([outboxJob(a.tenantId, exportId)]);
    expect(await build.build(a.tenantId, exportId)).toBeNull();
    const second = await read(a.tenantId, exportId);
    expect(second.row).toEqual(first.row);
    expect(second.file.equals(first.file)).toBe(true);
    expect(second.audited).toHaveLength(1);
  });

  it('rebuilds an export left running by a crash, with a new as_of and no earlier chunk', async () => {
    const a = await seedTenant('ه');
    const exportId = await request(a);
    // The crashed attempt: running since a minute ago, two chunks written.
    const crashedAt = new Date(Date.now() - 60_000);
    await withTenant(jobsDb, a.tenantId, async (tx) => {
      await tx
        .update(dataExports)
        .set({ status: 'running', startedAt: crashedAt, updatedAt: crashedAt })
        .where(eq(dataExports.id, exportId));
      await tx.insert(dataExportChunks).values(
        [0, 1].map((seq) => ({
          tenantId: a.tenantId,
          exportId,
          seq,
          bytes: Buffer.from('half a zip'),
        })),
      );
    });
    expect(await job().build(a.tenantId, exportId)).toBe('ready');
    const { row, file } = await read(a.tenantId, exportId);
    expect(row?.startedAt?.getTime()).toBeGreaterThan(crashedAt.getTime());
    expect(row?.asOf?.getTime()).toBeGreaterThan(crashedAt.getTime());
    expect(row?.sha256).toBe(sha(file));
    expect(unzip(file).at(-1)?.path).toBe('manifest.json');
  });

  it('stops an attempt another one took over, writing nothing more', async () => {
    const a = await seedTenant('و');
    const exportId = await request(a);
    const takeover = new Date(Date.now() + 1000);
    const takenOver: ExportDataset = {
      stem: 'restaurant',
      tables: [],
      reads: [],
      columns: [{ name: 'id', kind: 'text' }],
      async *rows() {
        // A retry claimed the export meanwhile.
        await withTenant(jobsDb, a.tenantId, (tx) =>
          tx
            .update(dataExports)
            .set({ startedAt: takeover, updatedAt: takeover })
            .where(eq(dataExports.id, exportId)),
        );
        for (let index = 0; index < 5000; index += 1) yield { id: uuidv7() };
      },
    };
    expect(await job({ datasets: [takenOver] }).build(a.tenantId, exportId)).toBeNull();
    const { row, chunks, audited } = await read(a.tenantId, exportId);
    expect(row).toMatchObject({ status: 'running', startedAt: takeover });
    expect(chunks).toEqual([]);
    expect(audited).toEqual([]);
  });

  it('fails a file past the size cap as too_large, with no chunk left', async () => {
    const a = await seedTenant('ز');
    const exportId = await request(a);
    expect(await job({ maxBytes: 2000 }).build(a.tenantId, exportId)).toBe('failed');
    const { row, chunks, audited } = await read(a.tenantId, exportId);
    expect(row).toMatchObject({ status: 'failed', failure: 'too_large', byteSize: null });
    expect(row?.finishedAt).not.toBeNull();
    expect(chunks).toEqual([]);
    expect(audited).toEqual([
      {
        action: 'data_export.failed',
        actorKind: 'system',
        actorName: 'data-export/build',
        details: { failure: 'too_large' },
      },
    ]);
  });

  it('fails a build past the time cap as timed_out, with no chunk left', async () => {
    const a = await seedTenant('ح');
    const exportId = await request(a);
    expect(await job({ maxBuildMs: -1 }).build(a.tenantId, exportId)).toBe('failed');
    const { row, chunks, audited } = await read(a.tenantId, exportId);
    expect(row).toMatchObject({ status: 'failed', failure: 'timed_out' });
    expect(chunks).toEqual([]);
    expect(audited.map((entry) => entry.details)).toEqual([{ failure: 'timed_out' }]);
  });

  it('lets another error be retried, and fails with server_error once every attempt failed', async () => {
    const a = await seedTenant('ط');
    const exportId = await request(a);
    const broken: ExportDataset = {
      stem: 'restaurant',
      tables: [],
      reads: [],
      columns: [{ name: 'id', kind: 'text' }],
      // biome-ignore lint/correctness/useYield: a dataset that fails before its first row.
      async *rows() {
        throw new Error('the database went away');
      },
    };
    const build = job({ datasets: [broken] });
    await expect(build.work([outboxJob(a.tenantId, exportId)])).rejects.toThrow(
      'the database went away',
    );
    expect((await read(a.tenantId, exportId)).row?.status).toBe('running');
    // pg-boss hands the job to the dead-letter queue after the third attempt; twice is once.
    await build.failed([outboxJob(a.tenantId, exportId)]);
    await build.failed([outboxJob(a.tenantId, exportId)]);
    const { row, chunks, audited } = await read(a.tenantId, exportId);
    expect(row).toMatchObject({ status: 'failed', failure: 'server_error' });
    expect(chunks).toEqual([]);
    expect(audited.map((entry) => entry.details)).toEqual([{ failure: 'server_error' }]);
  });

  it('retries three times with backoff, past the 30-minute cap, with a heartbeat', () => {
    expect(job().options).toEqual({
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 35 * 60,
      heartbeatSeconds: 30,
    });
  });
});

describe('data-export/expire (rule 14)', () => {
  it('expires a ready export after 7 days once: chunks deleted, one audit entry, the row kept', async () => {
    const a = await seedTenant('ي');
    const exportId = await request(a);
    expect(await job().build(a.tenantId, exportId)).toBe('ready');
    const expire = new DataExportExpireJob(jobsDb);
    expect(expire.cron).toBe('0 * * * *');
    const built = await read(a.tenantId, exportId);
    if (!built.row?.expiresAt) throw new Error('not built');

    // Not yet due.
    await expire.run(new Date(built.row.expiresAt.getTime() - 1000));
    expect((await read(a.tenantId, exportId)).row?.status).toBe('ready');

    const due = new Date(built.row.expiresAt.getTime() + 1000);
    expect(await expire.run(due)).toBeGreaterThanOrEqual(1);
    await expire.run(due);
    const { row, chunks, audited } = await read(a.tenantId, exportId);
    expect(row).toMatchObject({ status: 'expired', sha256: built.row.sha256 });
    expect(chunks).toEqual([]);
    expect(audited.map((entry) => [entry.action, entry.actorName])).toEqual([
      ['data_export.completed', 'data-export/build'],
      ['data_export.expired', 'data-export/expire'],
    ]);
  });
});
