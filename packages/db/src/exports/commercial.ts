import { and, asc, eq, inArray, min } from 'drizzle-orm';
import {
  agreementAmendments,
  agreements,
  agreementTermEndings,
  agreementTerms,
} from '../schema/commercial.js';
import type { ExportDataset } from './dataset.js';

// The restaurant's agreement (module `commercial`, spec S05), as «اتفاقيتي» shows it (rule 28):
// every term of an approved amendment with its dates and money, ended or not. Never the list
// values, the reasons for a difference, notes, drafts or the Vertex staff's names. Platform data,
// read through the tenant's own agreement.

export const agreementTermsDataset: ExportDataset = {
  stem: 'agreement_terms',
  tables: [],
  reads: ['agreements', 'agreement_amendments', 'agreement_terms', 'agreement_term_endings'],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'amendment_number', kind: 'integer' },
    { name: 'approved_at', kind: 'instant' },
    { name: 'kind', kind: 'text' },
    { name: 'values', kind: 'text' },
    { name: 'amount', kind: 'money' },
    { name: 'effective_from', kind: 'instant' },
    { name: 'effective_to', kind: 'instant' },
    { name: 'due_on', kind: 'date' },
  ],
  async *rows(tx, { tenantId }) {
    const terms = await tx
      .select({
        term: {
          id: agreementTerms.id,
          kind: agreementTerms.kind,
          values: agreementTerms.values,
          amountMinor: agreementTerms.amountMinor,
          currency: agreementTerms.currency,
          effectiveFrom: agreementTerms.effectiveFrom,
          effectiveTo: agreementTerms.effectiveTo,
          dueOn: agreementTerms.dueOn,
        },
        number: agreementAmendments.number,
        approvedAt: agreementAmendments.decidedAt,
      })
      .from(agreementTerms)
      .innerJoin(agreements, eq(agreements.id, agreementTerms.agreementId))
      .innerJoin(agreementAmendments, eq(agreementAmendments.id, agreementTerms.amendmentId))
      .where(
        and(eq(agreements.subjectTenantId, tenantId), eq(agreementAmendments.status, 'approved')),
      )
      .orderBy(asc(agreementAmendments.number), asc(agreementTerms.id));
    const endings = terms.length
      ? await tx
          .select({ termId: agreementTermEndings.termId, endsAt: min(agreementTermEndings.endsAt) })
          .from(agreementTermEndings)
          .where(
            inArray(
              agreementTermEndings.termId,
              terms.map(({ term }) => term.id),
            ),
          )
          .groupBy(agreementTermEndings.termId)
      : [];
    const endOf = new Map(endings.map((ending) => [ending.termId, ending.endsAt]));
    for (const { term, number, approvedAt } of terms) {
      const ending = endOf.get(term.id) ?? null;
      const effectiveTo =
        ending && (!term.effectiveTo || ending < term.effectiveTo) ? ending : term.effectiveTo;
      yield {
        id: term.id,
        amendment_number: number,
        approved_at: approvedAt,
        kind: term.kind,
        values: JSON.stringify(term.values),
        amount:
          term.amountMinor === null || term.currency === null
            ? null
            : { amount: term.amountMinor, currency: term.currency },
        effective_from: term.effectiveFrom,
        effective_to: effectiveTo,
        due_on: term.dueOn,
      };
    }
  },
};
