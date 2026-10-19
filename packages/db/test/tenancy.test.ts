import { eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  branchCharges,
  branches,
  branchHourExceptions,
  branchHours,
  cities,
  files,
  governorates,
  outboxEvents,
  platformAuditEntries,
  tenantSlugs,
  tenants,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S01 in the database: every tenant table isolated as the app role, composite keys that stop
// another tenant's ids, the guards the rules need, the seed, and what the jobs role may do.

const { owner, app, jobs } = connect();
const RLS_REFUSAL = /new row violates row-level security policy/;
const DENIED = /permission denied for table/;
const FK_REFUSAL = /violates foreign key constraint/;

const AZAZ = '0199fd00-0000-7000-8000-00000000c001';

/** A tenant with one branch, made as the app role the way the tenancy service makes them. */
async function seedTenant() {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  await app.insert(tenants).values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
  await app
    .insert(tenantSlugs)
    .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
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

const png = Buffer.from('synthetic image bytes');
const file = (tenantId: string) => ({
  tenantId,
  purpose: 'logo',
  mediaType: 'image/png',
  bytes: png,
  byteSize: png.length,
  width: 512,
  height: 512,
  sha256: 'a'.repeat(64),
});

describe('the seed', () => {
  it('has Aleppo → Azaz with fixed UUIDv7 ids', async () => {
    const rows = await app
      .select({ id: cities.id, nameLatin: cities.nameLatin, governorate: governorates.nameLatin })
      .from(cities)
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(eq(cities.id, AZAZ));
    expect(rows).toEqual([{ id: AZAZ, nameLatin: 'Azaz', governorate: 'Aleppo' }]);
  });

  it('is read-only to the app role', async () => {
    expect(
      await refusal(
        app.insert(governorates).values({ nameAr: 'إدلب', nameLatin: 'Idlib', position: 2 }),
      ),
    ).toMatch(DENIED);
    expect(
      await refusal(app.update(cities).set({ nameLatin: 'X' }).where(eq(cities.id, AZAZ))),
    ).toMatch(DENIED);
  });
});

describe('tenant tables', () => {
  it('show each tenant only its own branches, hours, exceptions, charges and files', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    for (const { tenantId, branchId } of [a, b]) {
      await withTenant(app, tenantId, async (tx) => {
        await tx
          .insert(branchHours)
          .values({ tenantId, branchId, weekday: 1, opensAt: '10:00', closesAt: '23:00' });
        await tx
          .insert(branchHourExceptions)
          .values({ tenantId, branchId, date: '2026-12-31', closed: true, periods: [] });
        await tx.insert(branchCharges).values({
          tenantId,
          branchId,
          kind: 'service',
          nameAr: 'خدمة',
          rateBp: 1000,
          mode: 'added',
          orderTypes: ['dine_in'],
          position: 1,
        });
        await tx.insert(files).values(file(tenantId));
      });
    }
    const ids = [a.tenantId, b.tenantId];
    for (const table of [branches, branchHours, branchHourExceptions, branchCharges, files]) {
      const seen = await withTenant(app, a.tenantId, (tx) =>
        tx.select({ tenantId: table.tenantId }).from(table).where(inArray(table.tenantId, ids)),
      );
      expect(new Set(seen.map((row) => row.tenantId))).toEqual(new Set([a.tenantId]));
      expect(await app.select().from(table).where(inArray(table.tenantId, ids))).toEqual([]);
    }
  });

  it("refuse to write another tenant's rows", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.insert(branches).values({
            tenantId: b.tenantId,
            nameAr: 'فرع آخر',
            code: 'other',
            defaultCurrency: 'USD',
            acceptedCurrencies: ['USD'],
          }),
        ),
      ),
    ).toMatch(RLS_REFUSAL);
    expect(
      await refusal(withTenant(app, a.tenantId, (tx) => tx.insert(files).values(file(b.tenantId)))),
    ).toMatch(RLS_REFUSAL);
  });

  it("refuse another tenant's branch id in hours, exceptions and charges (composite keys)", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const own = { tenantId: a.tenantId, branchId: b.branchId };
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx
            .insert(branchHours)
            .values({ ...own, weekday: 1, opensAt: '10:00', closesAt: '12:00' }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx
            .insert(branchHourExceptions)
            .values({ ...own, date: '2026-12-31', closed: true, periods: [] }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.insert(branchCharges).values({
            ...own,
            kind: 'tax',
            nameAr: 'ضريبة',
            rateBp: 500,
            mode: 'inclusive',
            orderTypes: ['takeaway'],
            position: 1,
          }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
  });

  it("refuse another tenant's file as a logo", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const [other] = await withTenant(app, b.tenantId, (tx) =>
      tx.insert(files).values(file(b.tenantId)).returning({ id: files.id }),
    );
    expect(
      await refusal(
        app.update(tenants).set({ logoFileId: other?.id }).where(eq(tenants.id, a.tenantId)),
      ),
    ).toMatch(FK_REFUSAL);
  });

  it('let the app role delete weekly hours only, never branches, files, exceptions or charges', async () => {
    const a = await seedTenant();
    await withTenant(app, a.tenantId, async (tx) => {
      await tx.insert(branchHours).values({
        tenantId: a.tenantId,
        branchId: a.branchId,
        weekday: 2,
        opensAt: '10:00',
        closesAt: '12:00',
      });
      await tx.delete(branchHours).where(eq(branchHours.branchId, a.branchId));
    });
    for (const table of [branches, files, branchHourExceptions, branchCharges]) {
      expect(
        await refusal(
          withTenant(app, a.tenantId, (tx) =>
            tx.delete(table).where(eq(table.tenantId, a.tenantId)),
          ),
        ),
      ).toMatch(DENIED);
    }
    expect(await refusal(app.delete(tenants).where(eq(tenants.id, a.tenantId)))).toMatch(DENIED);
  });
});

