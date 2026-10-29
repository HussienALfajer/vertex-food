import { Inject, Injectable } from '@nestjs/common';
import {
  branchEntitlementsCopy,
  type EntitlementInputs,
  featureCatalog,
  type OverrideKind,
  type OverrideRecord,
  type ResolvedEntitlements,
  resolveEntitlements,
  sameEntitlements,
} from '@vertex-food/contracts';
import {
  branchEntitlements,
  branches,
  type Database,
  devices,
  entitlementOverrideRevocations,
  entitlementOverrides,
  entitlementStates,
  staffMemberships,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { asc, count, eq, isNull, ne } from 'drizzle-orm';
import { nextUpdatedAt } from '../../../core/concurrency/updated-at.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { emit } from '../../../core/events/outbox.js';
import { activeBranches } from '../tenancy/index.js';
import { AGREEMENT_RECORDS, type AgreementRecords } from './ports.js';

export type StateRow = typeof entitlementStates.$inferSelect;

/** A state is due once its next boundary has come (rule 17). */
const isDue = (row: StateRow, now: Date) =>
  row.validUntil !== null && row.validUntil.getTime() <= now.getTime();

export const resolvedOf = (row: StateRow) => row.resolved as ResolvedEntitlements;

/**
 * The resolved entitlements of each tenant (spec S05 rules 15–19, 21): one `entitlement_states`
 * row, recomputed in the transaction of every write that changes its inputs, by a read that finds
 * it due, and by the boundary job; every change of the result moves `version`, rewrites each
 * non-archived branch's copy and writes `entitlements.changed.v1`. The row is also the lock that
 * serializes additions at a limit. Lock order: the tenant or agreement row first, then this one.
 */
@Injectable()
export class EntitlementStates {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AGREEMENT_RECORDS) private readonly agreements: AgreementRecords,
  ) {}

  /** The resolver's inputs: the agreement's terms and the tenant's overrides. */
  async inputs(tx: Transaction, tenantId: string): Promise<EntitlementInputs> {
    return {
      catalog: featureCatalog,
      agreement: await this.agreements.read(tx, tenantId),
      overrides: await this.overrides(tx, tenantId),
    };
  }

  /** The tenant's overrides with their revocations, oldest first. */
  async overrides(tx: Transaction, tenantId: string): Promise<OverrideRecord[]> {
    const rows = await tx
      .select({
        override: entitlementOverrides,
        revokedAt: entitlementOverrideRevocations.revokedAt,
      })
      .from(entitlementOverrides)
      .leftJoin(
        entitlementOverrideRevocations,
        eq(entitlementOverrideRevocations.overrideId, entitlementOverrides.id),
      )
      .where(eq(entitlementOverrides.subjectTenantId, tenantId))
      .orderBy(asc(entitlementOverrides.id));
    return rows.map(({ override, revokedAt }) => ({
      id: override.id,
      kind: override.kind as OverrideKind,
      featureKey: override.featureKey,
      limitKey: override.limitKey,
      value: override.value,
      startsAt: override.startsAt,
      expiresAt: override.expiresAt,
      revokedAt,
    }));
  }

  /**
   * The state at `now` for a read (rule 17): the stored one while it holds, else recomputed and
   * written in its own short transaction first, so enforcement never waits for the job.
   */
  async current(tenantId: string, now: Date): Promise<StateRow> {
    const [row] = await this.db
      .select()
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, tenantId));
    if (row && !isDue(row, now)) return row;
    return withTenant(this.db, tenantId, (tx) => this.lock(tx, tenantId, now));
  }

  /**
   * The state locked for the rest of the transaction, created or recomputed first when missing or
   * due. A first state is inserted with `ON CONFLICT DO NOTHING` before the lock, so two first
   * writers wait for each other instead of both passing (rule 21).
   */
  async lock(tx: Transaction, tenantId: string, now = new Date()): Promise<StateRow> {
    const row = await this.locked(tx, tenantId);
    if (row && !isDue(row, now)) return row;
    return this.refresh(tx, tenantId, row, now);
  }

  /** After a write that changed the inputs, in its transaction (rules 10, 18). */
  async recompute(tx: Transaction, tenantId: string, now: Date): Promise<StateRow> {
    return this.refresh(tx, tenantId, await this.locked(tx, tenantId), now);
  }

  /** A new branch's copy of the state, in the transaction that creates it (rule 18). */
  async copyToBranch(tx: Transaction, tenantId: string, branchId: string): Promise<void> {
    await this.writeCopy(tx, tenantId, branchId, await this.lock(tx, tenantId));
  }

  /** What a limit counts now, in the tenant's transaction (spec S05, "Feature catalog"). */
  async usage(tx: Transaction, limit: string): Promise<number> {
    const counted = async (query: Promise<{ total: number }[]>) => (await query)[0]?.total ?? 0;
    switch (limit) {
      case 'branches':
        return counted(
          tx.select({ total: count() }).from(branches).where(isNull(branches.archivedAt)),
        );
      case 'devices':
        return counted(
          tx.select({ total: count() }).from(devices).where(ne(devices.status, 'revoked')),
        );
      case 'staff':
        return counted(
          tx
            .select({ total: count() })
            .from(staffMemberships)
            .where(eq(staffMemberships.status, 'active')),
        );
      // Catalog items (S07) and custom field definitions (S08) count from their specs on.
      default:
        return 0;
    }
  }

  private async locked(tx: Transaction, tenantId: string): Promise<StateRow | undefined> {
    const [row] = await tx
      .select()
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, tenantId))
      .for('update');
    return row;
  }

  private async refresh(
    tx: Transaction,
    tenantId: string,
    current: StateRow | undefined,
    now: Date,
  ): Promise<StateRow> {
    const resolved = resolveEntitlements(await this.inputs(tx, tenantId), now);
    let row = current;
    if (!row) {
      const [inserted] = await tx
        .insert(entitlementStates)
        .values({
          subjectTenantId: tenantId,
          version: 1,
          resolved,
          validUntil: resolved.validUntil ? new Date(resolved.validUntil) : null,
          computedAt: now,
        })
        .onConflictDoNothing({ target: entitlementStates.subjectTenantId })
        .returning();
      if (inserted) {
        await this.changed(tx, tenantId, inserted);
        return inserted;
      }
      // Another transaction wrote the first state meanwhile: continue from it, locked.
      row = await this.locked(tx, tenantId);
      if (!row) throw new Error('No entitlement state after a conflict');
    }
    const same = sameEntitlements(resolvedOf(row), resolved);
    const [updated] = await tx
      .update(entitlementStates)
      .set({
        version: same ? row.version : row.version + 1,
        resolved,
        validUntil: resolved.validUntil ? new Date(resolved.validUntil) : null,
        computedAt: now,
        updatedAt: nextUpdatedAt(row),
      })
      .where(eq(entitlementStates.id, row.id))
      .returning();
    if (!updated) throw new Error('No entitlement state updated');
    if (!same) await this.changed(tx, tenantId, updated);
    return updated;
  }

  /** Rule 18: every non-archived branch's copy and the event, with the state's new version. */
  private async changed(tx: Transaction, tenantId: string, row: StateRow): Promise<void> {
    for (const branch of await activeBranches(tx)) {
      await this.writeCopy(tx, tenantId, branch.id, row);
    }
    await emit(tx, tenantId, 'entitlements.changed.v1', { tenantId, version: row.version });
  }

  private async writeCopy(
    tx: Transaction,
    tenantId: string,
    branchId: string,
    row: StateRow,
  ): Promise<void> {
    const copy = { version: row.version, ...branchEntitlementsCopy(resolvedOf(row)) };
    await tx
      .insert(branchEntitlements)
      .values({ tenantId, branchId, ...copy, validUntil: row.validUntil })
      .onConflictDoUpdate({
        target: [branchEntitlements.tenantId, branchEntitlements.branchId],
        set: { ...copy, validUntil: row.validUntil, updatedAt: new Date() },
      });
  }
}
