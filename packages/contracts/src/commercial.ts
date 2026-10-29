import { z } from 'zod';
import { DomainError } from './errors.js';
import { currencyCodeSchema } from './money.js';
import { idSchema, instantSchema } from './primitives.js';
import { nameArSchema, nameLatinSchema, nextBusinessDayEnd } from './tenancy.js';
import {
  addDays,
  businessInstant,
  type LocalDate,
  localDateSchema,
  type TimeOfDay,
} from './time.js';

/**
 * Commercial agreements (spec S05, ADR 0013, 0036), platform layer: the shapes of the feature
 * catalog, packages and agreement templates (presets), effective-dated agreement terms changed by
 * amendments, entitlement overrides, and the pure rules that check them. Keys are plain strings
 * here: each layer declares its own entries (`restaurant-features.ts`, `marketplace-features.ts`)
 * and `feature-catalog.ts` assembles them (ADR 0025). The code never checks a package or template
 * code, only resolved keys.
 */

// Feature catalog (rule 1).

export const ENTITLEMENT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** A feature or limit key of the catalog; never renamed or reused. */
export const entitlementKeySchema = z
  .string()
  .regex(ENTITLEMENT_KEY_PATTERN)
  .meta({ id: 'EntitlementKey' });

export type FeatureDefinition<Key extends string = string> = {
  key: Key;
  kind: 'feature';
  /** Groups of alternatives: each group needs one entitled member (`[['pos', 'order_intake']]`). */
  dependsOn: readonly (readonly string[])[];
  /** Granted only by override, never in a package or template while private. */
  private: boolean;
  /** No longer sold: new terms, packages and templates refuse it; its terms run to their end. */
  retired: boolean;
};

export type LimitDefinition<Key extends string = string> = {
  key: Key;
  kind: 'limit';
  /** What usage counts, for the console. */
  counts: string;
  retired: boolean;
};

export type CatalogEntry = FeatureDefinition | LimitDefinition;

export function defineFeature<const Key extends string>(definition: {
  key: Key;
  dependsOn?: readonly (readonly string[])[];
  private?: boolean;
  retired?: boolean;
}): FeatureDefinition<Key> {
  return {
    key: definition.key,
    kind: 'feature',
    dependsOn: definition.dependsOn ?? [],
    private: definition.private ?? false,
    retired: definition.retired ?? false,
  };
}

export function defineLimit<const Key extends string>(definition: {
  key: Key;
  counts: string;
  retired?: boolean;
}): LimitDefinition<Key> {
  return {
    key: definition.key,
    kind: 'limit',
    counts: definition.counts,
    retired: definition.retired ?? false,
  };
}

export type FeatureCatalog = {
  features: readonly FeatureDefinition[];
  limits: readonly LimitDefinition[];
};

/**
 * Assembles the layers' entries into one catalog, refusing at load what would make it ambiguous:
 * a malformed or repeated key, a dependency on an unknown feature, an empty group, a cycle.
 */
export function assembleFeatureCatalog(entries: readonly CatalogEntry[]): FeatureCatalog {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!ENTITLEMENT_KEY_PATTERN.test(entry.key)) throw new Error(`Bad catalog key ${entry.key}`);
    if (keys.has(entry.key)) throw new Error(`Catalog key ${entry.key} is declared twice`);
    keys.add(entry.key);
  }
  const features = entries.filter((entry): entry is FeatureDefinition => entry.kind === 'feature');
  const limits = entries.filter((entry): entry is LimitDefinition => entry.kind === 'limit');
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  for (const feature of features) {
    for (const group of feature.dependsOn) {
      if (group.length === 0) throw new Error(`${feature.key} has an empty dependency group`);
      for (const key of group) {
        if (!byKey.has(key)) throw new Error(`${feature.key} depends on unknown ${key}`);
      }
    }
  }
  const done = new Set<string>();
  const visit = (key: string, path: readonly string[]): void => {
    if (path.includes(key)) throw new Error(`Dependency cycle: ${[...path, key].join(' → ')}`);
    if (done.has(key)) return;
    for (const group of byKey.get(key)?.dependsOn ?? []) {
      for (const next of group) visit(next, [...path, key]);
    }
    done.add(key);
  };
  for (const feature of features) visit(feature.key, []);
  return { features, limits };
}

/** The platform layer's entries; food and product entries live in their own files. */
export const platformCatalogEntries = [
  defineFeature({ key: 'custom_domain', dependsOn: [['web_ordering']] }),
  defineFeature({ key: 'custom_fields' }),
  defineLimit({ key: 'branches', counts: 'Non-archived branches' }),
  defineLimit({ key: 'devices', counts: 'Registered restaurant PCs not revoked' }),
  defineLimit({ key: 'staff', counts: 'Active memberships, owners included' }),
  defineLimit({ key: 'catalog_items', counts: 'Non-archived catalog items' }),
  defineLimit({ key: 'custom_field_definitions', counts: 'Custom field definitions' }),
] as const;

export const catalogFeatureSchema = z
  .object({
    key: entitlementKeySchema,
    dependsOn: z.array(z.array(entitlementKeySchema)),
    private: z.boolean(),
    retired: z.boolean(),
  })
  .meta({ id: 'CatalogFeature' });

export const catalogLimitSchema = z
  .object({ key: entitlementKeySchema, counts: z.string(), retired: z.boolean() })
  .meta({ id: 'CatalogLimit' });

/** `GET /api/console/feature-catalog`. */
export const featureCatalogSchema = z
  .object({ features: z.array(catalogFeatureSchema), limits: z.array(catalogLimitSchema) })
  .meta({ id: 'FeatureCatalog' });

export type FeatureCatalogView = z.infer<typeof featureCatalogSchema>;

export function featureCatalogView(catalog: FeatureCatalog): FeatureCatalogView {
  return {
    features: catalog.features.map((feature) => ({
      key: feature.key,
      dependsOn: feature.dependsOn.map((group) => [...group]),
      private: feature.private,
      retired: feature.retired,
    })),
    limits: catalog.limits.map((limit) => ({
      key: limit.key,
      counts: limit.counts,
      retired: limit.retired,
    })),
  };
}

export function catalogFeature(
  catalog: FeatureCatalog,
  key: string,
): FeatureDefinition | undefined {
  return catalog.features.find((feature) => feature.key === key);
}

export function catalogLimit(catalog: FeatureCatalog, key: string): LimitDefinition | undefined {
  return catalog.limits.find((limit) => limit.key === key);
}

