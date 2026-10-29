import type { ResolvedEntitlements } from '@vertex-food/contracts';
import { eq } from 'drizzle-orm';
import { entitlementStates } from '../schema/entitlements.js';
import type { ExportDataset } from './dataset.js';

// What the restaurant's agreement entitles it to (module `entitlements`, spec S05): the resolved
// state the owner reads in «اتفاقيتي», one row per feature and per limit. Platform data, read
// through the tenant's own state.

export const entitlementsDataset: ExportDataset = {
  stem: 'entitlements',
  tables: [],
  reads: ['entitlement_states'],
  columns: [
    { name: 'type', kind: 'text' },
    { name: 'key', kind: 'text' },
    { name: 'on', kind: 'boolean' },
    { name: 'value', kind: 'integer' },
    { name: 'source', kind: 'text' },
    { name: 'until', kind: 'instant' },
    { name: 'computed_at', kind: 'instant' },
  ],
  async *rows(tx, { tenantId }) {
    const [state] = await tx
      .select({ resolved: entitlementStates.resolved, computedAt: entitlementStates.computedAt })
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, tenantId));
    if (!state) return;
    const resolved = state.resolved as ResolvedEntitlements;
    for (const feature of resolved.features) {
      yield {
        type: 'feature',
        key: feature.key,
        on: feature.on,
        value: null,
        source: feature.source,
        until: feature.until,
        computed_at: state.computedAt,
      };
    }
    for (const limit of resolved.limits) {
      yield {
        type: 'limit',
        key: limit.key,
        on: null,
        value: limit.value,
        source: limit.source,
        until: null,
        computed_at: state.computedAt,
      };
    }
  },
};
