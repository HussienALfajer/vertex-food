import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Transaction } from '../client.js';
import { cities } from '../schema/areas.js';
import { files } from '../schema/files.js';
import {
  branchCharges,
  branches,
  branchHourExceptions,
  branchHours,
  tenantSlugs,
  tenants,
} from '../schema/tenancy.js';
import { byPages, EXPORT_PAGE_SIZE, type ExportDataset, wallTime } from './dataset.js';

// The restaurant and its branches (module `tenancy`, spec S01). Every row of the tenant, archived
// ones included (rule 11); the tenant row and slug are platform data the restaurant's settings
// show, the city's name is reference data.

const after = (column: AnyPgColumn, id: string | null): SQL | undefined =>
  id === null ? undefined : gt(column, id);

const extension: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp' };

/** Where a stored file lands in the ZIP. */
export function exportFilePath(file: { id: string; mediaType: string }): string {
  return `files/${file.id}.${extension[file.mediaType] ?? 'bin'}`;
}

export const restaurantDataset: ExportDataset = {
  stem: 'restaurant',
  tables: ['files'],
  reads: ['tenants', 'tenant_slugs'],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'name_ar', kind: 'text' },
    { name: 'name_latin', kind: 'text' },
    { name: 'slug', kind: 'text' },
    { name: 'default_currency', kind: 'text' },
    { name: 'status', kind: 'text' },
    { name: 'activated_at', kind: 'instant' },
    { name: 'onboarding_completed_at', kind: 'instant' },
    { name: 'closed_at', kind: 'instant' },
    { name: 'logo_file', kind: 'text' },
    { name: 'cover_file', kind: 'text' },
    { name: 'created_at', kind: 'instant' },
  ],
  async *rows(tx, { tenantId }) {
    const [row] = await tx
      .select({
        id: tenants.id,
        nameAr: tenants.nameAr,
        nameLatin: tenants.nameLatin,
        slug: tenantSlugs.slug,
        defaultCurrency: tenants.defaultCurrency,
        status: tenants.status,
        activatedAt: tenants.activatedAt,
        onboardingCompletedAt: tenants.onboardingCompletedAt,
        closedAt: tenants.closedAt,
        logoFileId: tenants.logoFileId,
        coverFileId: tenants.coverFileId,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .innerJoin(
        tenantSlugs,
        and(eq(tenantSlugs.subjectTenantId, tenants.id), eq(tenantSlugs.isPrimary, true)),
      )
      .where(eq(tenants.id, tenantId));
    if (!row) return;
    const stored = await tx
      .select({ id: files.id, mediaType: files.mediaType })
      .from(files)
      .orderBy(asc(files.id));
    const pathOf = (id: string | null) => {
      const file = stored.find((candidate) => candidate.id === id);
      return file ? exportFilePath(file) : null;
    };
    yield {
      id: row.id,
      name_ar: row.nameAr,
      name_latin: row.nameLatin,
      slug: row.slug,
      default_currency: row.defaultCurrency,
      status: row.status,
      activated_at: row.activatedAt,
      onboarding_completed_at: row.onboardingCompletedAt,
      closed_at: row.closedAt,
      logo_file: pathOf(row.logoFileId),
      cover_file: pathOf(row.coverFileId),
      created_at: row.createdAt,
    };
  },
  async *files(tx) {
    // Every stored file, replaced and archived ones too, one at a time.
    const ids = await tx.select({ id: files.id }).from(files).orderBy(asc(files.id));
    for (const { id } of ids) {
      const [file] = await tx
        .select({ id: files.id, mediaType: files.mediaType, bytes: files.bytes })
        .from(files)
        .where(eq(files.id, id));
      if (file) yield { path: exportFilePath(file), bytes: file.bytes };
    }
  },
};

const branchCode = (tx: Transaction) =>
  tx.select({ id: branches.id, code: branches.code }).from(branches);

export const branchesDataset: ExportDataset = {
  stem: 'branches',
  tables: ['branches'],
  reads: ['cities'],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'code', kind: 'text' },
    { name: 'name_ar', kind: 'text' },
    { name: 'name_latin', kind: 'text' },
    { name: 'city', kind: 'text' },
    { name: 'address_description', kind: 'text' },
    { name: 'latitude_e7', kind: 'integer' },
    { name: 'longitude_e7', kind: 'integer' },
    { name: 'contact_phones', kind: 'list' },
    { name: 'default_currency', kind: 'text' },
    { name: 'accepted_currencies', kind: 'list' },
    { name: 'business_day_ends_at', kind: 'text' },
    { name: 'idle_lock_minutes', kind: 'integer' },
    { name: 'created_at', kind: 'instant' },
    { name: 'updated_at', kind: 'instant' },
    { name: 'archived_at', kind: 'instant' },
  ],
  async *rows(tx) {
    const pages = byPages((id) =>
      tx
        .select({ branch: branches, city: cities.nameAr })
        .from(branches)
        .leftJoin(cities, eq(cities.id, branches.cityId))
        .where(after(branches.id, id))
        .orderBy(asc(branches.id))
        .limit(EXPORT_PAGE_SIZE)
        .then((rows) => rows.map((row) => ({ id: row.branch.id, ...row }))),
    );
    for await (const { branch, city } of pages) {
      yield {
        id: branch.id,
        code: branch.code,
        name_ar: branch.nameAr,
        name_latin: branch.nameLatin,
        city,
        address_description: branch.addressDescription,
        latitude_e7: branch.latitudeE7,
        longitude_e7: branch.longitudeE7,
        contact_phones: (branch.contactPhones as { phone: string }[]).map((entry) => entry.phone),
        default_currency: branch.defaultCurrency,
        accepted_currencies: branch.acceptedCurrencies,
        business_day_ends_at: wallTime(branch.businessDayEndsAt),
        idle_lock_minutes: branch.idleLockMinutes,
        created_at: branch.createdAt,
        updated_at: branch.updatedAt,
        archived_at: branch.archivedAt,
      };
    }
  },
};

