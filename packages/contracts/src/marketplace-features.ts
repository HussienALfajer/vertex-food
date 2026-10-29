import { defineFeature } from './commercial.js';

/** The marketplace product's features (spec S05, ADR 0011, 0028). */
export const marketplaceCatalogEntries = [
  /** Appearing in the customer app, with Vertex's approval (S22). */
  defineFeature({ key: 'marketplace_listing', dependsOn: [['pos', 'order_intake']] }),
] as const;
