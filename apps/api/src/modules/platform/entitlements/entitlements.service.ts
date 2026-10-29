import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  ENTITLEMENT_EXCEPTIONS_PAGE,
  type EntitlementException,
  type EntitlementOverride,
  type Entitlements,
  effectiveStatus,
  featureCatalog,
  type OverrideInput,
  planOverride,
  planRevocation,
  type ResolvedEntitlements,
  resolveEntitlements,
} from '@vertex-food/contracts';
import {
  type Database,
  entitlementExceptions,
  entitlementOverrideRevocations,
  entitlementOverrides,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { PlatformOperator, StaffActor } from '../../../core/access/actor.js';
import { audit, auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { databaseNow } from '../../../core/database/database-now.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { activeBranches, readTenant, statusState, timeOf } from '../tenancy/index.js';
import { EntitlementStates, resolvedOf } from './entitlement-states.js';
import { toException, toOverride, toRevocation } from './entitlements.views.js';
import { AGREEMENT_RECORDS, type AgreementRecords } from './ports.js';

const tenantClosed = () => new DomainError('TENANT_CLOSED', 'The tenant is closed');

/** Who made a change, in the columns of the platform's commercial tables. */
export function operatorColumns(operator: PlatformOperator) {
  return operator.kind === 'platform'
    ? { by: operator.userId, byOperator: null }
    : { by: null, byOperator: operator.name };
}

/** The `business_day_ends_at` of the tenant's non-archived branches (rules 7, 14). */
export async function businessDayEnds(tx: Transaction) {
  return (await activeBranches(tx)).map((branch) => timeOf(branch.businessDayEndsAt));
}

/**
 * Entitlements (spec S05): the resolved entitlements with usage for the console, the CLI and the
 * restaurant (rules 27, 28), the exceptions Vertex reads, and overrides with their revocations
 * (rules 12–14), each written with its platform and tenant audit entries and the recompute of the
 * tenant's state in one transaction.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EntitlementStates) private readonly states: EntitlementStates,
    @Inject(AGREEMENT_RECORDS) private readonly agreements: AgreementRecords,
  ) {}

  /** Rules 10, 18: after an approval changed the agreement, in its transaction. */
  async agreementChanged(tx: Transaction, tenantId: string, now: Date): Promise<void> {
    await this.states.recompute(tx, tenantId, now);
  }

  /** Rule 27: now, or at a chosen instant, with the usage now. */
  async forConsole(tenantId: string, at?: string): Promise<Entitlements> {
    await withTenant(this.db, tenantId, (tx) => readTenant(tx, tenantId));
    return this.read(tenantId, at ? new Date(at) : undefined);
  }

  /** The session's tenant now: any active member (no money in it). */
  forTenant(actor: StaffActor): Promise<Entitlements> {
    return this.read(actor.tenantId);
  }

  /** The resolved entitlements now, in the caller's tenant transaction ("My agreement"). */
  async resolvedNow(
    tenantId: string,
  ): Promise<{ version: number; resolved: ResolvedEntitlements }> {
    const now = new Date();
    const state = await this.states.current(tenantId, now);
    return { version: state.version, resolved: { ...resolvedOf(state), at: now.toISOString() } };
  }

  /** Each limit with what it counts now, in the tenant's transaction. */
  async withUsage(tx: Transaction, version: number, resolved: ResolvedEntitlements) {
    const limits = [];
    for (const limit of resolved.limits) {
      limits.push({ ...limit, usage: await this.states.usage(tx, limit.key) });
    }
    return {
      version,
      at: resolved.at,
      features: resolved.features,
      limits,
      validUntil: resolved.validUntil,
    };
  }

  /** Rule 27: newest first, 50 a page. */
  async exceptions(
    tenantId: string,
    before: string | undefined,
  ): Promise<{ items: EntitlementException[]; nextBefore: string | null }> {
    return withTenant(this.db, tenantId, async (tx) => {
      await readTenant(tx, tenantId);
      const rows = await tx
        .select()
        .from(entitlementExceptions)
        .where(
          and(
            eq(entitlementExceptions.subjectTenantId, tenantId),
            before ? lt(entitlementExceptions.id, before) : undefined,
          ),
        )
        .orderBy(desc(entitlementExceptions.id))
        .limit(ENTITLEMENT_EXCEPTIONS_PAGE);
      const last = rows.at(-1);
      return {
        items: rows.map(toException),
        nextBefore: rows.length === ENTITLEMENT_EXCEPTIONS_PAGE && last ? last.id : null,
      };
    });
  }

  /** The tenant's overrides with their revocations, oldest first, in its transaction. */
  async overrideViews(tx: Transaction, tenantId: string): Promise<EntitlementOverride[]> {
    const rows = await tx
      .select({ override: entitlementOverrides, revocation: entitlementOverrideRevocations })
      .from(entitlementOverrides)
      .leftJoin(
        entitlementOverrideRevocations,
        eq(entitlementOverrideRevocations.overrideId, entitlementOverrides.id),
      )
      .where(eq(entitlementOverrides.subjectTenantId, tenantId))
      .orderBy(asc(entitlementOverrides.id));
    return rows.map(({ override, revocation }) => toOverride(override, revocation));
  }

  /**
   * Rules 12–14: a grant, deny or limit with its reason and stored dates (removals pushed to the
   * next business day end), refused on a closed tenant and over another override of the slot. The
   * state row is locked first, so two overrides of a tenant are checked one after the other.
   */
  async createOverride(
    operator: PlatformOperator,
    tenantId: string,
    input: OverrideInput,
  ): Promise<EntitlementOverride> {
    return withTenant(this.db, tenantId, async (tx) => {
      const tenant = await readTenant(tx, tenantId, { lock: 'share' });
      const now = await databaseNow(tx);
      if (effectiveStatus(statusState(tenant), now) === 'closed') throw tenantClosed();
      await this.states.lock(tx, tenantId, now);
      const planned = planOverride(input, {
        catalog: featureCatalog,
        agreement: await this.agreements.read(tx, tenantId),
        overrides: await this.states.overrides(tx, tenantId),
        now,
        businessDayEnds: await businessDayEnds(tx),
      });
      const { by, byOperator } = operatorColumns(operator);
      const [row] = await tx
        .insert(entitlementOverrides)
        .values({
          subjectTenantId: tenantId,
          kind: input.kind,
          featureKey: input.kind === 'limit' ? null : input.featureKey,
          limitKey: input.kind === 'limit' ? input.limitKey : null,
          value: input.kind === 'limit' ? input.value : null,
          reason: input.reason,
          startsAt: planned.startsAt,
          expiresAt: planned.expiresAt,
          createdBy: by,
          createdByOperator: byOperator,
        })
        .returning();
      if (!row) throw new Error('No override inserted');
      const details = {
        kind: row.kind,
        featureKey: row.featureKey,
        limitKey: row.limitKey,
        value: row.value,
        startsAt: row.startsAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      };
      await auditPlatform(tx, operator, {
        action: 'entitlement_override.created',
        entityType: 'entitlement_override',
        entityId: row.id,
        reason: input.reason,
        details,
        subjectTenantId: tenantId,
      });
      await audit(tx, tenantId, operator, {
        action: 'entitlements.overridden',
        entityType: 'entitlement_override',
        entityId: row.id,
        details: { ...details, change: 'created' },
      });
      await this.states.recompute(tx, tenantId, now);
      return toOverride(row, null);
    });
  }

  /**
   * Rule 14: the revocation's effective time, at the next business day end when it removes
   * something (a grant, a raising limit), else now; once (`ALREADY_REVOKED`).
   */
  async revokeOverride(operator: PlatformOperator, overrideId: string, reason: string) {
    const [found] = await this.db
      .select({ tenantId: entitlementOverrides.subjectTenantId })
      .from(entitlementOverrides)
      .where(eq(entitlementOverrides.id, overrideId));
    if (!found) throw new DomainError('NOT_FOUND', 'No such override');
    const { tenantId } = found;
    return withTenant(this.db, tenantId, async (tx) => {
      const now = await databaseNow(tx);
      await this.states.lock(tx, tenantId, now);
      const record = (await this.states.overrides(tx, tenantId)).find(
        (override) => override.id === overrideId,
      );
      if (!record) throw new DomainError('NOT_FOUND', 'No such override');
      const revokedAt = planRevocation(record, {
        agreement: await this.agreements.read(tx, tenantId),
        now,
        businessDayEnds: await businessDayEnds(tx),
      });
      const { by, byOperator } = operatorColumns(operator);
      const [row] = await tx
        .insert(entitlementOverrideRevocations)
        .values({ overrideId, revokedAt, reason, revokedBy: by, revokedByOperator: byOperator })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'entitlement_override_revocations_override_unique')) {
            throw new DomainError('ALREADY_REVOKED', 'The override is already revoked');
          }
          throw error;
        });
      if (!row) throw new Error('No revocation inserted');
      const details = { revokedAt: revokedAt.toISOString() };
      await auditPlatform(tx, operator, {
        action: 'entitlement_override.revoked',
        entityType: 'entitlement_override',
        entityId: overrideId,
        reason,
        details,
        subjectTenantId: tenantId,
      });
      await audit(tx, tenantId, operator, {
        action: 'entitlements.overridden',
        entityType: 'entitlement_override',
        entityId: overrideId,
        details: { ...details, change: 'revoked' },
      });
      await this.states.recompute(tx, tenantId, now);
      return toRevocation(row);
    });
  }

  /** The state now (or the resolution at `at`), with the usage now. */
  private async read(tenantId: string, at?: Date): Promise<Entitlements> {
    const { version, resolved } = await this.resolvedNow(tenantId);
    return withTenant(this.db, tenantId, async (tx) => {
      const result = at
        ? resolveEntitlements(await this.states.inputs(tx, tenantId), at)
        : resolved;
      return this.withUsage(tx, version, result);
    });
  }
}
