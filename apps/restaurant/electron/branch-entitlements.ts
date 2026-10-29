import {
  branchEntitledFeaturesSchema,
  branchLimitsSchema,
  isEntitlementLeaseExpired,
} from '@vertex-food/contracts';
import type { BranchEntitlementsView } from './bridge.js';
import type { LocalReads } from './local-db.js';

// The branch's copy of its resolved entitlements on this PC (spec S05 rules 18, 24, 26): the
// synced `branch_entitlements` row, read offline. The hub checks a command's feature against it
// whatever the lease; after 7 days without a sync the back office only shows a banner.

export type BranchEntitlementsCopy = NonNullable<BranchEntitlementsView['copy']>;

function parseJson(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** PowerSync gives a `timestamptz` as `2026-10-29 07:42:00.000Z`; the view carries ISO. */
function instant(text: string | null): string | null {
  if (!text) return null;
  const time = Date.parse(text.replace(' ', 'T'));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * The branch's row, or null before the stream brought one. A row whose features cannot be read is
 * null too: the hub then refuses every command of a feature, as before a first sync, rather than
 * guess what the agreement holds.
 */
export async function readBranchEntitlements(
  reads: LocalReads,
): Promise<BranchEntitlementsCopy | null> {
  const row = await reads.getOptional<{
    version: number | null;
    features: string | null;
    limits: string | null;
    updated_at: string | null;
  }>(
    // One row per branch, and a PC streams its own branch's only (sync-config.yaml).
    'SELECT version, features, limits, updated_at FROM branch_entitlements ORDER BY version DESC LIMIT 1',
  );
  if (!row) return null;
  const features = branchEntitledFeaturesSchema.safeParse(parseJson(row.features));
  const limits = branchLimitsSchema.safeParse(parseJson(row.limits) ?? {});
  if (!features.success || !limits.success || row.version === null) return null;
  return {
    version: row.version,
    features: features.data,
    limits: limits.data,
    updatedAt: instant(row.updated_at),
  };
}

/** What the renderer reads: the copy, and the lease from PowerSync's last checkpoint. */
export function branchEntitlementsView(
  copy: BranchEntitlementsCopy | null,
  lastSyncedAt: string | null,
  now: Date,
): BranchEntitlementsView {
  const synced = lastSyncedAt ? new Date(lastSyncedAt) : null;
  return {
    copy,
    lastSyncedAt,
    leaseExpired: isEntitlementLeaseExpired(synced, now),
  };
}