/** A feature that may appear in a package, a template or an agreement term (rule 1). */
function assertSellableFeature(catalog: FeatureCatalog, key: string): void {
  const feature = catalogFeature(catalog, key);
  if (!feature || feature.private || feature.retired) {
    throw new DomainError('VALIDATION_FAILED', `Feature ${key} cannot be sold`, { feature: key });
  }
}

function assertSellableLimit(catalog: FeatureCatalog, key: string): void {
  const limit = catalogLimit(catalog, key);
  if (!limit || limit.retired) {
    throw new DomainError('VALIDATION_FAILED', `Limit ${key} cannot be sold`, { limit: key });
  }
}

/** The first dependency group of `key` with no member in `entitled`, if any. */
function missingDependency(
  catalog: FeatureCatalog,
  key: string,
  entitled: ReadonlySet<string>,
): readonly string[] | undefined {
  return catalogFeature(catalog, key)?.dependsOn.find(
    (group) => !group.some((member) => entitled.has(member)),
  );
}

/**
 * A package's features and limits (rule 1): known, sellable keys, and every feature's
 * dependencies within the package.
 */
export function assertPresetEntries(
  catalog: FeatureCatalog,
  features: readonly string[],
  limits: Readonly<Record<string, number>>,
): void {
  for (const key of features) assertSellableFeature(catalog, key);
  for (const key of Object.keys(limits)) assertSellableLimit(catalog, key);
  const entitled = new Set(features);
  for (const key of features) {
    const missing = missingDependency(catalog, key, entitled);
    if (missing) {
      throw new DomainError('FEATURE_DEPENDENCY_MISSING', `${key} needs one of ${missing}`, {
        feature: key,
        missing: [...missing],
      });
    }
  }
}

// Packages and agreement templates (presets, stored as data).

export const commercialCodeSchema = z
  .string()
  .regex(/^[a-z0-9_]{2,40}$/)
  .meta({ id: 'CommercialCode' });

const presetFeaturesSchema = z
  .array(entitlementKeySchema)
  .max(100)
  .refine((keys) => new Set(keys).size === keys.length, 'Features are distinct');

/** A limit's value: a whole count. */
export const limitValueSchema = z.int().min(0).max(1_000_000);

const presetLimitsSchema = z.record(entitlementKeySchema, limitValueSchema);

export const packageInputSchema = z
  .object({
    code: commercialCodeSchema,
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.nullable().optional(),
    features: presetFeaturesSchema,
    limits: presetLimitsSchema,
  })
  .meta({ id: 'PackageInput' });

export type PackageInput = z.infer<typeof packageInputSchema>;

/** The code never changes. */
export const updatePackageSchema = z
  .object({
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.nullable().optional(),
    features: presetFeaturesSchema,
    limits: presetLimitsSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdatePackage' });

export type UpdatePackage = z.infer<typeof updatePackageSchema>;

export const packageSchema = z
  .object({
    id: idSchema,
    code: commercialCodeSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    features: z.array(entitlementKeySchema),
    limits: z.record(entitlementKeySchema, z.int()),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'Package' });

export type Package = z.infer<typeof packageSchema>;

export const packageListSchema = z.array(packageSchema).meta({ id: 'PackageList' });

/** The archive of a package or template, with the `updatedAt` the client read. */
export const archivePresetSchema = z
  .object({ updatedAt: instantSchema })
  .meta({ id: 'ArchivePreset' });

export const listPresetsQuerySchema = z
  .object({ includeArchived: z.enum(['true', 'false']).optional() })
  .meta({ id: 'ListPresetsQuery' });

// Term values (spec S05, "agreement_amendments").

export const basisPointsSchema = z.int().min(0).max(10_000);

/** The online channels that carry commission; in-store orders never do (rule 30). */
export const commissionChannelSchema = z
  .enum(['marketplace', 'web'])
  .meta({ id: 'CommissionChannel' });

export type CommissionChannel = z.infer<typeof commissionChannelSchema>;

export const recurringPeriodSchema = z.enum(['month', 'year']).meta({ id: 'RecurringPeriod' });

export type RecurringPeriod = z.infer<typeof recurringPeriodSchema>;

/** A recurring charge per tenant, or per branch active on each day (rule 32). */
export const chargeBasisSchema = z.enum(['tenant', 'active_branch']).meta({ id: 'ChargeBasis' });

export const termKinds = [
  'feature',
  'limit',
  'subscription',
  'listing_fee',
  'commission',
  'delivery_fee_share',
  'setup_fee',
  'hardware',
  'service',
  'waiver',
] as const;

export const termKindSchema = z.enum(termKinds).meta({ id: 'TermKind' });

export type TermKind = z.infer<typeof termKindSchema>;

/** One-off terms: due on a date, never in force (rule 3). */
export const oneOffTermKinds = ['setup_fee', 'hardware', 'service'] as const;

export type OneOffTermKind = (typeof oneOffTermKinds)[number];

/** Terms that carry money, so a list value and the reason for a difference (ADR 0013). */
export const moneyTermKinds = [
  'subscription',
  'listing_fee',
  'commission',
  'delivery_fee_share',
  ...oneOffTermKinds,
] as const;

const recurringShape = {
  /** Minor units of `currency`. */
  amount: z.int().min(0),
  currency: currencyCodeSchema,
  period: recurringPeriodSchema,
  per: chargeBasisSchema,
};

const oneOffShape = {
  amount: z.int().min(1),
  currency: currencyCodeSchema,
  label: z.string().trim().min(1).max(120),
};

const commissionShape = {
  kind: z.literal('commission'),
  channel: commissionChannelSchema,
  percentBp: basisPointsSchema,
  /** A fixed amount per order in the term's currency, never converted (rule 30). */
  fixed: z.object({ amount: z.int().min(0), currency: currencyCodeSchema }).optional(),
};

const hasCommission = (value: { percentBp: number; fixed?: { amount: number } | undefined }) =>
  value.percentBp > 0 || (value.fixed !== undefined && value.fixed.amount > 0);

const commissionMessage = 'A commission needs a percentage or a fixed amount';

/** What a waiver frees, in full, while it is in force (owner, 2026-10-29). */
export const waivedSlotSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.enum(['subscription', 'listing_fee', 'delivery_fee_share']) }),
    z.object({ kind: z.literal('commission'), channel: commissionChannelSchema }),
  ])
  .meta({ id: 'WaivedSlot' });

export type WaivedSlot = z.infer<typeof waivedSlotSchema>;