describe('branches', () => {
  it('never change their code', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.update(branches).set({ code: 'renamed' }).where(eq(branches.id, a.branchId)),
        ),
      ),
    ).toMatch(DENIED);
  });

  it('keep the default currency among the accepted ones', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.update(branches).set({ defaultCurrency: 'TRY' }).where(eq(branches.id, a.branchId)),
        ),
      ),
    ).toMatch(/branches_currencies/);
  });

  it('fix the default currency once it is locked (rule 11)', async () => {
    const a = await seedTenant();
    await withTenant(app, a.tenantId, (tx) =>
      tx
        .update(branches)
        .set({ acceptedCurrencies: ['USD', 'TRY'], currencyLockedAt: new Date() })
        .where(eq(branches.id, a.branchId)),
    );
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.update(branches).set({ defaultCurrency: 'TRY' }).where(eq(branches.id, a.branchId)),
        ),
      ),
    ).toMatch(/default currency is locked/);
    // Accepted currencies still change.
    await withTenant(app, a.tenantId, (tx) =>
      tx
        .update(branches)
        .set({ acceptedCurrencies: ['USD'] })
        .where(eq(branches.id, a.branchId)),
    );
  });

  it('accept a business day end on the hour or half hour up to 08:00', async () => {
    const a = await seedTenant();
    for (const end of ['08:30', '04:15']) {
      expect(
        await refusal(
          withTenant(app, a.tenantId, (tx) =>
            tx.update(branches).set({ businessDayEndsAt: end }).where(eq(branches.id, a.branchId)),
          ),
        ),
      ).toMatch(/branches_business_day_ends_at/);
    }
  });
});

