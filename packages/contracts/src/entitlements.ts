import { z } from 'zod';
import {
  type AgreementRecord,
  entitlementKeySchema,
  type FeatureCatalog,
  isOverrideActive,
  type OverrideRecord,
  overrideEnd,
  termEnd,
  termsInForce,
  termValuesSchema,
} from './commercial.js';
import { DomainError } from './errors.js';
import { idSchema, instantSchema } from './primitives.js';
import { localDateSchema } from './time.js';

/**
 * Entitlements (spec S05, ADR 0013, 0036), platform layer: the one resolver every route and sync
 * command checks, from the agreement's terms and the overrides, with keys only (rule 16); the copy
 * a branch's PCs hold with its lease; the limit check.
 */

export const entitlementSourceSchema = z
  .enum(['override', 'agreement', 'default'])
  .meta({ id: 'EntitlementSource' });

export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;

export const resolvedFeatureSchema = z
  .object({
    key: entitlementKeySchema,
    on: z.boolean(),
    /** What decided it before dependencies; an entitled feature whose dependency is off is off. */
    source: entitlementSourceSchema,
    reason: z.enum(['dependency_missing']).nullable(),
    /** When a feature that is on is known to turn off. */
    until: instantSchema.nullable(),
  })
  .meta({ id: 'ResolvedFeature' });

export type ResolvedFeature = z.infer<typeof resolvedFeatureSchema>;

export const resolvedLimitSchema = z
  .object({
    key: entitlementKeySchema,
    /** Null: unlimited. */
    value: z.int().min(0).nullable(),
    source: entitlementSourceSchema,
  })
  .meta({ id: 'ResolvedLimit' });

export type ResolvedLimit = z.infer<typeof resolvedLimitSchema>;

/** What `entitlement_states.resolved` stores. */
export const resolvedEntitlementsSchema = z
  .object({
    at: instantSchema,
    features: z.array(resolvedFeatureSchema),
    limits: z.array(resolvedLimitSchema),
    /** The next boundary, when the result may change (rule 17); null when none is known. */
    validUntil: instantSchema.nullable(),
  })
  .meta({ id: 'ResolvedEntitlements' });

export type ResolvedEntitlements = z.infer<typeof resolvedEntitlementsSchema>;

export type EntitlementInputs = {
  catalog: FeatureCatalog;
  agreement: AgreementRecord;
  overrides: readonly OverrideRecord[];
};

type Resolution = {
  features: Map<string, { on: boolean; source: EntitlementSource; dependencyMissing: boolean }>;
  limits: Map<string, { value: number | null; source: EntitlementSource }>;
};

function activeOverride(
  overrides: readonly OverrideRecord[],
  t: Date,
  match: (override: OverrideRecord) => boolean,
): OverrideRecord | undefined {
  return overrides.find((override) => match(override) && isOverrideActive(override, t));
}

function resolveAt(inputs: EntitlementInputs, t: Date): Resolution {
  const { catalog, agreement, overrides } = inputs;
  const slots = termsInForce(agreement, t);
  const features: Resolution['features'] = new Map();
  for (const feature of catalog.features) {
    const forKey = (override: OverrideRecord) => override.featureKey === feature.key;
    const deny = activeOverride(overrides, t, (o) => forKey(o) && o.kind === 'deny');
    const grant = activeOverride(overrides, t, (o) => forKey(o) && o.kind === 'grant');
    const term = slots.get(`feature:${feature.key}`);
    const [on, source]: [boolean, EntitlementSource] = deny
      ? [false, 'override']
      : grant
        ? [true, 'override']
        : term
          ? [true, 'agreement']
          : [false, 'default'];
    features.set(feature.key, { on, source, dependencyMissing: false });
  }
  // A feature is off while a dependency is off, through chains (`vertex_delivery` → listing → pos).
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of catalog.features) {
      const state = features.get(feature.key);
      if (!state?.on) continue;
      const missing = feature.dependsOn.some(
        (group) => !group.some((member) => features.get(member)?.on),
      );
      if (missing) {
        features.set(feature.key, { ...state, on: false, dependencyMissing: true });
        changed = true;
      }
    }
  }
  const limits: Resolution['limits'] = new Map();
  for (const limit of catalog.limits) {
    const override = activeOverride(
      overrides,
      t,
      (o) => o.kind === 'limit' && o.limitKey === limit.key,
    );
    const term = slots.get(`limit:${limit.key}`);
    if (override) limits.set(limit.key, { value: override.value, source: 'override' });
    else if (term?.values.kind === 'limit') {
      limits.set(limit.key, { value: term.values.value, source: 'agreement' });
    } else limits.set(limit.key, { value: null, source: 'default' });
  }
  return { features, limits };
}

