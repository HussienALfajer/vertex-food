import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  branches,
  dataExportChunks,
  dataExportLinks,
  dataExports,
  tenantSlugs,
  tenants,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S06 in the database: the export's states and its one active row per tenant, the links
// found by their hash alone, the chunks only the jobs role deletes, and the audit entries' branch.

const { owner, app, jobs } = connect();
const GUARD = /data_exports: /;
const DENIED = /permission denied for table/;
const FK_REFUSAL = /violates foreign key constraint/;

async function seedTenant() {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
  });
  await withTenant(app, tenantId, (tx) =>
    tx.insert(branches).values({
      id: branchId,
      tenantId,
      nameAr: 'الفرع الرئيسي',
      code: 'main',
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD'],
    }),
  );
  return { tenantId, branchId };
}

async function requestExport(tenantId: string) {
  const id = uuidv7();
  await withTenant(app, tenantId, (tx) =>
    tx.insert(dataExports).values({ id, tenantId, requestedBy: uuidv7(), requestedAt: new Date() }),
  );
  return id;
}

/** The job's moves, as the jobs role inside the tenant. */
function asJob<T>(tenantId: string, work: Parameters<typeof withTenant<T>>[2]) {
  return withTenant(jobs, tenantId, work);
}

const ready = (finishedAt: Date) => ({
  status: 'ready',
  asOf: finishedAt,
  finishedAt,
  expiresAt: new Date(finishedAt.getTime() + 7 * 86_400_000),
  fileName: 'vertex-food-test-20261029-1405.zip',
  byteSize: 3,
  sha256: 'a'.repeat(64),
  rowCounts: { 'staff.csv': 1 },
});

describe('data_exports', () => {
  it('keeps one active export per tenant, and lets the next in once it ends', async () => {
    const { tenantId } = await seedTenant();
    const first = await requestExport(tenantId);
    expect(await refusal(requestExport(tenantId))).toMatch(/data_exports_one_active_idx/);
    // Another tenant is not held back.
    await requestExport((await seedTenant()).tenantId);
    await asJob(tenantId, (tx) =>
      tx
        .update(dataExports)
        .set({ status: 'failed', failure: 'server_error', finishedAt: new Date() })
        .where(eq(dataExports.id, first)),
    );
    await requestExport(tenantId);
  });

  it('moves only through its state table, as the jobs role', async () => {
    const { tenantId } = await seedTenant();
    const id = await requestExport(tenantId);
    const move = (values: Record<string, unknown>) =>
      asJob(tenantId, (tx) => tx.update(dataExports).set(values).where(eq(dataExports.id, id)));
    expect(await refusal(move({ ...ready(new Date()), startedAt: new Date() }))).toMatch(GUARD);
    await move({ status: 'running', startedAt: new Date() });
    // A ready row carries its whole file, and expires exactly 7 days after it finished.
    expect(await refusal(move({ status: 'ready' }))).toMatch(/violates check constraint/);
    const finishedAt = new Date();
    expect(
      await refusal(move({ ...ready(finishedAt), expiresAt: new Date(finishedAt.getTime() + 1) })),
    ).toMatch(/data_exports_expires_at/);
    await move(ready(finishedAt));
    expect(await refusal(move({ byteSize: 4 }))).toMatch(GUARD);
    expect(await refusal(move({ status: 'running' }))).toMatch(GUARD);
    await move({ status: 'expired' });
    expect(await refusal(move({ status: 'ready' }))).toMatch(GUARD);
    expect(await refusal(move({ requestedBy: uuidv7() }))).toMatch(DENIED);
  });

  it('is created queued by the app role, which never moves or deletes it', async () => {
    const { tenantId } = await seedTenant();
    expect(
      await refusal(
        withTenant(app, tenantId, (tx) =>
          tx.insert(dataExports).values({
            tenantId,
            requestedBy: uuidv7(),
            requestedAt: new Date(),
            status: 'running',
            startedAt: new Date(),
          }),
        ),
      ),
    ).toMatch(GUARD);
    const id = await requestExport(tenantId);
    expect(
      await refusal(
        withTenant(app, tenantId, (tx) =>
          tx.update(dataExports).set({ status: 'running' }).where(eq(dataExports.id, id)),
        ),
      ),
    ).toMatch(DENIED);
    expect(
      await refusal(
        withTenant(owner, tenantId, (tx) => tx.delete(dataExports).where(eq(dataExports.id, id))),
      ),
    ).toMatch(/refuse|not allowed|append-only/i);
  });

  it('shows the jobs role the ready exports of every tenant, and nothing else outside one', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const queued = await requestExport(a.tenantId);
    const done = await requestExport(b.tenantId);
    await asJob(b.tenantId, async (tx) => {
      await tx
        .update(dataExports)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(dataExports.id, done));
      await tx.update(dataExports).set(ready(new Date())).where(eq(dataExports.id, done));
    });
    const seen = (await jobs.select({ id: dataExports.id }).from(dataExports)).map((r) => r.id);
    expect(seen).toContain(done);
    expect(seen).not.toContain(queued);
    expect(await app.select().from(dataExports)).toEqual([]);
  });
});