export const branchHoursDataset: ExportDataset = {
  stem: 'branch_hours',
  tables: ['branch_hours'],
  reads: [],
  columns: [
    { name: 'branch_id', kind: 'text' },
    { name: 'branch_code', kind: 'text' },
    { name: 'weekday', kind: 'integer' },
    { name: 'opens_at', kind: 'text' },
    { name: 'closes_at', kind: 'text' },
  ],
  async *rows(tx) {
    // At most two periods a weekday per branch (S01): one query, a branch's week in order.
    const rows = await tx
      .select({ hours: branchHours, code: branches.code })
      .from(branchHours)
      .innerJoin(branches, eq(branches.id, branchHours.branchId))
      .orderBy(asc(branches.code), asc(branchHours.weekday), asc(branchHours.opensAt));
    for (const { hours, code } of rows) {
      yield {
        branch_id: hours.branchId,
        branch_code: code,
        weekday: hours.weekday,
        opens_at: wallTime(hours.opensAt),
        closes_at: wallTime(hours.closesAt),
      };
    }
  },
};

export const branchHourExceptionsDataset: ExportDataset = {
  stem: 'branch_hour_exceptions',
  tables: ['branch_hour_exceptions'],
  reads: [],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'branch_id', kind: 'text' },
    { name: 'branch_code', kind: 'text' },
    { name: 'date', kind: 'date' },
    { name: 'closed', kind: 'boolean' },
    { name: 'periods', kind: 'list' },
    { name: 'note', kind: 'text' },
    { name: 'created_at', kind: 'instant' },
    { name: 'updated_at', kind: 'instant' },
    { name: 'archived_at', kind: 'instant' },
  ],
  async *rows(tx) {
    const codes = new Map((await branchCode(tx)).map((row) => [row.id, row.code]));
    const pages = byPages((id) =>
      tx
        .select()
        .from(branchHourExceptions)
        .where(after(branchHourExceptions.id, id))
        .orderBy(asc(branchHourExceptions.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const row of pages) {
      const periods = row.periods as { opensAt: string; closesAt: string }[];
      yield {
        id: row.id,
        branch_id: row.branchId,
        branch_code: codes.get(row.branchId) ?? null,
        date: row.date,
        closed: row.closed,
        periods: periods.map((period) => `${period.opensAt}-${period.closesAt}`),
        note: row.note,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        archived_at: row.archivedAt,
      };
    }
  },
};

export const branchChargesDataset: ExportDataset = {
  stem: 'branch_charges',
  tables: ['branch_charges'],
  reads: [],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'branch_id', kind: 'text' },
    { name: 'branch_code', kind: 'text' },
    { name: 'kind', kind: 'text' },
    { name: 'name_ar', kind: 'text' },
    { name: 'name_latin', kind: 'text' },
    { name: 'rate_bp', kind: 'integer' },
    { name: 'mode', kind: 'text' },
    { name: 'sales_channels', kind: 'list' },
    { name: 'position', kind: 'integer' },
    { name: 'created_at', kind: 'instant' },
    { name: 'updated_at', kind: 'instant' },
    { name: 'archived_at', kind: 'instant' },
  ],
  async *rows(tx) {
    const codes = new Map((await branchCode(tx)).map((row) => [row.id, row.code]));
    const pages = byPages((id) =>
      tx
        .select()
        .from(branchCharges)
        .where(after(branchCharges.id, id))
        .orderBy(asc(branchCharges.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const row of pages) {
      yield {
        id: row.id,
        branch_id: row.branchId,
        branch_code: codes.get(row.branchId) ?? null,
        kind: row.kind,
        name_ar: row.nameAr,
        name_latin: row.nameLatin,
        rate_bp: row.rateBp,
        mode: row.mode,
        sales_channels: row.salesChannels,
        position: row.position,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        archived_at: row.archivedAt,
      };
    }
  },
};