/** Every instant after `t` at which an input starts or ends. */
function boundariesAfter(inputs: EntitlementInputs, t: Date): number[] {
  const instants = new Set<number>();
  const add = (instant: Date | null) => {
    if (instant && instant.getTime() > t.getTime()) instants.add(instant.getTime());
  };
  for (const term of inputs.agreement.terms) {
    add(term.effectiveFrom);
    add(termEnd(term, inputs.agreement.endings));
  }
  for (const override of inputs.overrides) {
    add(override.startsAt);
    add(overrideEnd(override));
  }
  return [...instants].sort((a, b) => a - b);
}

/**
 * Resolves the entitlements at `t` (rule 15). Per feature: an active `deny` → off; else an active
 * `grant` → on; else a `feature` term in force → on; else off; then a feature whose dependencies
 * are off is off (`dependency_missing`). Per limit: an active `limit` override; else a `limit` term
 * in force; else unlimited. `until` is the first known boundary at which a feature that is on
 * turns off; `validUntil` the next boundary of any input.
 */
export function resolveEntitlements(inputs: EntitlementInputs, t: Date): ResolvedEntitlements {
  const now = resolveAt(inputs, t);
  const boundaries = boundariesAfter(inputs, t);
  const later = boundaries.map((instant) => ({
    instant,
    resolution: resolveAt(inputs, new Date(instant)),
  }));
  const features = inputs.catalog.features.map((feature): ResolvedFeature => {
    const state = now.features.get(feature.key) ?? {
      on: false,
      source: 'default' as const,
      dependencyMissing: false,
    };
    const off = state.on
      ? later.find(({ resolution }) => !resolution.features.get(feature.key)?.on)
      : undefined;
    return {
      key: feature.key,
      on: state.on,
      source: state.source,
      reason: state.dependencyMissing ? 'dependency_missing' : null,
      until: off ? new Date(off.instant).toISOString() : null,
    };
  });
  const limits = inputs.catalog.limits.map((limit): ResolvedLimit => {
    const state = now.limits.get(limit.key) ?? { value: null, source: 'default' as const };
    return { key: limit.key, value: state.value, source: state.source };
  });
  const next = boundaries[0];
  return {
    at: t.toISOString(),
    features,
    limits,
    validUntil: next === undefined ? null : new Date(next).toISOString(),
  };
}

/** Whether the resolved result has `feature` on. */
export function isEntitled(resolved: ResolvedEntitlements, feature: string): boolean {
  return resolved.features.some((entry) => entry.key === feature && entry.on);
}

/** Whether two results grant the same (their instants aside), so a recompute bumps no version. */
export function sameEntitlements(a: ResolvedEntitlements, b: ResolvedEntitlements): boolean {
  const strip = (resolved: ResolvedEntitlements) =>
    JSON.stringify({
      features: resolved.features,
      limits: resolved.limits,
      validUntil: resolved.validUntil,
    });
  return strip(a) === strip(b);
}

/**
 * Rule 21: an addition at the limit is refused (`ENTITLEMENT_LIMIT_REACHED`); what already exists
 * above a lowered limit stays (rule 8). Called inside the write's transaction with the usage it
 * counted there.
 */
export function assertWithinLimit(
  resolved: ResolvedEntitlements,
  limit: string,
  usage: number,
): void {
  const value = resolved.limits.find((entry) => entry.key === limit)?.value ?? null;
  if (value !== null && usage + 1 > value) {
    throw new DomainError('ENTITLEMENT_LIMIT_REACHED', `The ${limit} limit is reached`, {
      limit,
      value,
      usage,
    });
  }
}

// The branch copy (rules 18, 24, 26).

/** An entitled feature in a branch's copy, with `until` when its removal is scheduled. */
export const branchEntitledFeatureSchema = z.object({
  key: entitlementKeySchema,
  until: instantSchema.nullable(),
});

export type BranchEntitledFeature = z.infer<typeof branchEntitledFeatureSchema>;

/** `branch_entitlements.features`: the entitled keys only. */
export const branchEntitledFeaturesSchema = z.array(branchEntitledFeatureSchema);

/** `branch_entitlements.limits`: the set limits; an absent key is unlimited. No money. */
export const branchLimitsSchema = z.record(entitlementKeySchema, z.int().min(0));