describe('data_export_chunks', () => {
  it('are written and deleted by the jobs role only, never updated, and read by the app', async () => {
    const { tenantId } = await seedTenant();
    const exportId = await requestExport(tenantId);
    const bytes = Buffer.from('zip');
    await asJob(tenantId, (tx) =>
      tx.insert(dataExportChunks).values({ tenantId, exportId, seq: 0, bytes }),
    );
    const [read] = await withTenant(app, tenantId, (tx) =>
      tx.select({ bytes: dataExportChunks.bytes }).from(dataExportChunks),
    );
    expect(read?.bytes).toEqual(bytes);
    expect(
      await refusal(
        withTenant(app, tenantId, (tx) =>
          tx.insert(dataExportChunks).values({ tenantId, exportId, seq: 1, bytes }),
        ),
      ),
    ).toMatch(DENIED);
    expect(await refusal(withTenant(app, tenantId, (tx) => tx.delete(dataExportChunks)))).toMatch(
      DENIED,
    );
    expect(
      await refusal(asJob(tenantId, (tx) => tx.update(dataExportChunks).set({ seq: 5 }))),
    ).toMatch(DENIED);
    expect(
      await refusal(
        withTenant(owner, tenantId, (tx) => tx.update(dataExportChunks).set({ seq: 5 })),
      ),
    ).toMatch(/refuse|not allowed|append-only/i);
    await asJob(tenantId, (tx) =>
      tx.delete(dataExportChunks).where(eq(dataExportChunks.exportId, exportId)),
    );
    expect(await withTenant(app, tenantId, (tx) => tx.select().from(dataExportChunks))).toEqual([]);
  });

  it('refuse another tenant’s export and an empty chunk', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const exportId = await requestExport(b.tenantId);
    expect(
      await refusal(
        asJob(a.tenantId, (tx) =>
          tx
            .insert(dataExportChunks)
            .values({ tenantId: a.tenantId, exportId, seq: 0, bytes: Buffer.from('x') }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
    expect(
      await refusal(
        asJob(b.tenantId, (tx) =>
          tx
            .insert(dataExportChunks)
            .values({ tenantId: b.tenantId, exportId, seq: 0, bytes: Buffer.alloc(0) }),
        ),
      ),
    ).toMatch(/data_export_chunks_size/);
  });
});

describe('data_export_links', () => {
  async function addLink(tenantId: string, exportId: string, tokenHash: string) {
    await withTenant(app, tenantId, (tx) =>
      tx.insert(dataExportLinks).values({
        tenantId,
        exportId,
        createdBy: uuidv7(),
        tokenHash,
        expiresAt: sql`now() + interval '10 minutes'`,
      }),
    );
  }

  it('are found by their hash alone, and only the one holding it', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const hashA = 'a1'.repeat(32);
    const hashB = 'b2'.repeat(32);
    await addLink(a.tenantId, await requestExport(a.tenantId), hashA);
    await addLink(b.tenantId, await requestExport(b.tenantId), hashB);
    const lookup = (hash: string | null) =>
      app.transaction(async (tx) => {
        if (hash) await tx.execute(sql`select set_config('app.export_token_hash', ${hash}, true)`);
        return tx.select({ tenantId: dataExportLinks.tenantId }).from(dataExportLinks);
      });
    expect(await lookup(hashA)).toEqual([{ tenantId: a.tenantId }]);
    expect(await lookup(hashB)).toEqual([{ tenantId: b.tenantId }]);
    expect(await lookup('c3'.repeat(32))).toEqual([]);
    expect(await lookup(null)).toEqual([]);
  });

  it('are append-only, valid 10 minutes, and unique by hash', async () => {
    const { tenantId } = await seedTenant();
    const exportId = await requestExport(tenantId);
    const hash = 'd4'.repeat(32);
    await addLink(tenantId, exportId, hash);
    expect(await refusal(addLink(tenantId, exportId, hash))).toMatch(
      /data_export_links_token_hash_unique/,
    );
    expect(
      await refusal(
        withTenant(app, tenantId, (tx) =>
          tx.insert(dataExportLinks).values({
            tenantId,
            exportId,
            createdBy: uuidv7(),
            tokenHash: 'e5'.repeat(32),
            expiresAt: sql`now() + interval '1 hour'`,
          }),
        ),
      ),
    ).toMatch(/data_export_links_expires_at/);
    expect(
      await refusal(
        withTenant(owner, tenantId, (tx) =>
          tx.update(dataExportLinks).set({ createdBy: uuidv7() }),
        ),
      ),
    ).toMatch(/refuse|not allowed|append-only/i);
  });
});

describe('audit_entries.branch_id', () => {
  it('names a branch of the entry’s own tenant only', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const entry = (tenantId: string, branchId: string | null) =>
      withTenant(app, tenantId, (tx) =>
        tx.insert(auditEntries).values({
          tenantId,
          actorKind: 'system',
          actorName: 'data-export/build',
          action: 'branch.updated',
          entityType: 'branch',
          branchId,
          occurredAt: new Date(),
        }),
      );
    await entry(a.tenantId, a.branchId);
    await entry(a.tenantId, null);
    expect(await refusal(entry(a.tenantId, b.branchId))).toMatch(FK_REFUSAL);
  });
});