const valueShapes = {
  feature: { kind: z.literal('feature'), featureKey: entitlementKeySchema },
  limit: { kind: z.literal('limit'), limitKey: entitlementKeySchema, value: limitValueSchema },
  subscription: { kind: z.literal('subscription'), ...recurringShape },
  listing_fee: { kind: z.literal('listing_fee'), ...recurringShape },
  delivery_fee_share: { kind: z.literal('delivery_fee_share'), percentBp: basisPointsSchema },
  setup_fee: { kind: z.literal('setup_fee'), ...oneOffShape },
  hardware: { kind: z.literal('hardware'), ...oneOffShape },
  service: { kind: z.literal('service'), ...oneOffShape },
  waiver: { kind: z.literal('waiver'), waives: waivedSlotSchema },
};

const commissionValuesSchema = z.object(commissionShape).refine(hasCommission, commissionMessage);

/** A term's values without dates: what `agreement_terms.values` stores. */
export const termValuesSchema = z
  .discriminatedUnion('kind', [
    z.object(valueShapes.feature),
    z.object(valueShapes.limit),
    z.object(valueShapes.subscription),
    z.object(valueShapes.listing_fee),
    commissionValuesSchema,
    z.object(valueShapes.delivery_fee_share),
    z.object(valueShapes.setup_fee),
    z.object(valueShapes.hardware),
    z.object(valueShapes.service),
    z.object(valueShapes.waiver),
  ])
  .meta({ id: 'TermValues' });

export type TermValues = z.infer<typeof termValuesSchema>;

export type MoneyTermValues = Extract<TermValues, { kind: (typeof moneyTermKinds)[number] }>;

export type RecurringTermValues = Extract<TermValues, { kind: 'subscription' | 'listing_fee' }>;

/** A template's charge terms: money term values with their list values, without dates. */
export const chargeTermDraftSchema = z
  .discriminatedUnion('kind', [
    z.object(valueShapes.subscription),
    z.object(valueShapes.listing_fee),
    commissionValuesSchema,
    z.object(valueShapes.delivery_fee_share),
    z.object(valueShapes.setup_fee),
    z.object(valueShapes.hardware),
    z.object(valueShapes.service),
  ])
  .meta({ id: 'ChargeTermDraft' });

export type ChargeTermDraft = z.infer<typeof chargeTermDraftSchema>;

/**
 * A term's start or an ending as the API takes it (rule 5): a Damascus calendar date, meaning the
 * start of that day, or `now`, the approval instant. Recurring money terms take dates only.
 */
export const termDateSchema = z.union([z.literal('now'), localDateSchema]).meta({ id: 'TermDate' });

export type TermDate = z.infer<typeof termDateSchema>;

const datedShape = {
  effectiveFrom: termDateSchema,
  /** The first day the term is no longer in force (exclusive), from its start. */
  effectiveTo: localDateSchema.optional(),
};

const differenceReasonSchema = z.string().trim().min(3).max(500);

function listShape<Shape extends z.core.$ZodShape>(shape: Shape) {
  return {
    /** The template's value, or null with no template. */
    listValue: z.object(shape).nullable(),
    /** Required when the values differ from `listValue`. */
    differenceReason: differenceReasonSchema.optional(),
  };
}

const commissionListShape = {
  listValue: commissionValuesSchema.nullable(),
  differenceReason: differenceReasonSchema.optional(),
};

/** A term an amendment adds. */
export const termDraftSchema = z
  .discriminatedUnion('kind', [
    z.object({ ...valueShapes.feature, ...datedShape }),
    z.object({ ...valueShapes.limit, ...datedShape }),
    z.object({
      ...valueShapes.subscription,
      ...datedShape,
      ...listShape(valueShapes.subscription),
    }),
    z.object({
      ...valueShapes.listing_fee,
      ...datedShape,
      ...listShape(valueShapes.listing_fee),
    }),
    z
      .object({ ...commissionShape, ...datedShape, ...commissionListShape })
      .refine(hasCommission, commissionMessage),
    z.object({
      ...valueShapes.delivery_fee_share,
      ...datedShape,
      ...listShape(valueShapes.delivery_fee_share),
    }),
    z.object({
      ...valueShapes.setup_fee,
      dueOn: localDateSchema,
      ...listShape(valueShapes.setup_fee),
    }),
    z.object({
      ...valueShapes.hardware,
      dueOn: localDateSchema,
      ...listShape(valueShapes.hardware),
    }),
    z.object({ ...valueShapes.service, dueOn: localDateSchema, ...listShape(valueShapes.service) }),
    z.object({ ...valueShapes.waiver, ...datedShape }),
  ])
  .meta({ id: 'TermDraft' });

export type TermDraft = z.infer<typeof termDraftSchema>;

export const termEndingDraftSchema = z
  .object({ termId: idSchema, endsAt: termDateSchema })
  .meta({ id: 'TermEndingDraft' });

export type TermEndingDraft = z.infer<typeof termEndingDraftSchema>;

export const MAX_AMENDMENT_ENTRIES = 50;

/** An amendment's changes while drafting: empty is allowed. */
export const amendmentDraftChangesSchema = z
  .object({
    add: z.array(termDraftSchema).max(MAX_AMENDMENT_ENTRIES),
    end: z.array(termEndingDraftSchema).max(MAX_AMENDMENT_ENTRIES),
  })
  .meta({ id: 'AmendmentDraftChanges' });

export type AmendmentDraftChanges = z.infer<typeof amendmentDraftChangesSchema>;

/** What a submitted amendment changes: at least one entry. */
export const amendmentChangesSchema = amendmentDraftChangesSchema
  .refine(
    (changes) => changes.add.length + changes.end.length > 0,
    'An amendment changes something',
  )
  .meta({ id: 'AmendmentChanges' });

export type AmendmentChanges = z.infer<typeof amendmentChangesSchema>;

export const agreementTemplateInputSchema = z
  .object({
    code: commercialCodeSchema,
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.nullable().optional(),
    packageId: idSchema,
    chargeTerms: z.array(chargeTermDraftSchema).max(MAX_AMENDMENT_ENTRIES),
  })
  .meta({ id: 'AgreementTemplateInput' });

export type AgreementTemplateInput = z.infer<typeof agreementTemplateInputSchema>;

