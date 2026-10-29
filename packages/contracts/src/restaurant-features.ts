import { defineFeature } from './commercial.js';

/**
 * The food domain's features (spec S05, ADR 0025): what Vertex sells to a restaurant. Each later
 * spec places its own check on its key; a key is never renamed or reused.
 */
export const restaurantCatalogEntries = [
  /** The full restaurant app, offline: orders, tables, payments, cash sessions, menu, reports. */
  defineFeature({ key: 'pos' }),
  /** Kitchen display pairing and station commands (S11). */
  defineFeature({ key: 'kitchen_display', dependsOn: [['pos']] }),
  /** Waiter pairing and its commands (S12). */
  defineFeature({ key: 'waiter_app', dependsOn: [['pos']] }),
  /** Order-intake mode (ADR 0028, S14). */
  defineFeature({ key: 'order_intake' }),
  /** The restaurant page and QR menu ordering (S15). */
  defineFeature({ key: 'web_ordering', dependsOn: [['pos', 'order_intake']] }),
  /** Delivery zones and the restaurant's own drivers (S18). */
  defineFeature({ key: 'restaurant_delivery', dependsOn: [['pos', 'order_intake']] }),
  /** Vertex-fleet delivery jobs (S20). */
  defineFeature({ key: 'vertex_delivery', dependsOn: [['marketplace_listing', 'web_ordering']] }),
  /** Restaurant campaigns and coupons (S26). */
  defineFeature({ key: 'promotions', dependsOn: [['pos', 'order_intake']] }),
  /** The restaurant's points program (S27). */
  defineFeature({ key: 'loyalty', dependsOn: [['pos', 'order_intake']] }),
  /** The restaurant's analytics (S29). */
  defineFeature({ key: 'analytics', dependsOn: [['pos', 'order_intake']] }),
] as const;
