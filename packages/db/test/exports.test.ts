import {
  type ExportRow,
  exportColumnNamePattern,
  exportHeaderCells,
  exportRowLine,
} from '@vertex-food/contracts';
import { ar } from '@vertex-food/i18n';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  agreementAmendments,
  agreements,
  agreementTerms,
  auditEntries,
  branchCharges,
  branches,
  branchHourExceptions,
  branchHours,
  deviceSyncStates,
  devices,
  type ExportDataset,
  entitlementStates,
  exportDatasets,
  files,
  staffMembershipBranches,
  staffMemberships,
  type TableInfo,
  tableRegistry,
  tenantSlugs,
  tenants,
  withTenant,
  withTenantSnapshot,
} from '../src/index.js';
import { connect } from './connections.js';

// Spec S06's datasets: each tenant table's export decision matches a dataset, every column has
// its Arabic description, and the job reads one tenant's rows only, as the jobs role inside a
// read-only snapshot of that tenant.

const { app, jobs } = connect();
const registry: Record<string, TableInfo> = tableRegistry;
let phoneCounter = 0;
const newPhone = () => `+9639451${String(Date.now() % 100000).padStart(5, '0')}${phoneCounter++}`;
const publicKey = () => `${uuidv7().replace(/-/g, '').slice(0, 32)}${'A'.repeat(10)}A=`;

describe('dataset declarations', () => {
  it('give every file a unique stem, unique header cells and snake-case names', () => {
    const stems = exportDatasets.map((dataset) => dataset.stem);
    expect(new Set(stems).size).toBe(stems.length);
    for (const dataset of exportDatasets) {
      const cells = dataset.columns.flatMap(exportHeaderCells);
      expect(new Set(cells).size, dataset.stem).toBe(cells.length);
      for (const column of dataset.columns) {
        expect(column.name, dataset.stem).toMatch(exportColumnNamePattern);
      }
    }
  });

  it('match the registry: a declared dataset exists and exports exactly its tables', () => {
    const byStem = new Map(exportDatasets.map((dataset) => [dataset.stem, dataset]));
    for (const [table, info] of Object.entries(registry)) {
      if (!info.export || !('dataset' in info.export)) continue;
      const dataset = byStem.get(info.export.dataset);
      expect(dataset, `${table} → ${info.export.dataset}`).toBeDefined();
      const listed = info.scope === 'tenant' ? dataset?.tables : dataset?.reads;
      expect(listed, `${info.export.dataset} names ${table}`).toContain(table);
    }
    for (const dataset of exportDatasets) {
      for (const table of dataset.tables) {
        expect(registry[table]?.scope, table).toBe('tenant');
        expect(registry[table]?.export, table).toEqual({ dataset: dataset.stem });
      }
      for (const table of dataset.reads) expect(registry[table], table).toBeDefined();
    }
  });

  it('describe every dataset and column in Arabic, and nothing else', () => {
    const texts: Record<string, { title: string; columns: Record<string, string> }> =
      ar.dataExport.datasets;
    expect(Object.keys(texts).sort()).toEqual(exportDatasets.map((d) => d.stem).sort());
    for (const dataset of exportDatasets) {
      expect(Object.keys(texts[dataset.stem]?.columns ?? {}), dataset.stem).toEqual(
        dataset.columns.map((column) => column.name),
      );
    }
  });
});

