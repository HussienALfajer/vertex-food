import type { AgreementRecord } from '@vertex-food/contracts';
import {
  agreements,
  agreementTermEndings,
  agreementTerms,
  type Transaction,
} from '@vertex-food/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AgreementRecords } from '../entitlements/index.js';
import { type AgreementRow, type EndingRow, type TermRow, toRecord } from './commercial.views.js';

export async function agreementOf(
  tx: Transaction,
  tenantId: string,
): Promise<AgreementRow | undefined> {
  const [row] = await tx.select().from(agreements).where(eq(agreements.subjectTenantId, tenantId));
  return row;
}

/** The agreement's terms and every ending of them, oldest first. */
export async function writtenTerms(
  tx: Transaction,
  agreementId: string,
): Promise<{ terms: TermRow[]; endings: EndingRow[] }> {
  const terms = await tx
    .select()
    .from(agreementTerms)
    .where(eq(agreementTerms.agreementId, agreementId))
    .orderBy(asc(agreementTerms.id));
  const endings =
    terms.length === 0
      ? []
      : await tx
          .select()
          .from(agreementTermEndings)
          .where(
            inArray(
              agreementTermEndings.termId,
              terms.map((term) => term.id),
            ),
          )
          .orderBy(asc(agreementTermEndings.id));
  return { terms, endings };
}

/** Entitlements' `AGREEMENT_RECORDS`: a tenant's terms and endings, in its transaction. */
export class AgreementRecordsStore implements AgreementRecords {
  async read(tx: Transaction, tenantId: string): Promise<AgreementRecord> {
    const agreement = await agreementOf(tx, tenantId);
    if (!agreement) return { terms: [], endings: [] };
    const { terms, endings } = await writtenTerms(tx, agreement.id);
    return toRecord(terms, endings);
  }
}