export const updateAgreementTemplateSchema = z
  .object({
    nameAr: nameArSchema,
    nameLatin: nameLatinSchema.nullable().optional(),
    packageId: idSchema,
    chargeTerms: z.array(chargeTermDraftSchema).max(MAX_AMENDMENT_ENTRIES),
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdateAgreementTemplate' });

export type UpdateAgreementTemplate = z.infer<typeof updateAgreementTemplateSchema>;

export const agreementTemplateSchema = z
  .object({
    id: idSchema,
    code: commercialCodeSchema,
    nameAr: z.string(),
    nameLatin: z.string().nullable(),
    packageId: idSchema,
    chargeTerms: z.array(chargeTermDraftSchema),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'AgreementTemplate' });

export type AgreementTemplate = z.infer<typeof agreementTemplateSchema>;

export const agreementTemplateListSchema = z
  .array(agreementTemplateSchema)
  .meta({ id: 'AgreementTemplateList' });

// Terms in force (rules 3, 4, 29).

/** A stored term, as the rules read it. */
export type AgreementTerm = {
  id: string;
  values: TermValues;
  /** Null for one-off terms. */
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  dueOn: LocalDate | null;
};

export type TermEnding = { termId: string; endsAt: Date };

/** A tenant's stored terms and their endings. */
export type AgreementRecord = {
  terms: readonly AgreementTerm[];
  endings: readonly TermEnding[];
};

export function isOneOffKind(kind: TermKind): kind is OneOffTermKind {
  return (oneOffTermKinds as readonly TermKind[]).includes(kind);
}

export function isMoneyKind(kind: TermKind): boolean {
  return (moneyTermKinds as readonly TermKind[]).includes(kind);
}

/** The slot of rule 4 (one term in force per slot), or null for a one-off term. */
export function termSlot(values: TermValues): string | null {
  switch (values.kind) {
    case 'feature':
      return `feature:${values.featureKey}`;
    case 'limit':
      return `limit:${values.limitKey}`;
    case 'commission':
      return `commission:${values.channel}`;
    case 'waiver':
      return `waiver:${waivedSlotKey(values.waives)}`;
    case 'subscription':
    case 'listing_fee':
    case 'delivery_fee_share':
      return values.kind;
    default:
      return null;
  }
}

/** The slot a waiver frees: `subscription`, `commission:web`… */
export function waivedSlotKey(waives: WaivedSlot): string {
  return waives.kind === 'commission' ? `commission:${waives.channel}` : waives.kind;
}

/** The earlier of a term's `effective_to` and its ending; null while open-ended. */
export function termEnd(term: AgreementTerm, endings: readonly TermEnding[]): Date | null {
  const ending = endings.find((entry) => entry.termId === term.id)?.endsAt ?? null;
  if (!ending) return term.effectiveTo;
  if (!term.effectiveTo) return ending;
  return ending.getTime() < term.effectiveTo.getTime() ? ending : term.effectiveTo;
}

/** In force at `t`: started at or before `t` and not yet ended; ends are exclusive (rule 3). */
export function isTermInForce(
  term: AgreementTerm,
  endings: readonly TermEnding[],
  t: Date,
): boolean {
  if (!term.effectiveFrom || term.effectiveFrom.getTime() > t.getTime()) return false;
  const end = termEnd(term, endings);
  return end === null || t.getTime() < end.getTime();
}

/** The term in force in each slot at `t` (rule 29). */
export function termsInForce(agreement: AgreementRecord, t: Date): Map<string, AgreementTerm> {
  const slots = new Map<string, AgreementTerm>();
  for (const term of agreement.terms) {
    const slot = termSlot(term.values);
    if (slot && !slots.has(slot) && isTermInForce(term, agreement.endings, t)) {
      slots.set(slot, term);
    }
  }
  return slots;
}

/** An agreement is in force while one of its feature terms is (rule 9). */
export function isAgreementInForce(agreement: AgreementRecord, t: Date): boolean {
  return agreement.terms.some(
    (term) => term.values.kind === 'feature' && isTermInForce(term, agreement.endings, t),
  );
}

/** Pairs of terms of one slot whose periods intersect (rule 4); zero-length terms never do. */
export function termOverlaps(agreement: AgreementRecord): [AgreementTerm, AgreementTerm][] {
  const periods = agreement.terms.flatMap((term) => {
    const slot = termSlot(term.values);
    if (!slot || !term.effectiveFrom) return [];
    const from = term.effectiveFrom.getTime();
    const end = termEnd(term, agreement.endings)?.getTime() ?? Number.POSITIVE_INFINITY;
    return end > from ? [{ term, slot, from, end }] : [];
  });
  const overlaps: [AgreementTerm, AgreementTerm][] = [];
  periods.forEach((a, index) => {
    for (const b of periods.slice(index + 1)) {
      if (a.slot === b.slot && a.from < b.end && b.from < a.end) overlaps.push([a.term, b.term]);
    }
  });
  return overlaps;
}

/** The start of a Damascus calendar day. */
export function startOfBusinessDate(date: LocalDate): Date {
  return businessInstant(date, '00:00');
}

/**
 * When a removal requested for `requested` takes effect (rules 7, 14): the tenant's next business
 * day end at or after it. Additions take effect at the requested instant.
 */
export function removalTakesEffectAt(requested: Date, businessDayEnds: readonly TimeOfDay[]): Date {
  return nextBusinessDayEnd(new Date(requested.getTime() - 1), businessDayEnds);
}

// Amendments (states and rules 2, 4–11).

export const amendmentStatusSchema = z
  .enum(['draft', 'submitted', 'approved', 'rejected', 'withdrawn'])
  .meta({ id: 'AmendmentStatus' });

export type AmendmentStatus = z.infer<typeof amendmentStatusSchema>;

export type AmendmentAction = 'edit' | 'submit' | 'unsubmit' | 'withdraw' | 'approve' | 'reject';

/** Every allowed transition (spec S05, "Amendment states"). */
export const amendmentTransitions = {
  draft: { edit: 'draft', submit: 'submitted', withdraw: 'withdrawn' },
  submitted: { unsubmit: 'draft', withdraw: 'withdrawn', approve: 'approved', reject: 'rejected' },
  approved: {},
  rejected: {},
  withdrawn: {},
} as const satisfies Record<AmendmentStatus, Partial<Record<AmendmentAction, AmendmentStatus>>>;

/** The status after `action`, or `INVALID_STATUS_TRANSITION`. */
export function nextAmendmentStatus(
  status: AmendmentStatus,
  action: AmendmentAction,
): AmendmentStatus {
  const allowed: Partial<Record<AmendmentAction, AmendmentStatus>> = amendmentTransitions[status];
  const next = allowed[action];
  if (!next) {
    throw new DomainError(
      'INVALID_STATUS_TRANSITION',
      `An amendment in ${status} cannot ${action}`,
      { status, action },
    );
  }
  return next;
}

/** A platform user, or the CLI's `system` actor with its operator's name. */
export type CommercialActor = { userId: string | null; operator: string | null };

/**
 * Four eyes (rule 11): the approver is not the author, as a platform user or by the CLI operator's
 * name; holding both permissions changes nothing.
 */
export function assertNotAuthor(author: CommercialActor, approver: CommercialActor): void {
  const sameUser = author.userId !== null && author.userId === approver.userId;
  const sameOperator =
    author.operator !== null &&
    approver.operator !== null &&
    author.operator.trim().toLowerCase() === approver.operator.trim().toLowerCase();
  if (sameUser || sameOperator) {
    throw new DomainError('SELF_APPROVAL', 'The author cannot approve their own amendment');
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Whether two term values are the same, whatever their key order. */
export function sameTermValues(a: TermValues, b: TermValues): boolean {
  return canonical(a) === canonical(b);
}

/** The values of a drafted term, without its dates and list fields. */
export function draftValues(draft: TermDraft): TermValues {
  const {
    effectiveFrom: _from,
    effectiveTo: _to,
    dueOn: _due,
    listValue: _list,
    differenceReason: _reason,
    ...values
  } = draft as TermDraft & {
    effectiveFrom?: unknown;
    effectiveTo?: unknown;
    dueOn?: unknown;
    listValue?: unknown;
    differenceReason?: unknown;
  };
  return termValuesSchema.parse(values);
}

/**
 * Pre-fills a draft from a template (rule 2): the package's features and limits as `feature` and
 * `limit` terms, and its charge terms with their list values. Dates are the author's to set: `now`
 * where allowed, recurring charges from tomorrow and one-off fees due today.
 */
export function draftFromTemplate(
  preset: { features: readonly string[]; limits: Readonly<Record<string, number>> },
  chargeTerms: readonly ChargeTermDraft[],
  today: LocalDate,
): AmendmentDraftChanges {
  const add: TermDraft[] = [
    ...preset.features.map(
      (featureKey): TermDraft => ({
        kind: 'feature',
        featureKey,
        effectiveFrom: 'now',
      }),
    ),
    ...Object.entries(preset.limits).map(
      ([limitKey, value]): TermDraft => ({ kind: 'limit', limitKey, value, effectiveFrom: 'now' }),
    ),
    ...chargeTerms.map((charge): TermDraft => {
      if (isOneOffKind(charge.kind)) {
        return { ...charge, dueOn: today, listValue: charge } as TermDraft;
      }
      const effectiveFrom = isRecurringKind(charge.kind) ? addDays(today, 1) : 'now';
      return { ...charge, effectiveFrom, listValue: charge } as TermDraft;
    }),
  ];
  return { add, end: [] };
}

function isRecurringKind(kind: TermKind): boolean {
  return kind === 'subscription' || kind === 'listing_fee';
}

/** A template's charge terms: at most one per slot, as an agreement would hold them. */
export function assertTemplateChargeTerms(chargeTerms: readonly ChargeTermDraft[]): void {
  const slots = new Set<string>();
  for (const charge of chargeTerms) {
    const slot = termSlot(charge);
    if (!slot) continue;
    if (slots.has(slot)) {
      throw new DomainError('VALIDATION_FAILED', `Two charge terms for ${slot}`, { slot });
    }
    slots.add(slot);
  }
}

/** A term an approved amendment writes, with its stored (pushed) dates. */
export type PlannedTerm = Omit<AgreementTerm, 'id'> & {
  listValue: TermValues | null;
  differenceReason: string | null;
};

export type PlannedAmendment = { add: PlannedTerm[]; end: TermEnding[] };

export type AmendmentContext = {
  catalog: FeatureCatalog;
  /** The agreement's stored terms and endings. */
  agreement: AgreementRecord;
  /** The approval (or submit) instant. */
  now: Date;
  /** The `business_day_ends_at` of the tenant's non-archived branches. */
  businessDayEnds: readonly TimeOfDay[];
};

function resolveTermDate(date: TermDate, now: Date): Date {
  return date === 'now' ? now : startOfBusinessDate(date);
}

const NEW_TERM_PREFIX = 'new:';

/**
 * Validates an amendment against the agreement at `now` and says what approving it writes (rules
 * 4–7): known, sellable keys; list values and their reasons; no date in the past; endings of this
 * agreement's open terms; removals pushed to the tenant's next business day end; no overlap in a
 * slot; dependencies holding at every instant of the result. Run at submit and again at approval.
 */
export function planAmendment(
  changes: AmendmentChanges,
  context: AmendmentContext,
): PlannedAmendment {
  const { catalog, agreement, now, businessDayEnds } = context;
  if (changes.add.length + changes.end.length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'An amendment changes something');
  }
  const past = (instant: Date, field: string, index: number) => {
    if (instant.getTime() < now.getTime()) {
      throw new DomainError('EFFECTIVE_DATE_PAST', `${field} is in the past`, { field, index });
    }
  };

  const added: (AgreementTerm & {
    listValue: TermValues | null;
    differenceReason: string | null;
  })[] = changes.add.map((draft, index) => {
    const values = draftValues(draft);
    if (values.kind === 'feature') assertSellableFeature(catalog, values.featureKey);
    if (values.kind === 'limit') assertSellableLimit(catalog, values.limitKey);
    const listed = draft as { listValue?: TermValues | null; differenceReason?: string };
    const listValue = listed.listValue ?? null;
    const differenceReason = listed.differenceReason ?? null;
    if (listValue && !sameTermValues(listValue, values) && !differenceReason) {
      throw new DomainError('VALIDATION_FAILED', 'A value differing from the list needs a reason', {
        index,
        field: 'differenceReason',
      });
    }
    const id = `${NEW_TERM_PREFIX}${index}`;
    if ('dueOn' in draft) {
      return {
        id,
        values,
        effectiveFrom: null,
        effectiveTo: null,
        dueOn: draft.dueOn,
        listValue,
        differenceReason,
      };
    }
    if (isRecurringKind(values.kind) && draft.effectiveFrom === 'now') {
      throw new DomainError('VALIDATION_FAILED', 'Recurring charges start on a date', { index });
    }
    const effectiveFrom = resolveTermDate(draft.effectiveFrom, now);
    past(effectiveFrom, 'effectiveFrom', index);
    const effectiveTo = draft.effectiveTo ? startOfBusinessDate(draft.effectiveTo) : null;
    if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new DomainError('VALIDATION_FAILED', 'A term ends after it starts', { index });
    }
    return { id, values, effectiveFrom, effectiveTo, dueOn: null, listValue, differenceReason };
  });

  const endedIds = new Set<string>();
  const endings: TermEnding[] = changes.end.map((ending, index) => {
    const term = agreement.terms.find((entry) => entry.id === ending.termId);
    const reject = (message: string) => {
      throw new DomainError('VALIDATION_FAILED', message, { index, termId: ending.termId });
    };
    if (!term) return reject('The term is not in this agreement');
    if (!term.effectiveFrom) return reject('A one-off term cannot be ended');
    if (endedIds.has(term.id) || agreement.endings.some((entry) => entry.termId === term.id)) {
      return reject('The term is already ended');
    }
    const end = termEnd(term, agreement.endings);
    if (end && end.getTime() <= now.getTime()) return reject('The term is over');
    if (isRecurringKind(term.values.kind) && ending.endsAt === 'now') {
      return reject('Recurring charges end on a date');
    }
    endedIds.add(term.id);
    const requested = resolveTermDate(ending.endsAt, now);
    past(requested, 'endsAt', index);
    // A term not yet in force ended before its start never starts (zero length).
    const endsAt =
      requested.getTime() < term.effectiveFrom.getTime() ? term.effectiveFrom : requested;
    return { termId: term.id, endsAt };
  });

  pushRemovals(agreement, added, endings, businessDayEnds);
  added.forEach((term, index) => {
    // A removal pushed to the business day end past the term's own end leaves nothing in force:
    // refused, so the author sets a later end (the database would refuse it too).
    if (
      term.effectiveFrom &&
      term.effectiveTo &&
      term.effectiveTo.getTime() <= term.effectiveFrom.getTime()
    ) {
      throw new DomainError('VALIDATION_FAILED', 'The term ends before its removal takes effect', {
        index,
        field: 'effectiveTo',
        takesEffectAt: term.effectiveFrom.toISOString(),
      });
    }
  });

  const result: AgreementRecord = {
    terms: [...agreement.terms, ...added],
    endings: [...agreement.endings, ...endings],
  };
  const overlap = termOverlaps(result).find(([a, b]) =>
    [a, b].some((term) => term.id.startsWith(NEW_TERM_PREFIX)),
  );
  if (overlap) {
    const names = overlap.map((term) =>
      term.id.startsWith(NEW_TERM_PREFIX)
        ? `add[${term.id.slice(NEW_TERM_PREFIX.length)}]`
        : term.id,
    );
    throw new DomainError('TERM_OVERLAP', 'Two terms overlap in one slot', {
      slot: termSlot(overlap[0].values),
      terms: names,
    });
  }
  assertDependenciesHold(catalog, result, now);

  return {
    add: added.map(({ id: _id, ...term }) => term),
    end: endings,
  };
}

type SlotValue = boolean | number;

/** A feature slot's value (entitled or not) or a limit slot's (unlimited as Infinity). */
function slotValueAt(
  record: AgreementRecord,
  slot: string,
  t: number,
  justBefore: boolean,
): SlotValue {
  const isFeature = slot.startsWith('feature:');
  let value: SlotValue = isFeature ? false : Number.POSITIVE_INFINITY;
  for (const term of record.terms) {
    if (termSlot(term.values) !== slot || !term.effectiveFrom) continue;
    const from = term.effectiveFrom.getTime();
    const end = termEnd(term, record.endings)?.getTime() ?? Number.POSITIVE_INFINITY;
    const inForce = justBefore ? from < t && t <= end : from <= t && t < end;
    if (!inForce) continue;
    if (isFeature) value = true;
    else if (term.values.kind === 'limit') value = Math.min(value as number, term.values.value);
  }
  return value;
}

/**
 * Rule 7: a feature turned off, or a limit lowered, at an instant the amendment sets takes effect
 * at the next business day end at or after it. Every instant of the amendment in that slot at that
 * moment moves together, so a replaced term leaves no gap.
 */
function pushRemovals(
  agreement: AgreementRecord,
  added: AgreementTerm[],
  endings: TermEnding[],
  businessDayEnds: readonly TimeOfDay[],
): void {
  const record: AgreementRecord = {
    terms: [...agreement.terms, ...added],
    endings: [...agreement.endings, ...endings],
  };
  const slotOfTerm = new Map(record.terms.map((term) => [term.id, termSlot(term.values)]));
  type Instant = { slot: string; at: number; move: (to: Date) => void };
  const instants: Instant[] = [];
  for (const term of added) {
    const slot = termSlot(term.values);
    if (!slot || !(slot.startsWith('feature:') || slot.startsWith('limit:'))) continue;
    if (term.effectiveFrom) {
      instants.push({
        slot,
        at: term.effectiveFrom.getTime(),
        move: (to) => {
          term.effectiveFrom = to;
        },
      });
    }
    if (term.effectiveTo) {
      instants.push({
        slot,
        at: term.effectiveTo.getTime(),
        move: (to) => {
          term.effectiveTo = to;
        },
      });
    }
  }
  endings.forEach((ending, index) => {
    const slot = slotOfTerm.get(ending.termId);
    if (!slot || !(slot.startsWith('feature:') || slot.startsWith('limit:'))) return;
    instants.push({
      slot,
      at: ending.endsAt.getTime(),
      move: (to) => {
        endings[index] = { termId: ending.termId, endsAt: to };
      },
    });
  });
  const moves: { instant: Instant; to: Date }[] = [];
  for (const instant of instants) {
    const before = slotValueAt(record, instant.slot, instant.at, true);
    const after = slotValueAt(record, instant.slot, instant.at, false);
    const removal =
      typeof before === 'boolean' ? before && !after : (after as number) < (before as number);
    if (removal) {
      moves.push({ instant, to: removalTakesEffectAt(new Date(instant.at), businessDayEnds) });
    }
  }
  for (const { instant, to } of moves) {
    for (const other of instants) {
      if (other.slot === instant.slot && other.at === instant.at) other.move(to);
    }
  }
}

/** Every instant from `now` at which the record's features change. */
function featureBoundaries(record: AgreementRecord, now: Date): number[] {
  const instants = new Set<number>([now.getTime()]);
  for (const term of record.terms) {
    if (term.values.kind !== 'feature' || !term.effectiveFrom) continue;
    instants.add(term.effectiveFrom.getTime());
    const end = termEnd(term, record.endings);
    if (end) instants.add(end.getTime());
  }
  return [...instants].filter((instant) => instant >= now.getTime()).sort((a, b) => a - b);
}

/** Rule 6: at every instant from `now`, each entitled feature's dependencies are entitled too. */
function assertDependenciesHold(catalog: FeatureCatalog, record: AgreementRecord, now: Date): void {
  for (const instant of featureBoundaries(record, now)) {
    const t = new Date(instant);
    const entitled = new Set(
      record.terms
        .filter((term) => term.values.kind === 'feature' && isTermInForce(term, record.endings, t))
        .map((term) => (term.values as { featureKey: string }).featureKey),
    );
    for (const key of entitled) {
      const missing = missingDependency(catalog, key, entitled);
      if (missing) {
        throw new DomainError('FEATURE_DEPENDENCY_MISSING', `${key} needs one of ${missing}`, {
          feature: key,
          missing: [...missing],
          at: t.toISOString(),
        });
      }
    }
  }
}

const amendmentNoteSchema = z.string().trim().max(1000);

export const createAmendmentSchema = z
  .object({
    /** Pre-fills the draft from a template (rule 2); not with `changes`. */
    templateId: idSchema.optional(),
    changes: amendmentDraftChangesSchema.optional(),
    note: amendmentNoteSchema.optional(),
  })
  .refine((input) => !(input.templateId && input.changes), {
    message: 'A draft starts from a template or from changes',
    path: ['changes'],
  })
  .meta({ id: 'CreateAmendment' });

export type CreateAmendment = z.infer<typeof createAmendmentSchema>;

export const updateAmendmentSchema = z
  .object({
    changes: amendmentDraftChangesSchema,
    note: amendmentNoteSchema.nullable(),
    updatedAt: instantSchema,
  })
  .meta({ id: 'UpdateAmendment' });

export type UpdateAmendment = z.infer<typeof updateAmendmentSchema>;

/** Submit, unsubmit, withdraw and approve: the `updatedAt` the client read. */
export const amendmentTransitionSchema = z
  .object({ updatedAt: instantSchema })
  .meta({ id: 'AmendmentTransition' });

const commercialReasonSchema = z.string().trim().min(3).max(500);

export const rejectAmendmentSchema = z
  .object({ reason: commercialReasonSchema, updatedAt: instantSchema })
  .meta({ id: 'RejectAmendment' });

export type RejectAmendment = z.infer<typeof rejectAmendmentSchema>;

/** A stored term in the console (rule 27). */
export const termStateSchema = z
  .enum(['in_force', 'future', 'ended', 'one_off'])
  .meta({ id: 'TermState' });

export type TermState = z.infer<typeof termStateSchema>;

export function termState(term: AgreementTerm, endings: readonly TermEnding[], t: Date): TermState {
  if (!term.effectiveFrom) return 'one_off';
  if (isTermInForce(term, endings, t)) return 'in_force';
  return term.effectiveFrom.getTime() > t.getTime() ? 'future' : 'ended';
}

export const agreementTermSchema = z
  .object({
    id: idSchema,
    amendmentId: idSchema,
    values: termValuesSchema,
    effectiveFrom: instantSchema.nullable(),
    effectiveTo: instantSchema.nullable(),
    /** The ending a later amendment set, with that amendment. */
    endsAt: instantSchema.nullable(),
    endingAmendmentId: idSchema.nullable(),
    dueOn: localDateSchema.nullable(),
    listValue: termValuesSchema.nullable(),
    differenceReason: z.string().nullable(),
    state: termStateSchema,
    createdAt: instantSchema,
  })
  .meta({ id: 'AgreementTerm' });

export type AgreementTermView = z.infer<typeof agreementTermSchema>;

export const amendmentSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    agreementId: idSchema,
    number: z.int().min(1),
    status: amendmentStatusSchema,
    changes: amendmentDraftChangesSchema,
    note: z.string().nullable(),
    authoredBy: idSchema.nullable(),
    authoredByOperator: z.string().nullable(),
    submittedAt: instantSchema.nullable(),
    decidedAt: instantSchema.nullable(),
    decidedBy: idSchema.nullable(),
    decidedByOperator: z.string().nullable(),
    decisionReason: z.string().nullable(),
    /** What an approved amendment wrote, with the stored (pushed) dates. */
    applied: z
      .object({
        terms: z.array(agreementTermSchema),
        endings: z.array(z.object({ termId: idSchema, endsAt: instantSchema })),
      })
      .nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'Amendment' });

