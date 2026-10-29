import {
  type FeatureKey,
  featureCatalog,
  isBranchFeatureEntitled,
  type LimitKey,
  type LimitUsage,
  limitKeys,
  type TenantAgreement,
} from '@vertex-food/contracts';
import { formatLocale } from '@vertex-food/i18n';
import type { BranchEntitlementsView } from '../../lib/sync';

/**
 * The pure rules of «اتفاقيتي» and the back office's banners (spec S05 screens 1, 2, rule 28):
 * what each feature's chip and source say, a limit's usage, a scheduled removal. No money here:
 * the charges are drawn from the API's terms as they come.
 */

export type AgreementFeature = TenantAgreement['features'][number];

// The API and the PC's copy carry the catalog's keys (rule 1), typed as strings on the wire; the
// screens name each by its key, and the catalog test in `packages/i18n` holds every name.
const asFeature = (key: string) => key as FeatureKey;
const asLimit = (key: string) => key as LimitKey;

/** The source line of a feature (rule 28): agreement, trial until a date, private, off. */
export type FeatureSource =
  | { kind: 'agreement' }
  | { kind: 'trial'; until: string }
  | { kind: 'private' }
  | { kind: 'off' }
  | { kind: 'dependencyMissing' };

export type FeatureView = {
  key: FeatureKey;
  on: boolean;
  source: FeatureSource;
  /** A scheduled removal at a business day's end, shown under the source (rules 7, 14). */
  stopsAt: string | null;
};

export function featureView(feature: AgreementFeature): FeatureView {
  const { on, until } = feature;
  const key = asFeature(feature.key);
  if (!on) {
    return {
      key,
      on,
      source: { kind: feature.reason === 'dependency_missing' ? 'dependencyMissing' : 'off' },
      stopsAt: null,
    };
  }
  if (feature.private) return { key, on, source: { kind: 'private' }, stopsAt: until };
  // A grant by override always ends (rule 12, private features aside): a trial until that date.
  if (feature.source === 'override' && until) {
    return { key, on, source: { kind: 'trial', until }, stopsAt: null };
  }
  return { key, on, source: { kind: 'agreement' }, stopsAt: until };
}

const retired = new Set(
  featureCatalog.features.filter((feature) => feature.retired).map((feature) => feature.key),
);

/**
 * The features the page lists, those on first, in the catalog's order. A private feature that is
 * off is another restaurant's and a retired one that is off is no longer sold: neither is listed.
 */
export function shownFeatures(features: readonly AgreementFeature[]): FeatureView[] {
  return features
    .filter((feature) => feature.on || !(feature.private || retired.has(feature.key)))
    .map(featureView)
    .sort((a, b) => Number(b.on) - Number(a.on));
}

export type LimitView = {
  key: LimitKey;
  usage: number;
  /** Null: unlimited. */
  value: number | null;
  /** The bar's filled share, 0 to 1. */
  share: number;
  /** Usage above a lowered limit (edge case 9): nothing removed, additions refused. */
  over: boolean;
};

export function limitView(limit: LimitUsage): LimitView {
  const { usage, value } = limit;
  const key = asLimit(limit.key);
  if (value === null) return { key, usage, value, share: 0, over: false };
  return {
    key,
    usage,
    value,
    share: value === 0 ? 1 : Math.min(1, usage / value),
    over: usage > value,
  };
}

/** A percentage in basis points as the page writes it: `1250` is «12.5». */
export function formatPercentBp(percentBp: number): string {
  return new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 2 }).format(percentBp / 100);
}

type BranchCopy = NonNullable<BranchEntitlementsView['copy']>;

/**
 * The features of the PC's copy whose removal is still ahead at `now`, soonest first: the banner's
 * lines (screen 2). One already past is off at the hub, and the banner has nothing to announce.
 */
export function scheduledRemovals(
  copy: BranchCopy | null,
  now: Date,
): { key: FeatureKey; until: string }[] {
  return (copy?.features ?? [])
    .flatMap((feature) =>
      feature.until && Date.parse(feature.until) > now.getTime()
        ? [{ key: asFeature(feature.key), until: feature.until }]
        : [],
    )
    .sort((a, b) => Date.parse(a.until) - Date.parse(b.until));
}

/**
 * The page offline (screen 1): the copy's features and limits as last synced, without usage or
 * money. A feature is listed while the hub would still take its commands at `now` (rule 24): one
 * whose removal time has come is off on this PC, so it is left out. Every limit of the catalog is
 * listed: a key absent from the copy is unlimited.
 */
export function offlineView(
  copy: BranchCopy,
  now: Date,
): {
  features: { key: FeatureKey; stopsAt: string | null }[];
  limits: { key: LimitKey; value: number | null }[];
} {
  return {
    features: copy.features
      .filter((feature) => isBranchFeatureEntitled(copy.features, feature.key, now))
      .map((feature) => ({ key: asFeature(feature.key), stopsAt: feature.until })),
    limits: limitKeys.map((key) => ({ key, value: copy.limits[key] ?? null })),
  };
}
