import {
  type Branch,
  type BranchCharge,
  type ConsoleTenant,
  type ContactPhone,
  type CurrencyCode,
  DomainError,
  effectiveStatusState,
  type HourException,
  type OpeningPeriod,
  onboardingCompleteness,
  ownerReadAccessEndsAt,
  type ScheduledTenantStatus,
  type Tenant,
  type TenantStatus,
  type TenantStatusReason,
  type TenantStatusState,
  type TimeOfDay,
  type WeeklyPeriod,
} from '@vertex-food/contracts';
import {
  type branchCharges,
  branches,
  type branchHourExceptions,
  branchHours,
  type Transaction,
  tenantSlugs,
  tenants,
} from '@vertex-food/db';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

// Rows of the tenancy tables as the contracts answer them, and the reads every route shares.

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
type HourRow = typeof branchHours.$inferSelect;
type ExceptionRow = typeof branchHourExceptions.$inferSelect;
type ChargeRow = typeof branchCharges.$inferSelect;

/** PostgreSQL answers `time` as `HH:MM:SS`; the contracts use `HH:MM`. */
export const timeOf = (value: string): TimeOfDay => value.slice(0, 5);

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function statusState(row: TenantRow): TenantStatusState {
  return {
    status: row.status as TenantStatus,
    statusReason: row.statusReason as TenantStatusReason | null,
    scheduledStatus: row.scheduledStatus as ScheduledTenantStatus | null,
    scheduledStatusReason: row.scheduledStatusReason as TenantStatusReason | null,
    scheduledStatusAt: row.scheduledStatusAt,
  };
}

export function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    code: row.code,
    cityId: row.cityId,
    addressDescription: row.addressDescription,
    location:
      row.latitudeE7 !== null && row.longitudeE7 !== null
        ? { latitudeE7: row.latitudeE7, longitudeE7: row.longitudeE7 }
        : null,
    contactPhones: row.contactPhones as ContactPhone[],
    defaultCurrency: row.defaultCurrency as CurrencyCode,
    acceptedCurrencies: row.acceptedCurrencies as CurrencyCode[],
    currencyLockedAt: iso(row.currencyLockedAt),
    businessDayEndsAt: timeOf(row.businessDayEndsAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
  };
}

export function toWeeklyPeriod(row: HourRow): WeeklyPeriod {
  return { weekday: row.weekday, opensAt: timeOf(row.opensAt), closesAt: timeOf(row.closesAt) };
}

/** Weekly periods in a stable order: by weekday, then by opening time. */
export function sortPeriods(periods: WeeklyPeriod[]): WeeklyPeriod[] {
  return [...periods].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
}

export function toHourException(row: ExceptionRow): HourException {
  return {
    id: row.id,
    branchId: row.branchId,
    date: row.date,
    closed: row.closed,
    periods: row.periods as OpeningPeriod[],
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCharge(row: ChargeRow): BranchCharge {
  return {
    id: row.id,
    kind: row.kind as BranchCharge['kind'],
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    rateBp: row.rateBp,
    mode: row.mode as BranchCharge['mode'],
    orderTypes: row.orderTypes as BranchCharge['orderTypes'],
    position: row.position,
  };
}

/**
 * The tenant row, locked for the transaction with `lock`: `update` when the row changes, `share`
 * when a branch write only reads its status (a status change then waits); `NOT_FOUND` if none.
 */
export async function readTenant(
  tx: Transaction,
  tenantId: string,
  options: { lock?: 'update' | 'share' } = {},
): Promise<TenantRow> {
  const query = tx.select().from(tenants).where(eq(tenants.id, tenantId));
  const [row] = await (options.lock ? query.for(options.lock) : query);
  if (!row) throw new DomainError('NOT_FOUND', 'No such tenant');
  return row;
}

export async function primarySlug(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx
    .select({ slug: tenantSlugs.slug })
    .from(tenantSlugs)
    .where(and(eq(tenantSlugs.subjectTenantId, tenantId), eq(tenantSlugs.isPrimary, true)));
  if (!row) throw new Error('A tenant without a primary slug');
  return row.slug;
}

/** The tenant's non-archived branches, oldest first, inside its `withTenant`. */
export function activeBranches(tx: Transaction) {
  return tx
    .select()
    .from(branches)
    .where(isNull(branches.archivedAt))
    .orderBy(asc(branches.createdAt));
}

/** The restaurant's view of its tenant, with the status in force at `now` (rule 7). */
export async function tenantView(tx: Transaction, row: TenantRow, now: Date): Promise<Tenant> {
  const branchRows = await activeBranches(tx);
  const periodCounts = await tx
    .select({ branchId: branchHours.branchId, periods: count() })
    .from(branchHours)
    .groupBy(branchHours.branchId);
  const periodsOf = new Map(periodCounts.map((entry) => [entry.branchId, entry.periods]));
  const onboarding = onboardingCompleteness(
    { nameAr: row.nameAr },
    branchRows.map((branch) => ({
      id: branch.id,
      cityId: branch.cityId,
      addressDescription: branch.addressDescription,
      location: toBranch(branch).location,
      contactPhones: branch.contactPhones as unknown[],
      weeklyPeriodCount: periodsOf.get(branch.id) ?? 0,
      defaultCurrency: branch.defaultCurrency,
    })),
  );
  const state = effectiveStatusState(statusState(row), now);
  // A closure the job has not written yet took effect at its scheduled time.
  const closedAt =
    state.status === 'closed' ? (row.closedAt ?? row.scheduledStatusAt) : row.closedAt;
  return {
    id: row.id,
    slug: await primarySlug(tx, row.id),
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    defaultCurrency: row.defaultCurrency as CurrencyCode,
    status: state.status,
    statusReason: state.statusReason,
    statusChangedAt: (state.status === row.status
      ? row.statusChangedAt
      : (row.scheduledStatusAt ?? row.statusChangedAt)
    ).toISOString(),
    scheduledChange:
      state.scheduledStatus && state.scheduledStatusReason && state.scheduledStatusAt
        ? {
            status: state.scheduledStatus,
            reason: state.scheduledStatusReason,
            at: state.scheduledStatusAt.toISOString(),
          }
        : null,
    onboardingCompletedAt: iso(row.onboardingCompletedAt),
    activatedAt: iso(row.activatedAt),
    closedAt: iso(closedAt),
    ownerReadUntil:
      state.status === 'closed' && closedAt ? ownerReadAccessEndsAt(closedAt).toISOString() : null,
    onboarding,
    logoFileId: row.logoFileId,
    coverFileId: row.coverFileId,
    branchCount: branchRows.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The console's view of a tenant, with the status in force at `now`. */
export function consoleTenantView(
  row: TenantRow,
  slug: string,
  branchCount: number,
  now: Date,
): ConsoleTenant {
  const state = effectiveStatusState(statusState(row), now);
  return {
    id: row.id,
    slug,
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    status: state.status,
    statusReason: state.statusReason,
    scheduledChange:
      state.scheduledStatus && state.scheduledStatusReason && state.scheduledStatusAt
        ? {
            status: state.scheduledStatus,
            reason: state.scheduledStatusReason,
            at: state.scheduledStatusAt.toISOString(),
          }
        : null,
    onboardingCompletedAt: iso(row.onboardingCompletedAt),
    activatedAt: iso(row.activatedAt),
    branchCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
