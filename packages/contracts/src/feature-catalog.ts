import { z } from 'zod';
import { assembleFeatureCatalog, platformCatalogEntries } from './commercial.js';
import { marketplaceCatalogEntries } from './marketplace-features.js';
import { restaurantCatalogEntries } from './restaurant-features.js';

/**
 * The feature catalog (spec S05, ADR 0036): every layer's entries assembled once, in the product
 * layer, so the platform resolver reads keys without knowing what they sell (ADR 0025).
 */
const entries = [
  ...platformCatalogEntries,
  ...restaurantCatalogEntries,
  ...marketplaceCatalogEntries,
] as const;

type Entry = (typeof entries)[number];

export type FeatureKey = Extract<Entry, { kind: 'feature' }>['key'];

export type LimitKey = Extract<Entry, { kind: 'limit' }>['key'];

export const featureCatalog = assembleFeatureCatalog(entries);

export const featureKeys = featureCatalog.features.map((feature) => feature.key) as [
  FeatureKey,
  ...FeatureKey[],
];

export const limitKeys = featureCatalog.limits.map((limit) => limit.key) as [
  LimitKey,
  ...LimitKey[],
];

export const featureKeySchema = z.enum(featureKeys).meta({ id: 'FeatureKey' });

export const limitKeySchema = z.enum(limitKeys).meta({ id: 'LimitKey' });
