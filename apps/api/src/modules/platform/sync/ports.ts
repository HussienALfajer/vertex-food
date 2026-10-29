import type { Transaction } from '@vertex-food/db';

// What sync needs from the modules that own the data (spec S05): declared here, provided by
// entitlements. Every method runs in the caller's tenant transaction.

/** A command the server executed although its feature was off at its effective time. */
export type CommandUse = {
  tenantId: string;
  branchId: string;
  /** The PC that executed it. */
  deviceId: string;
  commandId: string;
  feature: string;
  effectiveAt: Date;
};

/** The agreement's features at a command's effective time (owned by entitlements). */
export interface CommandEntitlements {
  /**
   * S05 rule 25: the server never rejects an uploaded command for its entitlement; when its feature
   * was off at its effective time, an entitlement exception is recorded, once per command id.
   */
  recordUse(tx: Transaction, use: CommandUse): Promise<void>;
}

export const COMMAND_ENTITLEMENTS = Symbol('CommandEntitlements');
