import { Inject, Injectable } from '@nestjs/common';
import {
  assertCurrenciesConsistent,
  assertSlugAllowed,
  assertTenantWritable,
  type Branch,
  type BranchCharge,
  type BranchCharges,
  type BranchDetail,
  type BranchHours,
  branchHoursFields,
  branchSettingsFields,
  businessDateOf,
  type ConsoleTenantDetail,
  type ConsoleTenantPage,
  type Coordinates,
  type CreateBranch,
  type CreateHourException,
  type CreateTenant,
  DomainError,
  effectiveStatus,
  effectiveStatusState,
  type FilePurpose,
  type HourException,
  isScheduleDue,
  type ListConsoleTenantsQuery,
  nextBusinessDayEnd,
  planTenantStatusChange,
  type ReplaceBranchCharges,
  type ReplaceBranchHours,
  type ScheduledTenantStatus,
  type StoredFile,
  type Tenant,
  type TenantStatusRequest,
  type TimeOfDay,
  type UpdateBranch,
  type UpdateBranchSecurity,
  type UpdateHourException,
  type UpdateTenant,
  validateHourException,
  validateWeeklyHours,
} from '@vertex-food/contracts';
import {
  branchCharges,
  branches,
  branchHourExceptions,
  branchHours,
  type Database,
  type Transaction,
  tenantSlugs,
  tenants,
  withTenant,
} from '@vertex-food/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type PlatformOperator,
  requirePermission,
  type StaffActor,
  type SystemActor,
} from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { assertCurrent, nextUpdatedAt } from '../../../core/concurrency/updated-at.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { emit } from '../../../core/events/outbox.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import { AreasService } from '../areas/index.js';
import { encodeImage, FilesService } from '../files/index.js';
import type { MapLinkResolver } from './map-link-resolver.js';
import {
  TENANT_DEVICES,
  TENANT_ENTITLEMENTS,
  TENANT_MEMBERS,
  TENANT_OWNERS,
  type TenantDevices,
  type TenantEntitlements,
  type TenantMembers,
  type TenantOwners,
} from './ports.js';
import {
  activeBranches,
  type BranchRow,
  consoleTenantView,
  primarySlug,
  readTenant,
  sortPeriods,
  statusState,
  type TenantRow,
  tenantView,
  timeOf,
  toBranch,
  toCharge,
  toHourException,
  toWeeklyPeriod,
} from './tenancy.views.js';

export const MAP_LINK_RESOLVER = Symbol('MapLinkResolver');

/** The actor the audit log records when a due scheduled change is applied (rule 7). */
const SCHEDULE_ACTOR: SystemActor = { kind: 'system', name: 'tenancy/apply-scheduled-status' };

const branchNotFound = () => new DomainError('NOT_FOUND', 'No such branch');

/** `%` and `_` typed by Vertex staff match themselves in a search. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Tenancy (spec S01): the restaurant's profile, branches, hours, exceptions and charge lines, and
 * the tenant registry for Vertex staff (console routes and the CLI). Every change writes its audit
 * entry and outbox event in its transaction; restaurant routes act on the session's tenant only.
 */
