import { Inject, Injectable } from '@nestjs/common';
import {
  type AgreementRecord,
  branchEntitlementsCopy,
  eventCatalog,
  featureCatalog,
  type OverrideKind,
  type ResolvedEntitlements,
  resolveEntitlements,
  sameEntitlements,
  type TermValues,
} from '@vertex-food/contracts';
import {
  agreements,
  agreementTermEndings,
  agreementTerms,
  and,
  asc,
  branchEntitlements,
  type Database,
  entitlementOverrideRevocations,
  entitlementOverrides,
  entitlementStates,
  eq,
  inArray,
  isNotNull,
  lte,
  outboxEvents,
  sql,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/** Tenants handled per run; the rest wait a minute. */
const BATCH = 100;

/**
 * Applies the scheduled boundaries of entitlements (spec S05 rule 19): every minute, each tenant
 * whose state's `valid_until` has come is recomputed in its own transaction, with its state row
 * locked, from its agreement's terms and its overrides. A changed result moves `version`, updates
 * the copies its branches already hold (the API writes a branch's copy when the state is first
 * made and when the branch is created; this role reads no branch) and writes
 * `entitlements.changed.v1`, so PCs learn the change through their stream within about a minute.
 * Reads never wait for it (rule 17). Safe twice: a state is recomputed only while still due, and
 * the same instant gives the same result. Runs as the jobs role.
 */
@Injectable()
export class ApplyBoundariesJob implements ScheduledJob {
  readonly queue = 'entitlements.apply-boundaries';
  readonly cron = '* * * * *';

  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  /** Recomputes what is due at `now`; answers how many tenants' entitlements changed. */
  async run(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: entitlementStates.id, tenantId: entitlementStates.subjectTenantId })
      .from(entitlementStates)
      .where(and(isNotNull(entitlementStates.validUntil), lte(entitlementStates.validUntil, now)))
      .orderBy(asc(entitlementStates.validUntil))
      .limit(BATCH);
    let changed = 0;
    for (const state of due) {
      if (await withTenant(this.db, state.tenantId, (tx) => this.apply(tx, state, now))) {
        changed += 1;
      }
    }
    return changed;
  }

  private async apply(
    tx: Transaction,
    state: { id: string; tenantId: string },
    now: Date,
  ): Promise<boolean> {
    // Still due once locked: a run or an API recompute that went first leaves nothing to do.
    const [row] = await tx
      .select()
      .from(entitlementStates)
      .where(and(eq(entitlementStates.id, state.id), lte(entitlementStates.validUntil, now)))
      .for('update');
    if (!row) return false;
    const resolved = resolveEntitlements(
      {
        catalog: featureCatalog,
        agreement: await agreementOf(tx, state.tenantId),
        overrides: await overridesOf(tx, state.tenantId),
      },
      now,
    );
    const same = sameEntitlements(row.resolved as ResolvedEntitlements, resolved);
    const version = same ? row.version : row.version + 1;
    const validUntil = resolved.validUntil ? new Date(resolved.validUntil) : null;
    await tx
      .update(entitlementStates)
      .set({
        version,
        resolved,
        validUntil,
        computedAt: now,
        updatedAt: sql`greatest(clock_timestamp(), ${entitlementStates.updatedAt} + interval '1 millisecond')`,
      })
      .where(eq(entitlementStates.id, row.id));
    if (same) return false;
    await tx
      .update(branchEntitlements)
      .set({ version, ...branchEntitlementsCopy(resolved), validUntil, updatedAt: now })
      .where(eq(branchEntitlements.tenantId, state.tenantId));
    await tx.insert(outboxEvents).values({
      tenantId: state.tenantId,
      type: 'entitlements.changed.v1',
      payload: eventCatalog['entitlements.changed.v1'].parse({ tenantId: state.tenantId, version }),
    });
    return true;
  }
}

/** The tenant's terms and endings, as the API's commercial module reads them. */
async function agreementOf(tx: Transaction, tenantId: string): Promise<AgreementRecord> {
  const [agreement] = await tx
    .select({ id: agreements.id })
    .from(agreements)
    .where(eq(agreements.subjectTenantId, tenantId));
  if (!agreement) return { terms: [], endings: [] };
  const terms = await tx
    .select()
    .from(agreementTerms)
    .where(eq(agreementTerms.agreementId, agreement.id))
    .orderBy(asc(agreementTerms.id));
  const endings =
    terms.length === 0
      ? []
      : await tx
          .select()
          .from(agreementTermEndings)
          .where(
            inArray(
              agreementTermEndings.termId,
              terms.map((term) => term.id),
            ),
          );
  return {
    terms: terms.map((term) => ({
      id: term.id,
      values: term.values as TermValues,
      effectiveFrom: term.effectiveFrom,
      effectiveTo: term.effectiveTo,
      dueOn: term.dueOn,
    })),
    endings: endings.map((ending) => ({ termId: ending.termId, endsAt: ending.endsAt })),
  };
}

async function overridesOf(tx: Transaction, tenantId: string) {
  const overrides = await tx
    .select()
    .from(entitlementOverrides)
    .where(eq(entitlementOverrides.subjectTenantId, tenantId))
    .orderBy(asc(entitlementOverrides.id));
  const revocations =
    overrides.length === 0
      ? []
      : await tx
          .select()
          .from(entitlementOverrideRevocations)
          .where(
            inArray(
              entitlementOverrideRevocations.overrideId,
              overrides.map((override) => override.id),
            ),
          );
  return overrides.map((override) => ({
    id: override.id,
    kind: override.kind as OverrideKind,
    featureKey: override.featureKey,
    limitKey: override.limitKey,
    value: override.value,
    startsAt: override.startsAt,
    expiresAt: override.expiresAt,
    revokedAt:
      revocations.find((revocation) => revocation.overrideId === override.id)?.revokedAt ?? null,
  }));
}