/** What a branch's PCs hold: no money term, so PCs never learn prices or commissions. */
export function branchEntitlementsCopy(resolved: ResolvedEntitlements): {
  features: BranchEntitledFeature[];
  limits: Record<string, number>;
} {
  return {
    features: resolved.features
      .filter((feature) => feature.on)
      .map((feature) => ({ key: feature.key, until: feature.until })),
    limits: Object.fromEntries(
      resolved.limits.flatMap((limit) => (limit.value === null ? [] : [[limit.key, limit.value]])),
    ),
  };
}

/**
 * The hub's check (rule 24): a feature is entitled at `at` when the copy lists it with no `until`
 * at or before `at`. A feature not listed is off, as is one whose removal time has come.
 */
export function isBranchFeatureEntitled(
  features: readonly BranchEntitledFeature[],
  feature: string,
  at: Date,
): boolean {
  const entry = features.find((candidate) => candidate.key === feature);
  if (!entry) return false;
  return entry.until === null || at.getTime() < Date.parse(entry.until);
}

/** A PC's copy is valid this long after its last successful sync (rule 26). */
export const ENTITLEMENT_LEASE_DAYS = 7;

/** After the lease the PC keeps its last copy and shows a banner; nothing stops (rule 26). */
export function isEntitlementLeaseExpired(lastSyncedAt: Date | null, now: Date): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > ENTITLEMENT_LEASE_DAYS * 86_400_000;
}

// Reading (rules 27, 28).

export const entitlementsQuerySchema = z
  .object({ at: instantSchema.optional() })
  .meta({ id: 'EntitlementsQuery' });

export const limitUsageSchema = z
  .object({
    key: entitlementKeySchema,
    value: z.int().min(0).nullable(),
    source: entitlementSourceSchema,
    usage: z.int().min(0),
  })
  .meta({ id: 'LimitUsage' });

export type LimitUsage = z.infer<typeof limitUsageSchema>;

/** `GET /api/console/tenants/:id/entitlements` and `GET /api/tenant/entitlements`. */
export const entitlementsSchema = z
  .object({
    /** The state's version; the PCs' copies carry the same. */
    version: z.int().min(0),
    at: instantSchema,
    features: z.array(resolvedFeatureSchema),
    limits: z.array(limitUsageSchema),
    validUntil: instantSchema.nullable(),
  })
  .meta({ id: 'Entitlements' });

export type Entitlements = z.infer<typeof entitlementsSchema>;

export const entitlementExceptionSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    branchId: idSchema,
    deviceId: idSchema,
    commandId: idSchema,
    featureKey: entitlementKeySchema,
    effectiveAt: instantSchema,
    recordedAt: instantSchema,
  })
  .meta({ id: 'EntitlementException' });

export type EntitlementException = z.infer<typeof entitlementExceptionSchema>;

export const ENTITLEMENT_EXCEPTIONS_PAGE = 50;

export const entitlementExceptionsQuerySchema = z
  .object({ before: idSchema.optional() })
  .meta({ id: 'EntitlementExceptionsQuery' });

/** Newest first; `nextBefore` reads the next page. */
export const entitlementExceptionPageSchema = z
  .object({
    items: z.array(entitlementExceptionSchema),
    nextBefore: idSchema.nullable(),
  })
  .meta({ id: 'EntitlementExceptionPage' });

/**
 * "My agreement" (rule 28): features with their source, private features marked, scheduled
 * removals; limits with usage; money terms in force and scheduled; one-off fees; approved
 * amendments. Never list values, reasons, notes, drafts, rejected amendments or staff names.
 */
export const tenantAgreementSchema = z
  .object({
    at: instantSchema,
    features: z.array(resolvedFeatureSchema.extend({ private: z.boolean() })),
    limits: z.array(limitUsageSchema),
    charges: z.array(
      z.object({
        id: idSchema,
        values: termValuesSchema,
        effectiveFrom: instantSchema,
        /** The earlier of its `effective_to` and its ending. */
        endsAt: instantSchema.nullable(),
        state: z.enum(['in_force', 'scheduled']),
      }),
    ),
    oneOffFees: z.array(
      z.object({ id: idSchema, values: termValuesSchema, dueOn: localDateSchema }),
    ),
    amendments: z.array(z.object({ number: z.int().min(1), approvedAt: instantSchema })),
  })
  .meta({ id: 'TenantAgreement' });

export type TenantAgreement = z.infer<typeof tenantAgreementSchema>;