export type Amendment = z.infer<typeof amendmentSchema>;

// Overrides (rules 12–14).

export const overrideKindSchema = z.enum(['grant', 'deny', 'limit']).meta({ id: 'OverrideKind' });

export type OverrideKind = z.infer<typeof overrideKindSchema>;

/** The longest an override may last, except a private feature's grant (rule 12). */
export const MAX_OVERRIDE_DAYS = 366;

const overrideDatesShape = {
  /** `now` or the start of a Damascus day, never in the past. */
  startsAt: termDateSchema.optional(),
  /** The start of a Damascus day; required except for a private feature's grant. */
  expiresAt: localDateSchema.optional(),
};

export const overrideInputSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('grant'),
      featureKey: entitlementKeySchema,
      reason: commercialReasonSchema,
      ...overrideDatesShape,
    }),
    z.object({
      kind: z.literal('deny'),
      featureKey: entitlementKeySchema,
      reason: commercialReasonSchema,
      ...overrideDatesShape,
    }),
    z.object({
      kind: z.literal('limit'),
      limitKey: entitlementKeySchema,
      value: limitValueSchema,
      reason: commercialReasonSchema,
      ...overrideDatesShape,
    }),
  ])
  .meta({ id: 'OverrideInput' });

export type OverrideInput = z.infer<typeof overrideInputSchema>;