async function seedTenant(label: string) {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const accountId = uuidv7();
  const membershipId = uuidv7();
  const deviceId = uuidv7();
  const fileId = uuidv7();
  const phone = newPhone();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: `مطعم ${label}`, defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
    await tx.insert(accounts).values({ id: accountId, phone });
  });
  const png = Buffer.from(`synthetic logo ${label}`);
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(branches).values({
      id: branchId,
      tenantId,
      nameAr: `فرع ${label}`,
      code: 'main',
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD', 'SYP'],
      contactPhones: [{ phone: '+963211234567', whatsapp: false }],
    });
    await tx.insert(branchHours).values({
      tenantId,
      branchId,
      weekday: 1,
      opensAt: '09:00',
      closesAt: '23:00',
    });
    await tx.insert(branchHourExceptions).values({
      tenantId,
      branchId,
      date: '2026-11-01',
      closed: false,
      periods: [{ opensAt: '12:00', closesAt: '18:00' }],
      note: '=HYPERLINK("x")',
    });
    await tx.insert(branchCharges).values({
      tenantId,
      branchId,
      kind: 'tax',
      nameAr: 'ضريبة',
      rateBp: 500,
      mode: 'added',
      salesChannels: ['dine_in'],
      position: 1,
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
      sha256: 'a'.repeat(64),
    });
    await tx.insert(staffMemberships).values({
      id: membershipId,
      tenantId,
      accountId,
      roles: ['manager'],
      allBranches: false,
      displayName: `مدير ${label}`,
    });
    await tx.insert(staffMembershipBranches).values({ tenantId, membershipId, branchId });
    await tx.insert(devices).values({
      id: deviceId,
      tenantId,
      branchId,
      name: `الكاشير ${label}`,
      publicKey: publicKey(),
      os: 'Windows 11',
      appVersion: '0.1.0',
      registeredByMembershipId: membershipId,
    });
    await tx.insert(deviceSyncStates).values({
      tenantId,
      deviceId,
      lastHeartbeatAt: new Date('2026-10-29T10:00:00Z'),
      pendingUploads: 0,
      liveRole: 'hub',
      hubEpoch: 1,
      appVersion: '0.1.0',
      protocol: 1,
    });
    await tx.insert(auditEntries).values([
      {
        tenantId,
        actorKind: 'staff',
        actorId: accountId,
        action: 'branch_hours.replaced',
        entityType: 'branch',
        entityId: branchId,
        branchId,
        occurredAt: new Date(),
      },
      {
        tenantId,
        actorKind: 'system',
        actorName: 'Vertex Operator',
        action: 'tenant.status_changed',
        entityType: 'tenant',
        entityId: tenantId,
        reason: '+cmd',
        details: { from: 'onboarding', to: 'active' },
        occurredAt: new Date(),
      },
    ]);
  });
  await app.update(tenants).set({ logoFileId: fileId }).where(eq(tenants.id, tenantId));
  return { tenantId, branchId, accountId, membershipId, deviceId, fileId, phone };
}

/** Every dataset of a tenant, read as the build job reads them. */
async function readAll(tenantId: string) {
  return withTenantSnapshot(jobs, tenantId, async (tx) => {
    const out: Record<string, ExportRow[]> = {};
    const blobs: { path: string; bytes: Buffer }[] = [];
    for (const dataset of exportDatasets) {
      const rows: ExportRow[] = [];
      for await (const row of dataset.rows(tx, { tenantId })) {
        // Every row writes as CSV with its columns.
        exportRowLine(dataset.columns, row);
        rows.push(row);
      }
      out[dataset.stem] = rows;
      if (dataset.files) for await (const file of dataset.files(tx, { tenantId })) blobs.push(file);
    }
    return { rows: out, files: blobs };
  });
}