describe('tenants and slugs', () => {
  it('keep exactly one primary slug and never give a slug to two tenants', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    expect(
      await refusal(
        app.insert(tenantSlugs).values({
          slug: `x-${a.tenantId.slice(-12)}`,
          subjectTenantId: a.tenantId,
          isPrimary: true,
        }),
      ),
    ).toMatch(/tenant_slugs_primary_idx/);
    const [taken] = await app
      .select({ slug: tenantSlugs.slug })
      .from(tenantSlugs)
      .where(eq(tenantSlugs.subjectTenantId, a.tenantId));
    expect(
      await refusal(
        app
          .insert(tenantSlugs)
          .values({ slug: taken?.slug ?? '', subjectTenantId: b.tenantId, isPrimary: false }),
      ),
    ).toMatch(/tenant_slugs_slug_unique/);
    expect(
      await refusal(
        app
          .update(tenantSlugs)
          .set({ subjectTenantId: b.tenantId })
          .where(eq(tenantSlugs.subjectTenantId, a.tenantId)),
      ),
    ).toMatch(DENIED);
  });

  it('keep a closed tenant closed and require its reason and archive', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        app.update(tenants).set({ status: 'closed' }).where(eq(tenants.id, a.tenantId)),
      ),
    ).toMatch(/tenants_/);
    const now = new Date();
    await app
      .update(tenants)
      .set({ status: 'closed', statusReason: 'other', closedAt: now, archivedAt: now })
      .where(eq(tenants.id, a.tenantId));
    expect(
      await refusal(
        app
          .update(tenants)
          .set({ status: 'active', statusReason: null, closedAt: null, archivedAt: null })
          .where(eq(tenants.id, a.tenantId)),
      ),
    ).toMatch(/stays closed/);
  });

  it('activate only after onboarding is complete', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        app
          .update(tenants)
          .set({ status: 'active', activatedAt: new Date() })
          .where(eq(tenants.id, a.tenantId)),
      ),
    ).toMatch(/tenants_activation_after_onboarding/);
  });
});

describe('platform_audit_entries', () => {
  it('is append-only', async () => {
    const [row] = await app
      .insert(platformAuditEntries)
      .values({
        actorKind: 'system',
        actorName: 'test',
        action: 'city.created',
        entityType: 'city',
        occurredAt: new Date(),
      })
      .returning({ id: platformAuditEntries.id });
    expect(
      await refusal(
        owner
          .update(platformAuditEntries)
          .set({ action: 'x' })
          .where(eq(platformAuditEntries.id, row?.id ?? '')),
      ),
    ).toMatch(/append-only/);
  });
});

describe('the jobs role on tenants', () => {
  it('reads tenants and writes only their status columns', async () => {
    const a = await seedTenant();
    const [seen] = await jobs
      .select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, a.tenantId));
    expect(seen).toEqual({ id: a.tenantId, status: 'onboarding' });
    const now = new Date();
    await jobs
      .update(tenants)
      .set({ status: 'closed', statusReason: 'other', closedAt: now, archivedAt: now })
      .where(eq(tenants.id, a.tenantId));
    expect(
      await refusal(
        jobs.update(tenants).set({ nameAr: 'اسم آخر' }).where(eq(tenants.id, a.tenantId)),
      ),
    ).toMatch(DENIED);
  });

  it('adds audit entries and events inside its tenant only, and reads no branch', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await withTenant(jobs, a.tenantId, async (tx) => {
      await tx.insert(auditEntries).values({
        tenantId: a.tenantId,
        actorKind: 'system',
        actorName: 'tenancy/apply-scheduled-status',
        action: 'tenant.status_changed',
        entityType: 'tenant',
        entityId: a.tenantId,
        occurredAt: new Date(),
      });
      await tx
        .insert(outboxEvents)
        .values({ tenantId: a.tenantId, type: 'tenant.status_changed.v1', payload: {} });
    });
    expect(
      await refusal(
        withTenant(jobs, a.tenantId, (tx) =>
          tx.insert(auditEntries).values({
            tenantId: b.tenantId,
            actorKind: 'system',
            action: 'tenant.status_changed',
            entityType: 'tenant',
            occurredAt: new Date(),
          }),
        ),
      ),
    ).toMatch(RLS_REFUSAL);
    expect(await refusal(withTenant(jobs, a.tenantId, (tx) => tx.select().from(branches)))).toMatch(
      DENIED,
    );
    expect(await refusal(jobs.select().from(auditEntries))).toMatch(DENIED);
  });
});

describe('the owner role', () => {
  it('sees no branch outside a tenant transaction either (forced RLS)', async () => {
    const a = await seedTenant();
    const rows = await owner.execute(sql`select id from branches where tenant_id = ${a.tenantId}`);
    expect(rows.rows).toEqual([]);
  });
});