@Injectable()
export class TenancyService {
  /** 20 map-link resolutions per minute per tenant (rule 20). */
  private readonly mapLinks = new RateLimiter(20, 60_000);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(AreasService) private readonly areas: AreasService,
    @Inject(MAP_LINK_RESOLVER) private readonly resolver: MapLinkResolver,
    @Inject(TENANT_OWNERS) private readonly owners: TenantOwners,
    @Inject(TENANT_DEVICES) private readonly devices: TenantDevices,
    @Inject(TENANT_MEMBERS) private readonly members: TenantMembers,
    @Inject(TENANT_ENTITLEMENTS) private readonly entitlements: TenantEntitlements,
  ) {}

  // The restaurant's tenant.

  async getTenant(actor: StaffActor): Promise<Tenant> {
    requirePermission(actor, 'tenant.view');
    return withTenant(this.db, actor.tenantId, async (tx) =>
      tenantView(tx, await readTenant(tx, actor.tenantId), new Date()),
    );
  }

  async updateTenant(actor: StaffActor, input: UpdateTenant): Promise<Tenant> {
    requirePermission(actor, 'tenant.profile.edit');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const { row, now } = await this.writableTenant(tx, actor.tenantId);
      assertCurrent(row, input.updatedAt);
      const [updated] = await tx
        .update(tenants)
        .set({
          nameAr: input.nameAr,
          nameLatin: input.nameLatin,
          defaultCurrency: input.defaultCurrency,
          updatedAt: nextUpdatedAt(row, now),
        })
        .where(eq(tenants.id, row.id))
        .returning();
      if (!updated) throw new Error('No tenant updated');
      await audit(tx, row.id, actor, {
        action: 'tenant.profile_updated',
        entityType: 'tenant',
        entityId: row.id,
        details: {
          before: {
            nameAr: row.nameAr,
            nameLatin: row.nameLatin,
            defaultCurrency: row.defaultCurrency,
          },
          after: {
            nameAr: input.nameAr,
            nameLatin: input.nameLatin,
            defaultCurrency: input.defaultCurrency,
          },
        },
      });
      return tenantView(tx, updated, now);
    });
  }

  /** Replaces the logo or the cover; the previous file is archived in the same transaction. */
  async replaceImage(actor: StaffActor, purpose: FilePurpose, upload: Buffer): Promise<StoredFile> {
    requirePermission(actor, 'tenant.profile.edit');
    // Decoded before the transaction: no lock is held while the image is encoded.
    const image = await encodeImage(purpose, upload);
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const { row, now } = await this.writableTenant(tx, actor.tenantId);
      const previous = purpose === 'logo' ? row.logoFileId : row.coverFileId;
      const file = await this.files.store(tx, row.id, image);
      if (previous) await this.files.archive(tx, previous);
      await tx
        .update(tenants)
        .set({
          ...(purpose === 'logo' ? { logoFileId: file.id } : { coverFileId: file.id }),
          updatedAt: nextUpdatedAt(row, now),
        })
        .where(eq(tenants.id, row.id));
      await audit(tx, row.id, actor, {
        action: purpose === 'logo' ? 'tenant_logo.replaced' : 'tenant_cover.replaced',
        entityType: 'file',
        entityId: file.id,
        details: { previousFileId: previous },
      });
      return file;
    });
  }

  /** Removes the logo or the cover (archived, never deleted); nothing to remove is not an error. */
  async removeImage(actor: StaffActor, purpose: FilePurpose): Promise<void> {
    requirePermission(actor, 'tenant.profile.edit');
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const { row, now } = await this.writableTenant(tx, actor.tenantId);
      const previous = purpose === 'logo' ? row.logoFileId : row.coverFileId;
      if (!previous) return;
      await this.files.archive(tx, previous);
      await tx
        .update(tenants)
        .set({
          ...(purpose === 'logo' ? { logoFileId: null } : { coverFileId: null }),
          updatedAt: nextUpdatedAt(row, now),
        })
        .where(eq(tenants.id, row.id));
      await audit(tx, row.id, actor, {
        action: purpose === 'logo' ? 'tenant_logo.archived' : 'tenant_cover.archived',
        entityType: 'file',
        entityId: previous,
      });
    });
  }

  /** Rule 3: idempotent; succeeds only when nothing is missing. */
  async completeOnboarding(actor: StaffActor): Promise<Tenant> {
    requirePermission(actor, 'tenant.profile.edit');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const row = await readTenant(tx, actor.tenantId, { lock: 'update' });
      const now = new Date();
      if (effectiveStatus(statusState(row), now) === 'closed') {
        throw new DomainError('TENANT_CLOSED', 'The tenant is closed');
      }
      if (row.onboardingCompletedAt) return tenantView(tx, row, now);
      const view = await tenantView(tx, row, now);
      if (!view.onboarding.complete) {
        throw new DomainError('ONBOARDING_INCOMPLETE', 'Onboarding is not complete', {
          missing: view.onboarding.missing,
        });
      }
      const [updated] = await tx
        .update(tenants)
        .set({ onboardingCompletedAt: now, updatedAt: nextUpdatedAt(row, now) })
        .where(eq(tenants.id, row.id))
        .returning();
      if (!updated) throw new Error('No tenant updated');
      await audit(tx, row.id, actor, {
        action: 'tenant.onboarding_completed',
        entityType: 'tenant',
        entityId: row.id,
      });
      return tenantView(tx, updated, now);
    });
  }

  // Branches.

  /** The branches the member reaches (branch scope applied). */
  async listBranches(actor: StaffActor): Promise<Branch[]> {
    requirePermission(actor, 'tenant.view');
    const rows = await withTenant(this.db, actor.tenantId, (tx) => activeBranches(tx));
    return rows
      .filter((row) => actor.allBranches || actor.branchIds.includes(row.id))
      .map(toBranch);
  }

  async getBranch(actor: StaffActor, branchId: string): Promise<BranchDetail> {
    requirePermission(actor, 'tenant.view');
    if (!actor.allBranches && !actor.branchIds.includes(branchId)) throw branchNotFound();
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(branches).where(eq(branches.id, branchId));
      if (!row) throw branchNotFound();
      return this.branchDetail(tx, row, new Date());
    });
  }

  async updateBranch(actor: StaffActor, branchId: string, input: UpdateBranch): Promise<Branch> {
    const changed = (Object.keys(input) as (keyof UpdateBranch)[]).filter(
      (key) => key !== 'updatedAt' && input[key] !== undefined,
    );
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      if (changed.some((key) => (branchSettingsFields as readonly string[]).includes(key))) {
        requirePermission(actor, 'branch.settings.edit', branchId);
      }
      if (changed.some((key) => (branchHoursFields as readonly string[]).includes(key))) {
        requirePermission(actor, 'branch.hours.edit', branchId);
      }
      if (changed.length === 0) requirePermission(actor, 'tenant.view', branchId);
      const now = writableAt(tenant);
      assertCurrent(row, input.updatedAt);
      const defaultCurrency = input.defaultCurrency ?? row.defaultCurrency;
      if (defaultCurrency !== row.defaultCurrency && row.currencyLockedAt) {
        throw new DomainError('BRANCH_CURRENCY_LOCKED', 'The default currency is locked');
      }
      assertCurrenciesConsistent(
        defaultCurrency,
        input.acceptedCurrencies ?? row.acceptedCurrencies,
      );
      if (input.cityId !== undefined && input.cityId !== row.cityId) {
        const city = await this.areas.findCity(tx, input.cityId);
        // An archived city stays on the branches that have it, but is not chosen anew (edge case 7).
        if (!city || city.archivedAt) {
          throw new DomainError('VALIDATION_FAILED', 'No such city to choose');
        }
      }
      const updated = await tx
        .update(branches)
        .set({
          nameAr: input.nameAr,
          nameLatin: input.nameLatin,
          cityId: input.cityId,
          addressDescription: input.addressDescription,
          latitudeE7: input.location?.latitudeE7,
          longitudeE7: input.location?.longitudeE7,
          contactPhones: input.contactPhones,
          defaultCurrency: input.defaultCurrency,
          acceptedCurrencies: input.acceptedCurrencies,
          updatedAt: nextUpdatedAt(row, now),
        })
        .where(eq(branches.id, row.id))
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'branches_tenant_name_ar_idx')) {
            throw new DomainError('CONFLICT', 'Another branch has this name');
          }
          throw error;
        });
      const after = updated[0];
      if (!after) throw new Error('No branch updated');
      const before = toBranch(row);
      const changedBranch = toBranch(after);
      const shown = changed.filter((key) => key !== 'contactPhones');
      await audit(tx, actor.tenantId, actor, {
        action: 'branch.updated',
        entityType: 'branch',
        entityId: row.id,
        // Phones are listed by field name only: phones stay out of every trail but the row.
        details: { changed, before: pick(before, shown), after: pick(changedBranch, shown) },
      });
      await emit(tx, actor.tenantId, 'branch.settings_changed.v1', {
        tenantId: actor.tenantId,
        branchId: row.id,
        part: 'profile',
      });
      return changedBranch;
    });
  }

  /** Spec S02 rule 32: the branch's idle lock; its PCs read it with their member list. */
  async updateBranchSecurity(
    actor: StaffActor,
    branchId: string,
    input: UpdateBranchSecurity,
  ): Promise<Branch> {
    requirePermission(actor, 'branch.security.edit', branchId);
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      const now = writableAt(tenant);
      assertCurrent(row, input.updatedAt);
      const [updated] = await tx
        .update(branches)
        .set({ idleLockMinutes: input.idleLockMinutes, updatedAt: nextUpdatedAt(row, now) })
        .where(eq(branches.id, row.id))
        .returning();
      if (!updated) throw new Error('No branch updated');
      await audit(tx, actor.tenantId, actor, {
        action: 'branch.security_updated',
        entityType: 'branch',
        entityId: row.id,
        details: {
          before: { idleLockMinutes: row.idleLockMinutes },
          after: { idleLockMinutes: input.idleLockMinutes },
        },
      });
      return toBranch(updated);
    });
  }

  /** Replaces the weekly hours and the business day end as one set (rule 12). */
  async replaceHours(
    actor: StaffActor,
    branchId: string,
    input: ReplaceBranchHours,
  ): Promise<BranchHours> {
    validateWeeklyHours(input.periods, input.businessDayEndsAt);
    return withTenant(this.db, actor.tenantId, async (tx) => {
      // Locked for update: a changed business day end moves a scheduled change (rule 6).
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'update' });
      const row = await this.lockBranch(tx, branchId);
      requirePermission(actor, 'branch.hours.edit', branchId);
      const now = writableAt(tenant);
      assertCurrent(row, input.updatedAt);
      const previousEnd = timeOf(row.businessDayEndsAt);
      if (input.businessDayEndsAt !== previousEnd) {
        // The upcoming exceptions must still fit the new business day, from the earlier of the
        // two business dates: a later end can make yesterday's date current again. One that would
        // not fit refuses the move; the exception is never rewritten (owner, 2026-10-20).
        const before = businessDateOf(now, previousEnd);
        const after = businessDateOf(now, input.businessDayEndsAt);
        const from = before < after ? before : after;
        for (const exception of await this.exceptionsFrom(tx, row.id, from)) {
          try {
            validateHourException(exception, input.businessDayEndsAt);
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            throw new DomainError('INVALID_HOURS', 'An exception does not fit the new day end', {
              exceptionId: exception.id,
              date: exception.date,
            });
          }
        }
      }
      const before = sortPeriods(
        (await tx.select().from(branchHours).where(eq(branchHours.branchId, row.id))).map(
          toWeeklyPeriod,
        ),
      );
      await tx.delete(branchHours).where(eq(branchHours.branchId, row.id));
      if (input.periods.length > 0) {
        await tx.insert(branchHours).values(
          input.periods.map((period) => ({
            tenantId: actor.tenantId,
            branchId: row.id,
            ...period,
          })),
        );
      }
      const updatedAt = nextUpdatedAt(row, now);
      await tx
        .update(branches)
        .set({ businessDayEndsAt: input.businessDayEndsAt, updatedAt })
        .where(eq(branches.id, row.id));
      const after = sortPeriods(input.periods);
      await audit(tx, actor.tenantId, actor, {
        action: 'branch_hours.replaced',
        entityType: 'branch',
        entityId: row.id,
        details: {
          before: { businessDayEndsAt: previousEnd, periods: before },
          after: { businessDayEndsAt: input.businessDayEndsAt, periods: after },
        },
      });
      await emit(tx, actor.tenantId, 'branch.settings_changed.v1', {
        tenantId: actor.tenantId,
        branchId: row.id,
        part: 'hours',
      });
      if (input.businessDayEndsAt !== previousEnd) {
        await this.rescheduleStatusChange(tx, actor, tenant, row.id, now);
      }
      return {
        businessDayEndsAt: input.businessDayEndsAt,
        periods: after,
        updatedAt: updatedAt.toISOString(),
      };
    });
  }

  async createHourException(
    actor: StaffActor,
    branchId: string,
    input: CreateHourException,
  ): Promise<HourException> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      requirePermission(actor, 'branch.hours.edit', branchId);
      const now = writableAt(tenant);
      const dayEnd = timeOf(row.businessDayEndsAt);
      assertNotPast(input.date, dayEnd, now);
      validateHourException(input, dayEnd);
      const inserted = await tx
        .insert(branchHourExceptions)
        .values({
          tenantId: actor.tenantId,
          branchId: row.id,
          date: input.date,
          closed: input.closed,
          periods: input.periods,
          note: input.note ?? null,
        })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'branch_hour_exceptions_date_idx')) {
            throw new DomainError('CONFLICT', 'The date already has an exception');
          }
          throw error;
        });
      const exception = inserted[0];
      if (!exception) throw new Error('No exception inserted');
      await audit(tx, actor.tenantId, actor, {
        action: 'branch_hour_exception.created',
        entityType: 'branch_hour_exception',
        entityId: exception.id,
        details: { after: { date: input.date, closed: input.closed, periods: input.periods } },
      });
      await this.exceptionsChanged(tx, actor.tenantId, row.id);
      return toHourException(exception);
    });
  }

  async updateHourException(
    actor: StaffActor,
    branchId: string,
    exceptionId: string,
    input: UpdateHourException,
  ): Promise<HourException> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      requirePermission(actor, 'branch.hours.edit', branchId);
      const exception = await this.lockException(tx, row.id, exceptionId);
      const now = writableAt(tenant);
      assertCurrent(exception, input.updatedAt);
      const dayEnd = timeOf(row.businessDayEndsAt);
      assertNotPast(exception.date, dayEnd, now);
      validateHourException(input, dayEnd);
      const [updated] = await tx
        .update(branchHourExceptions)
        .set({
          closed: input.closed,
          periods: input.periods,
          note: input.note,
          updatedAt: nextUpdatedAt(exception, now),
        })
        .where(eq(branchHourExceptions.id, exception.id))
        .returning();
      if (!updated) throw new Error('No exception updated');
      await audit(tx, actor.tenantId, actor, {
        action: 'branch_hour_exception.updated',
        entityType: 'branch_hour_exception',
        entityId: exception.id,
        details: {
          before: { closed: exception.closed, periods: exception.periods },
          after: { closed: input.closed, periods: input.periods },
        },
      });
      await this.exceptionsChanged(tx, actor.tenantId, row.id);
      return toHourException(updated);
    });
  }

  /** Removing an exception archives it (rule 13); a past one is kept as it is. */
  async archiveHourException(actor: StaffActor, branchId: string, exceptionId: string) {
    await withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      requirePermission(actor, 'branch.hours.edit', branchId);
      const exception = await this.lockException(tx, row.id, exceptionId);
      const now = writableAt(tenant);
      assertNotPast(exception.date, timeOf(row.businessDayEndsAt), now);
      await tx
        .update(branchHourExceptions)
        .set({ archivedAt: now, updatedAt: nextUpdatedAt(exception, now) })
        .where(eq(branchHourExceptions.id, exception.id));
      await audit(tx, actor.tenantId, actor, {
        action: 'branch_hour_exception.archived',
        entityType: 'branch_hour_exception',
        entityId: exception.id,
      });
      await this.exceptionsChanged(tx, actor.tenantId, row.id);
    });
  }

  /**
   * Replaces the charge lines (rule 15): lines are edited in place by position, extra ones
   * archived, new ones added; orders keep their own snapshot (ADR 0007). The answer carries the
   * branch's new `updatedAt`, so the client's next write needs no read back (S01 rule 16).
   */
  async replaceCharges(
    actor: StaffActor,
    branchId: string,
    input: ReplaceBranchCharges,
  ): Promise<BranchCharges> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const tenant = await readTenant(tx, actor.tenantId, { lock: 'share' });
      const row = await this.lockBranch(tx, branchId);
      requirePermission(actor, 'branch.settings.edit', branchId);
      const now = writableAt(tenant);
      assertCurrent(row, input.updatedAt);
      const existing = await this.currentCharges(tx, row.id);
      const result: BranchCharge[] = [];
      for (const [index, line] of input.lines.entries()) {
        const values = {
          kind: line.kind,
          nameAr: line.nameAr,
          nameLatin: line.nameLatin ?? null,
          rateBp: line.rateBp,
          mode: line.mode,
          salesChannels: line.salesChannels,
          position: index + 1,
        };
        const current = existing[index];
        const [saved] = current
          ? await tx
              .update(branchCharges)
              .set({ ...values, updatedAt: nextUpdatedAt(current, now) })
              .where(eq(branchCharges.id, current.id))
              .returning()
          : await tx
              .insert(branchCharges)
              .values({ tenantId: actor.tenantId, branchId: row.id, ...values })
              .returning();
        if (!saved) throw new Error('No charge line saved');
        result.push(toCharge(saved));
      }
      for (const extra of existing.slice(input.lines.length)) {
        await tx
          .update(branchCharges)
          .set({ archivedAt: now, updatedAt: nextUpdatedAt(extra, now) })
          .where(eq(branchCharges.id, extra.id));
      }
      const updatedAt = nextUpdatedAt(row, now);
      await tx.update(branches).set({ updatedAt }).where(eq(branches.id, row.id));
      await audit(tx, actor.tenantId, actor, {
        action: 'branch_charges.replaced',
        entityType: 'branch',
        entityId: row.id,
        details: { before: existing.map(toCharge), after: result },
      });
      await emit(tx, actor.tenantId, 'branch.settings_changed.v1', {
        tenantId: actor.tenantId,
        branchId: row.id,
        part: 'charges',
      });
      return { lines: result, updatedAt: updatedAt.toISOString() };
    });
  }

  /** Rule 20: a pasted map link, resolved under the tenant's rate limit. */
  async resolveMapLink(actor: StaffActor, url: string): Promise<Coordinates> {
    requirePermission(actor, 'tenant.view');
    this.mapLinks.take(actor.tenantId);
    return this.resolver.resolve(url);
  }

  // The console and the CLI.

  /**
   * The console's list. The status filter is on the status in force (rule 7), as the list shows
   * it: a suspension the job has not written yet already counts as suspended. Slugs come in the
   * same query; branch counts take one count per tenant, inside its `withTenant` (RLS).
   */
  async listTenants(query: ListConsoleTenantsQuery): Promise<ConsoleTenantPage> {
    const now = new Date();
    const filters: SQL[] = [];
    if (query.status) {
      filters.push(
        sql`(case when ${tenants.scheduledStatus} is not null and ${tenants.scheduledStatusAt} <= ${now} then ${tenants.scheduledStatus} else ${tenants.status} end) = ${query.status}`,
      );
    }
    if (query.q) {
      const pattern = likePattern(query.q);
      const condition = or(
        ilike(tenants.nameAr, pattern),
        ilike(tenants.nameLatin, pattern),
        exists(
          this.db
            .select({ id: tenantSlugs.id })
            .from(tenantSlugs)
            .where(
              and(eq(tenantSlugs.subjectTenantId, tenants.id), ilike(tenantSlugs.slug, pattern)),
            ),
        ),
      );
      if (condition) filters.push(condition);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const sortColumn = query.sort === 'nameAr' ? tenants.nameAr : tenants.createdAt;
    const direction = query.order === 'desc' ? desc : asc;
    const rows = await this.db
      .select({ tenant: tenants, slug: tenantSlugs.slug })
      .from(tenants)
      .innerJoin(
        tenantSlugs,
        and(eq(tenantSlugs.subjectTenantId, tenants.id), eq(tenantSlugs.isPrimary, true)),
      )
      .where(where)
      .orderBy(direction(sortColumn), direction(tenants.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db.select({ total: count() }).from(tenants).where(where);
    const items = [];
    for (const { tenant, slug } of rows) {
      const branchCount = await withTenant(this.db, tenant.id, async (tx) => {
        const [result] = await tx
          .select({ branches: count() })
          .from(branches)
          .where(isNull(branches.archivedAt));
        return result?.branches ?? 0;
      });
      items.push(consoleTenantView(tenant, slug, branchCount, now));
    }
    return { items, total: total?.total ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async getConsoleTenant(tenantId: string): Promise<ConsoleTenantDetail> {
    return withTenant(this.db, tenantId, async (tx) =>
      this.consoleDetail(tx, await readTenant(tx, tenantId), new Date()),
    );
  }

  /** Rule 1: a tenant with its slug and first branches, in onboarding. */
  async createTenant(
    operator: PlatformOperator,
    input: CreateTenant,
  ): Promise<ConsoleTenantDetail> {
    assertSlugAllowed(input.slug);
    const tenantId = uuidv7();
    return withTenant(this.db, tenantId, async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(tenants)
        .values({
          id: tenantId,
          nameAr: input.nameAr,
          nameLatin: input.nameLatin ?? null,
          defaultCurrency: input.defaultCurrency,
          statusChangedAt: now,
        })
        .returning();
      if (!row) throw new Error('No tenant inserted');
      await this.insertSlug(tx, tenantId, input.slug);
      await audit(tx, tenantId, operator, {
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: tenantId,
        reason: input.note ?? null,
        details: { slug: input.slug },
      });
      await emit(tx, tenantId, 'tenant.created.v1', { tenantId });
      // The first branches precede any agreement: no limit applies to them (S05 rule 21).
      for (const branch of input.branches) {
        await this.insertBranch(tx, operator, tenantId, input.defaultCurrency, branch, null, {
          limit: false,
        });
      }
      await this.owners.addFirstOwner(tx, tenantId, input.owner, operator);
      return this.consoleDetail(tx, row, now);
    });
  }

  /** Rule 10: the new slug becomes primary; the old one stays an alias forever. */
  async setSlug(
    operator: PlatformOperator,
    tenantId: string,
    slug: string,
  ): Promise<ConsoleTenantDetail> {
    assertSlugAllowed(slug);
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await readTenant(tx, tenantId, { lock: 'update' });
      const now = new Date();
      if (effectiveStatus(statusState(row), now) === 'closed') {
        throw new DomainError('TENANT_CLOSED', 'The tenant is closed');
      }
      const previous = await primarySlug(tx, tenantId);
      await tx
        .update(tenantSlugs)
        .set({ isPrimary: false })
        .where(and(eq(tenantSlugs.subjectTenantId, tenantId), eq(tenantSlugs.isPrimary, true)));
      await this.insertSlug(tx, tenantId, slug);
      await audit(tx, tenantId, operator, {
        action: 'tenant.slug_changed',
        entityType: 'tenant',
        entityId: tenantId,
        details: { from: previous, to: slug },
      });
      return this.consoleDetail(tx, row, now);
    });
  }

  /** The status lifecycle (spec S01, "Tenant status"), or cancelling a scheduled change. */
  async changeStatus(
    operator: PlatformOperator,
    tenantId: string,
    request: TenantStatusRequest,
  ): Promise<ConsoleTenantDetail> {
    return withTenant(this.db, tenantId, async (tx) => {
      const locked = await readTenant(tx, tenantId, { lock: 'update' });
      const now = new Date();
      const row = await this.applyDueSchedule(tx, locked, now);
      const note = request.note ?? null;
      if ('cancelScheduled' in request) {
        if (!row.scheduledStatus) {
          throw new DomainError('INVALID_STATUS_TRANSITION', 'No scheduled change to cancel');
        }
        const [updated] = await tx
          .update(tenants)
          .set({
            scheduledStatus: null,
            scheduledStatusReason: null,
            scheduledStatusAt: null,
            updatedAt: nextUpdatedAt(row, now),
          })
          .where(eq(tenants.id, tenantId))
          .returning();
        if (!updated) throw new Error('No tenant updated');
        await audit(tx, tenantId, operator, {
          action: 'tenant.status_schedule_cancelled',
          entityType: 'tenant',
          entityId: tenantId,
          reason: note,
          details: { status: row.scheduledStatus, at: row.scheduledStatusAt?.toISOString() },
        });
        return this.consoleDetail(tx, updated, now);
      }
      const dayEnds = (await activeBranches(tx)).map((branch) => timeOf(branch.businessDayEndsAt));
      const plan = planTenantStatusChange(
        { ...statusState(row), onboardingCompletedAt: row.onboardingCompletedAt },
        request,
        now,
        dayEnds,
      );
      if (plan.kind === 'scheduled') {
        const [updated] = await tx
          .update(tenants)
          .set({
            scheduledStatus: plan.status,
            scheduledStatusReason: plan.reason,
            scheduledStatusAt: plan.at,
            updatedAt: nextUpdatedAt(row, now),
          })
          .where(eq(tenants.id, tenantId))
          .returning();
        if (!updated) throw new Error('No tenant updated');
        await audit(tx, tenantId, operator, {
          action: 'tenant.status_scheduled',
          entityType: 'tenant',
          entityId: tenantId,
          reason: note,
          details: {
            status: plan.status,
            reason: plan.reason,
            at: plan.at.toISOString(),
            replaced: row.scheduledStatus,
          },
        });
        await emit(tx, tenantId, 'tenant.status_scheduled.v1', { tenantId, status: plan.status });
        return this.consoleDetail(tx, updated, now);
      }
      // S05 rule 9: a tenant is activated only with an agreement in force.
      if (plan.status === 'active') {
        await this.entitlements.assertAgreementInForce(tx, tenantId, now);
      }
      const updated = await this.writeStatus(tx, row, plan.status, plan.reason, now);
      await audit(tx, tenantId, operator, {
        action: 'tenant.status_changed',
        entityType: 'tenant',
        entityId: tenantId,
        reason: note,
        details: { from: row.status, to: plan.status, reason: plan.reason },
      });
      await emit(tx, tenantId, 'tenant.status_changed.v1', {
        tenantId,
        from: row.status as Tenant['status'],
        to: plan.status,
      });
      return this.consoleDetail(tx, updated, now);
    });
  }

  /** Rule 2: Vertex staff only. */
  async createBranch(
    operator: PlatformOperator,
    tenantId: string,
    input: CreateBranch,
  ): Promise<Branch> {
    return withTenant(this.db, tenantId, async (tx) => {
      // Shared: a closure waits for the new branch, and the branch for a closure.
      const row = await readTenant(tx, tenantId, { lock: 'share' });
      if (effectiveStatus(statusState(row), new Date()) === 'closed') {
        throw new DomainError('TENANT_CLOSED', 'The tenant is closed');
      }
      return this.insertBranch(tx, operator, tenantId, row.defaultCurrency, input, null, {
        limit: true,
      });
    });
  }

  /**
   * Rule 2: never the last non-archived branch (`LAST_ACTIVE_BRANCH`), nor one with an active PC
   * (`BRANCH_HAS_DEVICES`, spec S02 rule 21), nor the only branch of an active member
   * (`BRANCH_HAS_MEMBERS`, spec S02 edge case 6); archiving twice is a no-op. The tenant row is
   * locked first, as staff writes lock it, so no member is given the branch meanwhile.
   */
  async archiveBranch(
    operator: PlatformOperator,
    tenantId: string,
    branchId: string,
    note: string | undefined,
  ): Promise<Branch> {
    return withTenant(this.db, tenantId, async (tx) => {
      await readTenant(tx, tenantId, { lock: 'update' });
      const [row] = await tx.select().from(branches).where(eq(branches.id, branchId)).for('update');
      if (!row) throw branchNotFound();
      if (row.archivedAt) return toBranch(row);
      const active = await activeBranches(tx);
      if (active.length <= 1) {
        throw new DomainError('LAST_ACTIVE_BRANCH', 'The last branch cannot be archived');
      }
      await this.devices.assertNoActiveDevices(tx, row.id);
      await this.members.assertBranchNotSoleScope(tx, row.id);
      const now = new Date();
      const [archived] = await tx
        .update(branches)
        .set({ archivedAt: now, updatedAt: nextUpdatedAt(row, now) })
        .where(eq(branches.id, row.id))
        .returning();
      if (!archived) throw new Error('No branch archived');
      await audit(tx, tenantId, operator, {
        action: 'branch.archived',
        entityType: 'branch',
        entityId: row.id,
        reason: note ?? null,
      });
      await emit(tx, tenantId, 'branch.archived.v1', { tenantId, branchId: row.id });
      return toBranch(archived);
    });
  }

  // Shared steps.

  /** The tenant row locked for update, with the time of the write (`writableAt`). */
  private async writableTenant(
    tx: Transaction,
    tenantId: string,
  ): Promise<{ row: TenantRow; now: Date }> {
    const row = await readTenant(tx, tenantId, { lock: 'update' });
    return { row, now: writableAt(row) };
  }

  /** The branch locked for a change; archived branches are not changed. */
  private async lockBranch(tx: Transaction, branchId: string): Promise<BranchRow> {
    const [row] = await tx
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)))
      .for('update');
    if (!row) throw branchNotFound();
    return row;
  }

  private async lockException(tx: Transaction, branchId: string, exceptionId: string) {
    const [row] = await tx
      .select()
      .from(branchHourExceptions)
      .where(
        and(
          eq(branchHourExceptions.id, exceptionId),
          eq(branchHourExceptions.branchId, branchId),
          isNull(branchHourExceptions.archivedAt),
        ),
      )
      .for('update');
    if (!row) throw new DomainError('NOT_FOUND', 'No such exception');
    return row;
  }

  private upcomingExceptions(tx: Transaction, row: BranchRow, now: Date) {
    return this.exceptionsFrom(tx, row.id, businessDateOf(now, timeOf(row.businessDayEndsAt)));
  }

  /** The branch's exceptions in use from the business date `from` on. */
  private exceptionsFrom(tx: Transaction, branchId: string, from: string) {
    return tx
      .select()
      .from(branchHourExceptions)
      .where(
        and(
          eq(branchHourExceptions.branchId, branchId),
          isNull(branchHourExceptions.archivedAt),
          gte(branchHourExceptions.date, from),
        ),
      )
      .orderBy(asc(branchHourExceptions.date))
      .then((rows) => rows.map(toHourException));
  }

  private currentCharges(tx: Transaction, branchId: string) {
    return tx
      .select()
      .from(branchCharges)
      .where(and(eq(branchCharges.branchId, branchId), isNull(branchCharges.archivedAt)))
      .orderBy(asc(branchCharges.position), asc(branchCharges.createdAt));
  }

  private async branchDetail(tx: Transaction, row: BranchRow, now: Date): Promise<BranchDetail> {
    const hours = await tx.select().from(branchHours).where(eq(branchHours.branchId, row.id));
    return {
      branch: toBranch(row),
      hours: sortPeriods(hours.map(toWeeklyPeriod)),
      exceptions: await this.upcomingExceptions(tx, row, now),
      charges: (await this.currentCharges(tx, row.id)).map(toCharge),
    };
  }

  private exceptionsChanged(tx: Transaction, tenantId: string, branchId: string) {
    return emit(tx, tenantId, 'branch.settings_changed.v1', {
      tenantId,
      branchId,
      part: 'exceptions',
    });
  }

  private async insertSlug(tx: Transaction, tenantId: string, slug: string): Promise<void> {
    await tx
      .insert(tenantSlugs)
      .values({ slug, subjectTenantId: tenantId, isPrimary: true })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'tenant_slugs_slug_unique')) {
          throw new DomainError('SLUG_TAKEN', 'The slug is or was used by a tenant');
        }
        throw error;
      });
  }

  private async insertBranch(
    tx: Transaction,
    operator: PlatformOperator,
    tenantId: string,
    tenantCurrency: string,
    input: CreateBranch,
    note: string | null,
    options: { limit: boolean },
  ): Promise<Branch> {
    if (options.limit) await this.entitlements.assertBranchFits(tx, tenantId);
    const defaultCurrency = input.defaultCurrency ?? tenantCurrency;
    const inserted = await tx
      .insert(branches)
      .values({
        tenantId,
        nameAr: input.nameAr,
        nameLatin: input.nameLatin ?? null,
        code: input.code,
        defaultCurrency,
        acceptedCurrencies: [defaultCurrency],
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'branches_tenant_code_unique')) {
          throw new DomainError('CONFLICT', 'The branch code is taken');
        }
        if (isUniqueViolation(error, 'branches_tenant_name_ar_idx')) {
          throw new DomainError('CONFLICT', 'Another branch has this name');
        }
        throw error;
      });
    const row = inserted[0];
    if (!row) throw new Error('No branch inserted');
    await audit(tx, tenantId, operator, {
      action: 'branch.created',
      entityType: 'branch',
      entityId: row.id,
      reason: note,
      details: { code: row.code },
    });
    await emit(tx, tenantId, 'branch.created.v1', { tenantId, branchId: row.id });
    await this.entitlements.branchCreated(tx, tenantId, row.id);
    return toBranch(row);
  }

  /**
   * Writes a due scheduled change before any other status change, as the worker's job would
   * (rule 7), so the row reflects the status in force.
   */
  private async applyDueSchedule(tx: Transaction, row: TenantRow, now: Date): Promise<TenantRow> {
    const state = statusState(row);
    if (!isScheduleDue(state, now) || !row.scheduledStatusAt) return row;
    const due = effectiveStatusState(state, now);
    const updated = await this.writeStatus(
      tx,
      row,
      due.status,
      due.statusReason,
      row.scheduledStatusAt,
    );
    await audit(tx, row.id, SCHEDULE_ACTOR, {
      action: 'tenant.status_changed',
      entityType: 'tenant',
      entityId: row.id,
      details: { from: row.status, to: due.status, reason: due.statusReason, scheduled: true },
    });
    await emit(tx, row.id, 'tenant.status_changed.v1', {
      tenantId: row.id,
      from: row.status as Tenant['status'],
      to: due.status,
    });
    return updated;
  }

  /**
   * A branch's business day end changed while a suspension or closure is scheduled (rule 6, owner
   * 2026-10-19): the change moves to the tenant's next business day end under the new ends,
   * audited, with `tenant.status_scheduled.v1` again. The tenant row is locked for update and the
   * branch already holds its new end; a schedule already due never reaches here (`writableAt`).
   */
  private async rescheduleStatusChange(
    tx: Transaction,
    actor: StaffActor,
    tenant: TenantRow,
    branchId: string,
    now: Date,
  ): Promise<void> {
    const { scheduledStatus, scheduledStatusAt } = tenant;
    if (!scheduledStatus || !scheduledStatusAt) return;
    const dayEnds = (await activeBranches(tx)).map((branch) => timeOf(branch.businessDayEndsAt));
    const at = nextBusinessDayEnd(now, dayEnds);
    if (at.getTime() === scheduledStatusAt.getTime()) return;
    await tx
      .update(tenants)
      .set({ scheduledStatusAt: at, updatedAt: nextUpdatedAt(tenant, now) })
      .where(eq(tenants.id, tenant.id));
    await audit(tx, tenant.id, actor, {
      action: 'tenant.status_rescheduled',
      entityType: 'tenant',
      entityId: tenant.id,
      details: {
        status: scheduledStatus,
        from: scheduledStatusAt.toISOString(),
        to: at.toISOString(),
        branchId,
      },
    });
    await emit(tx, tenant.id, 'tenant.status_scheduled.v1', {
      tenantId: tenant.id,
      status: scheduledStatus as ScheduledTenantStatus,
    });
  }

  /** Sets a status now in force: clears any scheduled change, activation and closure dates. */
  private async writeStatus(
    tx: Transaction,
    row: TenantRow,
    status: Tenant['status'],
    reason: Tenant['statusReason'],
    at: Date,
  ): Promise<TenantRow> {
    const [updated] = await tx
      .update(tenants)
      .set({
        status,
        statusReason: status === 'suspended' || status === 'closed' ? reason : null,
        statusChangedAt: at,
        scheduledStatus: null,
        scheduledStatusReason: null,
        scheduledStatusAt: null,
        activatedAt: status === 'active' ? (row.activatedAt ?? at) : row.activatedAt,
        closedAt: status === 'closed' ? at : null,
        archivedAt: status === 'closed' ? at : null,
        updatedAt: nextUpdatedAt(row),
      })
      .where(eq(tenants.id, row.id))
      .returning();
    if (!updated) throw new Error('No tenant updated');
    // Spec S02 rule 37: no staff session or registered PC outlives the closure.
    if (status === 'closed') await this.devices.closeAccess(tx, row.id, at);
    return updated;
  }

  private async consoleDetail(
    tx: Transaction,
    row: TenantRow,
    now: Date,
  ): Promise<ConsoleTenantDetail> {
    const slugs = await tx
      .select()
      .from(tenantSlugs)
      .where(eq(tenantSlugs.subjectTenantId, row.id))
      .orderBy(asc(tenantSlugs.createdAt));
    const branchRows = await tx.select().from(branches).orderBy(asc(branches.createdAt));
    const primary = slugs.find((slug) => slug.isPrimary)?.slug;
    if (!primary) throw new Error('A tenant without a primary slug');
    return {
      tenant: consoleTenantView(
        row,
        primary,
        branchRows.filter((branch) => !branch.archivedAt).length,
        now,
      ),
      slugs: slugs.map((slug) => ({
        slug: slug.slug,
        isPrimary: slug.isPrimary,
        createdAt: slug.createdAt.toISOString(),
      })),
      branches: branchRows.map(toBranch),
    };
  }
}

/**
 * The time of a write, read after every lock it takes, once the status in force at that time lets
 * the tenant write (rules 8, 9). Lock order of every tenancy write: the tenant row (`update` when
 * it changes, `share` otherwise), then the branch, then the exception. A write that waited behind
 * a status change, or past a scheduled suspension, is checked against the status when it proceeds.
 */
function writableAt(tenant: TenantRow): Date {
  const now = new Date();
  assertTenantWritable(effectiveStatus(statusState(tenant), now));
  return now;
}

/** A business date before today's cannot be given an exception or changed (rule 13). */
function assertNotPast(date: string, businessDayEndsAt: TimeOfDay, now: Date): void {
  if (date < businessDateOf(now, businessDayEndsAt)) {
    throw new DomainError('INVALID_HOURS', 'The date is in the past', { date });
  }
}

function pick(branch: Branch, keys: readonly string[]): Record<string, unknown> {
  const record = branch as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}
