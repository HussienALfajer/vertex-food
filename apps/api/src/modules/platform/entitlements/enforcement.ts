import { Inject, Injectable } from '@nestjs/common';
import {
  assertWithinLimit,
  DomainError,
  isAgreementInForce,
  isEntitled,
  resolveEntitlements,
} from '@vertex-food/contracts';
import { entitlementExceptions, type Transaction } from '@vertex-food/db';
import type { EntitlementCheck } from '../../../core/access/entitlement-check.js';
import type { StaffLimit } from '../access/index.js';
import type { DeviceLimit } from '../identity/index.js';
import type { CommandEntitlements, CommandUse } from '../sync/index.js';
import type { TenantEntitlements } from '../tenancy/index.js';
import { EntitlementStates, resolvedOf } from './entitlement-states.js';
import { AGREEMENT_RECORDS, type AgreementRecords } from './ports.js';

/**
 * Enforcement (spec S05 rules 9, 20, 21, 25), behind the ports the core, tenancy, access, identity
 * and sync declare: features at an instant for the access guard, activation, the limits counted
 * under the state's lock, a new branch's copy, and the exceptions of commands executed although
 * their feature was off.
 */
@Injectable()
export class EntitlementEnforcement
  implements EntitlementCheck, TenantEntitlements, StaffLimit, DeviceLimit, CommandEntitlements
{
  constructor(
    @Inject(EntitlementStates) private readonly states: EntitlementStates,
    @Inject(AGREEMENT_RECORDS) private readonly agreements: AgreementRecords,
  ) {}

  async isEntitled(tenantId: string, feature: string, at: Date): Promise<boolean> {
    return isEntitled(resolvedOf(await this.states.current(tenantId, at)), feature);
  }

  async assertAgreementInForce(tx: Transaction, tenantId: string, now: Date): Promise<void> {
    if (!isAgreementInForce(await this.agreements.read(tx, tenantId), now)) {
      throw new DomainError('AGREEMENT_NOT_IN_FORCE', 'The tenant has no agreement in force');
    }
  }

  assertBranchFits(tx: Transaction, tenantId: string): Promise<void> {
    return this.assertFits(tx, tenantId, 'branches');
  }

  assertMemberFits(tx: Transaction, tenantId: string): Promise<void> {
    return this.assertFits(tx, tenantId, 'staff');
  }

  assertPcFits(tx: Transaction, tenantId: string): Promise<void> {
    return this.assertFits(tx, tenantId, 'devices');
  }

  branchCreated(tx: Transaction, tenantId: string, branchId: string): Promise<void> {
    return this.states.copyToBranch(tx, tenantId, branchId);
  }

  async recordUse(tx: Transaction, use: CommandUse): Promise<void> {
    const inputs = await this.states.inputs(tx, use.tenantId);
    if (isEntitled(resolveEntitlements(inputs, use.effectiveAt), use.feature)) return;
    await tx
      .insert(entitlementExceptions)
      .values({
        subjectTenantId: use.tenantId,
        branchId: use.branchId,
        deviceId: use.deviceId,
        commandId: use.commandId,
        featureKey: use.feature,
        effectiveAt: use.effectiveAt,
      })
      .onConflictDoNothing({ target: entitlementExceptions.commandId });
  }

  /** Rule 21: usage + 1 within the limit, counted while the tenant's state row is locked. */
  private async assertFits(tx: Transaction, tenantId: string, limit: string): Promise<void> {
    const state = await this.states.lock(tx, tenantId);
    assertWithinLimit(resolvedOf(state), limit, await this.states.usage(tx, limit));
  }
}
