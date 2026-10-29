/**
 * Whether a tenant's agreement includes a feature at an instant (spec S05 rules 15, 17, 20), for
 * `@RequiresFeature` in the access guard. The entitlements module provides it (the core imports no
 * module): it reads the tenant's resolved state, recomputing it first when it is due.
 */
export interface EntitlementCheck {
  isEntitled(tenantId: string, feature: string, at: Date): Promise<boolean>;
}

export const ENTITLEMENT_CHECK = Symbol('EntitlementCheck');
