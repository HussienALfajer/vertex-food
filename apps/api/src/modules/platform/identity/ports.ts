import type { Transaction } from '@vertex-food/db';
import type { DeviceActor } from '../../../core/access/actor.js';

// What identity needs from the modules that own the data (spec S04): declared here, provided by
// sync. Every method runs in the caller's tenant transaction.

/** A branch's PCs as the sync module sets them up (spec S04 rule 38). */
export interface BranchPcs {
  /**
   * In the registration's transaction: the branch's first two PCs take the configured hub and
   * standby roles, and the branch's certificate authority is made with its first PC.
   */
  registered(tx: Transaction, device: DeviceActor, now: Date): Promise<void>;
}

export const BRANCH_PCS = Symbol('BranchPcs');