describe('reading the datasets', () => {
  it('reads one tenant only, as the jobs role in a read-only snapshot', async () => {
    const a = await seedTenant('أ');
    const b = await seedTenant('ب');
    const { rows, files: stored } = await readAll(a.tenantId);
    const text = JSON.stringify(rows);
    for (const id of [b.tenantId, b.branchId, b.accountId, b.membershipId, b.deviceId, b.fileId]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toContain(b.phone);
    expect(stored.map((file) => file.path)).toEqual([`files/${a.fileId}.png`]);
    expect(stored[0]?.bytes.toString()).toBe('synthetic logo أ');

    expect(rows.restaurant).toMatchObject([
      { id: a.tenantId, name_ar: 'مطعم أ', logo_file: `files/${a.fileId}.png`, cover_file: null },
    ]);
    expect(rows.branches).toMatchObject([
      { id: a.branchId, contact_phones: ['+963211234567'], accepted_currencies: ['USD', 'SYP'] },
    ]);
    expect(rows.branch_hours).toEqual([
      {
        branch_id: a.branchId,
        branch_code: 'main',
        weekday: 1,
        opens_at: '09:00',
        closes_at: '23:00',
      },
    ]);
    expect(rows.branch_hour_exceptions).toMatchObject([
      { periods: ['12:00-18:00'], note: '=HYPERLINK("x")' },
    ]);
    expect(rows.branch_charges).toMatchObject([{ kind: 'tax', rate_bp: 500 }]);
    expect(rows.staff).toMatchObject([
      { account_id: a.accountId, name: 'مدير أ', phone: a.phone, branches: ['main'] },
    ]);
    expect(rows.devices).toMatchObject([
      { id: a.deviceId, branch_code: 'main', last_sync_at: new Date('2026-10-29T10:00:00Z') },
    ]);
    // Rule 3: a member by account id; a CLI operator as Vertex, never named.
    expect(
      rows.audit_log?.map((row) => [row.action, row.actor_kind, row.actor_account_id]),
    ).toEqual(
      expect.arrayContaining([
        ['branch_hours.replaced', 'staff', a.accountId],
        ['tenant.status_changed', 'vertex', null],
      ]),
    );
    expect(text).not.toContain('Vertex Operator');
    expect(rows.audit_log?.find((row) => row.action === 'branch_hours.replaced')).toMatchObject({
      branch_id: a.branchId,
      category: 'settings',
    });
    expect(rows.agreement_terms).toEqual([]);
    expect(rows.entitlements).toEqual([]);
    expect(rows.sync_attention).toEqual([]);
  });

  it('reads the tenant’s own approved terms and entitlements, never another’s', async () => {
    const a = await seedTenant('د');
    const b = await seedTenant('ه');
    const start = new Date(Date.now() + 7 * 86_400_000);
    for (const t of [a, b]) {
      const agreementId = uuidv7();
      const amendmentId = uuidv7();
      await app.insert(agreements).values({ id: agreementId, subjectTenantId: t.tenantId });
      await app.insert(agreementAmendments).values({
        id: amendmentId,
        agreementId,
        number: 1,
        changes: { add: [], end: [] },
        authoredByOperator: 'sales1',
      });
      await app
        .update(agreementAmendments)
        .set({ status: 'submitted', submittedAt: new Date() })
        .where(eq(agreementAmendments.id, amendmentId));
      await app.transaction(async (tx) => {
        await tx
          .update(agreementAmendments)
          .set({ status: 'approved', decidedAt: sql`now()`, decidedByOperator: 'finance1' })
          .where(eq(agreementAmendments.id, amendmentId));
        await tx.insert(agreementTerms).values({
          agreementId,
          amendmentId,
          kind: 'feature',
          values: { kind: 'feature', featureKey: 'pos' },
          effectiveFrom: start,
          listValue: { secret: t.tenantId },
          differenceReason: 'not for the owner',
        });
      });
      await app.insert(entitlementStates).values({
        subjectTenantId: t.tenantId,
        version: 1,
        resolved: {
          at: new Date().toISOString(),
          features: [{ key: 'pos', on: true, source: 'agreement', reason: null, until: null }],
          limits: [{ key: 'staff', value: 5, source: 'agreement' }],
          validUntil: null,
        },
        computedAt: new Date(),
      });
    }
    const { rows } = await readAll(a.tenantId);
    expect(rows.agreement_terms).toMatchObject([
      { amendment_number: 1, kind: 'feature', amount: null, effective_from: start },
    ]);
    // Rule 28 of S05: never a list value or the reason for a difference.
    expect(JSON.stringify(rows.agreement_terms)).not.toContain('not for the owner');
    expect(JSON.stringify(rows)).not.toContain(b.tenantId);
    expect(rows.entitlements).toMatchObject([
      { type: 'feature', key: 'pos', on: true, source: 'agreement' },
      { type: 'limit', key: 'staff', value: 5 },
    ]);
  });

  it('refuses a write inside the snapshot', async () => {
    const a = await seedTenant('ج');
    await expect(
      withTenantSnapshot(jobs, a.tenantId, (tx) =>
        tx.insert(auditEntries).values({
          tenantId: a.tenantId,
          actorKind: 'system',
          actorName: 'data-export/build',
          action: 'data_export.completed',
          entityType: 'data_export',
          occurredAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it('reads a brand-new tenant: the restaurant row and empty datasets', async () => {
    const tenantId = uuidv7();
    await app.transaction(async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: tenantId, nameAr: 'مطعم جديد', defaultCurrency: 'TRY' });
      await tx
        .insert(tenantSlugs)
        .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
    });
    const { rows, files: stored } = await readAll(tenantId);
    expect(rows.restaurant).toHaveLength(1);
    expect(stored).toEqual([]);
    for (const dataset of exportDatasets as ExportDataset[]) {
      if (dataset.stem !== 'restaurant') expect(rows[dataset.stem], dataset.stem).toEqual([]);
    }
  });
});
