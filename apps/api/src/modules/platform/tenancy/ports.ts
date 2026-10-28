import type { Transaction } from '@vertex-food/db';
import type { PlatformOperator } from '../../../core/access/actor.js';

// What tenancy needs from the modules that own the data (spec S02): declared here, provided by
// access and identity. Every method runs in the caller's tenant transaction.

/** The tenant's first owner (owned by access, spec S02 rule 3). */
export interface TenantOwners {
  /** An active owner with every branch, for the account of `phone`, found or created. */
  addFirstOwner(
    tx: Transaction,
    tenantId: string,
    owner: { phone: string; displayName: string },
    operator: PlatformOperator,
  ): Promise<void>;
}

export const TENANT_OWNERS = Symbol('TenantOwners');

/** The tenant's registered PCs and staff sessions (owned by identity). */
export interface TenantDevices {
  /** Rule 21: refuses with `BRANCH_HAS_DEVICES` while the branch has an active PC. */
  assertNoActiveDevices(tx: Transaction, branchId: string): Promise<void>;
  /**
   * Rule 37: on closure, ends every staff session (`tenant_closed`) and revokes every active PC
   * of the tenant, in the closure's transaction.
   */
  closeAccess(tx: Transaction, tenantId: string, now: Date): Promise<void>;
}

export const TENANT_DEVICES = Symbol('TenantDevices');

/** The tenant's staff memberships (owned by access). */
export interface TenantMembers {
  /**
   * Spec S02 edge case 6: refuses with `BRANCH_HAS_MEMBERS` while an active member has the branch
   * as their only active branch; they are given another one first.
   */
  assertBranchNotSoleScope(tx: Transaction, branchId: string): Promise<void>;
}

export const TENANT_MEMBERS = Symbol('TenantMembers');
