import type {
  EntitlementException,
  EntitlementOverride,
  OverrideKind,
} from '@vertex-food/contracts';
import type {
  entitlementExceptions,
  entitlementOverrideRevocations,
  entitlementOverrides,
} from '@vertex-food/db';

// Rows of the entitlements tables as the contracts answer them.

type OverrideRow = typeof entitlementOverrides.$inferSelect;
type RevocationRow = typeof entitlementOverrideRevocations.$inferSelect;
type ExceptionRow = typeof entitlementExceptions.$inferSelect;

export function toRevocation(row: RevocationRow): NonNullable<EntitlementOverride['revocation']> {
  return {
    overrideId: row.overrideId,
    revokedAt: row.revokedAt.toISOString(),
    reason: row.reason,
    revokedBy: row.revokedBy,
    revokedByOperator: row.revokedByOperator,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOverride(
  row: OverrideRow,
  revocation: RevocationRow | null,
): EntitlementOverride {
  return {
    id: row.id,
    tenantId: row.subjectTenantId,
    kind: row.kind as OverrideKind,
    featureKey: row.featureKey,
    limitKey: row.limitKey,
    value: row.value,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdByOperator: row.createdByOperator,
    createdAt: row.createdAt.toISOString(),
    revocation: revocation ? toRevocation(revocation) : null,
  };
}

export function toException(row: ExceptionRow): EntitlementException {
  return {
    id: row.id,
    tenantId: row.subjectTenantId,
    branchId: row.branchId,
    deviceId: row.deviceId,
    commandId: row.commandId,
    featureKey: row.featureKey,
    effectiveAt: row.effectiveAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  };
}