/** A stored override, as the rules read it. */
export type OverrideRecord = {
  id: string;
  kind: OverrideKind;
  featureKey: string | null;
  limitKey: string | null;
  value: number | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

/** The end of an override: the earlier of its expiry and its revocation. */
export function overrideEnd(override: OverrideRecord): Date | null {
  const { expiresAt, revokedAt } = override;
  if (!revokedAt) return expiresAt;
  if (!expiresAt) return revokedAt;
  return revokedAt.getTime() < expiresAt.getTime() ? revokedAt : expiresAt;
}

export function isOverrideActive(override: OverrideRecord, t: Date): boolean {
  if (override.startsAt.getTime() > t.getTime()) return false;
  const end = overrideEnd(override);
  return end === null || t.getTime() < end.getTime();
}

function overrideSlot(override: { featureKey: string | null; limitKey: string | null }): string {
  return override.featureKey ? `feature:${override.featureKey}` : `limit:${override.limitKey}`;
}

/** The agreement's value of a limit at `t`, without overrides; null is unlimited. */
function agreementLimitAt(agreement: AgreementRecord, key: string, t: Date): number | null {
  const term = termsInForce(agreement, t).get(`limit:${key}`);
  return term?.values.kind === 'limit' ? term.values.value : null;
}

/** A limit value below another (null is unlimited). */
const below = (value: number, other: number | null) => other === null || value < other;

/** A limit value above another; nothing is above unlimited. */
const raises = (value: number, other: number | null) => other !== null && value > other;

export type OverrideContext = {
  catalog: FeatureCatalog;
  agreement: AgreementRecord;
  /** The tenant's overrides, revoked ones included. */
  overrides: readonly OverrideRecord[];
  now: Date;
  businessDayEnds: readonly TimeOfDay[];
};

/**
 * Validates an override and returns its stored dates (rules 12–14): keys in the catalog (a grant
 * of a private feature allowed, a deny of any), a start not in the past, an expiry within 366 days
 * except a private feature's grant, removals pushed to the next business day end, and no overlap
 * with another override of the slot.
 */
export function planOverride(
  input: OverrideInput,
  context: OverrideContext,
): { startsAt: Date; expiresAt: Date | null } {
  const { catalog, agreement, overrides, now, businessDayEnds } = context;
  let privateGrant = false;
  if (input.kind === 'limit') {
    assertSellableLimit(catalog, input.limitKey);
  } else {
    const feature = catalogFeature(catalog, input.featureKey);
    if (!feature || (input.kind === 'grant' && feature.retired)) {
      throw new DomainError('VALIDATION_FAILED', `Feature ${input.featureKey} cannot be granted`, {
        feature: input.featureKey,
      });
    }
    privateGrant = input.kind === 'grant' && feature.private;
  }
  let startsAt = resolveTermDate(input.startsAt ?? 'now', now);
  if (startsAt.getTime() < now.getTime()) {
    throw new DomainError('EFFECTIVE_DATE_PAST', 'startsAt is in the past', { field: 'startsAt' });
  }
  let expiresAt = input.expiresAt ? startOfBusinessDate(input.expiresAt) : null;
  if (!expiresAt && !privateGrant) {
    throw new DomainError('VALIDATION_FAILED', 'An override needs an expiry', {
      field: 'expiresAt',
    });
  }
  if (expiresAt) {
    const days = (expiresAt.getTime() - startsAt.getTime()) / 86_400_000;
    if (days <= 0 || days > MAX_OVERRIDE_DAYS) {
      throw new DomainError('VALIDATION_FAILED', 'The expiry is out of range', {
        field: 'expiresAt',
      });
    }
  }
  if (input.kind === 'deny') {
    startsAt = removalTakesEffectAt(startsAt, businessDayEnds);
  }
  if (input.kind === 'grant' && expiresAt) {
    expiresAt = removalTakesEffectAt(expiresAt, businessDayEnds);
  }
  if (input.kind === 'limit') {
    if (below(input.value, agreementLimitAt(agreement, input.limitKey, startsAt))) {
      startsAt = removalTakesEffectAt(startsAt, businessDayEnds);
    }
    if (expiresAt && raises(input.value, agreementLimitAt(agreement, input.limitKey, expiresAt))) {
      expiresAt = removalTakesEffectAt(expiresAt, businessDayEnds);
    }
  }
  if (expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
    throw new DomainError('VALIDATION_FAILED', 'The override expires before it takes effect', {
      field: 'expiresAt',
      takesEffectAt: startsAt.toISOString(),
    });
  }

  const slot = overrideSlot({
    featureKey: input.kind === 'limit' ? null : input.featureKey,
    limitKey: input.kind === 'limit' ? input.limitKey : null,
  });
  const from = startsAt.getTime();
  const end = expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const clash = overrides.find((other) => {
    if (overrideSlot(other) !== slot) return false;
    const otherFrom = other.startsAt.getTime();
    const otherEnd = overrideEnd(other)?.getTime() ?? Number.POSITIVE_INFINITY;
    return otherEnd > otherFrom && from < otherEnd && otherFrom < end;
  });
  if (clash) {
    throw new DomainError('OVERRIDE_OVERLAP', 'Another override of the slot overlaps', {
      overrideId: clash.id,
    });
  }
  return { startsAt, expiresAt };
}

/**
 * When a revocation takes effect (rule 14): a grant's, or a raising limit's, at the next business
 * day end; any other at once, as does one not yet started.
 */
export function planRevocation(
  override: OverrideRecord,
  context: { agreement: AgreementRecord; now: Date; businessDayEnds: readonly TimeOfDay[] },
): Date {
  const { agreement, now, businessDayEnds } = context;
  if (override.revokedAt) {
    throw new DomainError('ALREADY_REVOKED', 'The override is already revoked', {
      overrideId: override.id,
    });
  }
  if (!isOverrideActive(override, now)) return now;
  const removal =
    override.kind === 'grant' ||
    (override.kind === 'limit' &&
      override.limitKey !== null &&
      override.value !== null &&
      raises(override.value, agreementLimitAt(agreement, override.limitKey, now)));
  return removal ? removalTakesEffectAt(now, businessDayEnds) : now;
}

export const revokeOverrideSchema = z
  .object({ reason: commercialReasonSchema })
  .meta({ id: 'RevokeEntitlementOverride' });

export type RevokeOverride = z.infer<typeof revokeOverrideSchema>;

export const overrideRevocationSchema = z
  .object({
    overrideId: idSchema,
    /** The effective time (rule 14). */
    revokedAt: instantSchema,
    reason: z.string(),
    revokedBy: idSchema.nullable(),
    revokedByOperator: z.string().nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'EntitlementOverrideRevocation' });

export const entitlementOverrideSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    kind: overrideKindSchema,
    featureKey: entitlementKeySchema.nullable(),
    limitKey: entitlementKeySchema.nullable(),
    value: z.int().nullable(),
    reason: z.string(),
    startsAt: instantSchema,
    expiresAt: instantSchema.nullable(),
    createdBy: idSchema.nullable(),
    createdByOperator: z.string().nullable(),
    createdAt: instantSchema,
    revocation: overrideRevocationSchema.nullable(),
  })
  .meta({ id: 'EntitlementOverride' });

export type EntitlementOverride = z.infer<typeof entitlementOverrideSchema>;

/** `GET /api/console/tenants/:id/agreement` (rule 27, exceptions on their own route). */
export const consoleAgreementSchema = z
  .object({
    tenantId: idSchema,
    agreement: z
      .object({
        id: idSchema,
        templateId: idSchema.nullable(),
        inForce: z.boolean(),
        createdAt: instantSchema,
      })
      .nullable(),
    terms: z.array(agreementTermSchema),
    amendments: z.array(amendmentSchema),
    overrides: z.array(entitlementOverrideSchema),
  })
  .meta({ id: 'ConsoleAgreement' });

export type ConsoleAgreement = z.infer<typeof consoleAgreementSchema>;
