import type { AgreementRecord } from '@vertex-food/contracts';
import type { Transaction } from '@vertex-food/db';

// What entitlements needs from the module that owns the data (spec S05): declared here, provided by
// commercial. Every method runs in the caller's tenant transaction.

/** A tenant's agreement terms and their endings (owned by commercial). */
export interface AgreementRecords {
  /** The stored terms and endings; empty without an agreement. */
  read(tx: Transaction, tenantId: string): Promise<AgreementRecord>;
}

export const AGREEMENT_RECORDS = Symbol('AgreementRecords');
