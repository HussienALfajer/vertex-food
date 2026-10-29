import {
  type AgreementRecord,
  type AgreementTemplate,
  type AgreementTerm,
  type AgreementTermView,
  type Amendment,
  type AmendmentDraftChanges,
  type AmendmentStatus,
  type ChargeTermDraft,
  type Package,
  type TermEnding,
  type TermValues,
  termState,
} from '@vertex-food/contracts';
import type {
  agreementAmendments,
  agreements,
  agreementTemplates,
  agreementTermEndings,
  agreementTerms,
  packages,
} from '@vertex-food/db';

// Rows of the commercial tables as the contracts and the rules read them.

export type PackageRow = typeof packages.$inferSelect;
export type TemplateRow = typeof agreementTemplates.$inferSelect;
export type AgreementRow = typeof agreements.$inferSelect;
export type AmendmentRow = typeof agreementAmendments.$inferSelect;
export type TermRow = typeof agreementTerms.$inferSelect;
export type EndingRow = typeof agreementTermEndings.$inferSelect;

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function toPackage(row: PackageRow): Package {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    features: row.features as string[],
    limits: row.limits as Record<string, number>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
  };
}

export function toTemplate(row: TemplateRow): AgreementTemplate {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    packageId: row.packageId,
    chargeTerms: row.chargeTerms as ChargeTermDraft[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
  };
}

/** A stored term as the rules read it. */
export function toTermRecord(row: TermRow): AgreementTerm {
  return {
    id: row.id,
    values: row.values as TermValues,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    dueOn: row.dueOn,
  };
}

export function toRecord(
  terms: readonly TermRow[],
  endings: readonly EndingRow[],
): AgreementRecord {
  return {
    terms: terms.map(toTermRecord),
    endings: endings.map(
      (ending): TermEnding => ({ termId: ending.termId, endsAt: ending.endsAt }),
    ),
  };
}

/** A stored term in the console (rule 27): its ending, if any, and its state at `now`. */
export function toTermView(
  row: TermRow,
  endings: readonly EndingRow[],
  now: Date,
): AgreementTermView {
  const ending = endings.find((entry) => entry.termId === row.id) ?? null;
  return {
    id: row.id,
    amendmentId: row.amendmentId,
    values: row.values as TermValues,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveTo: iso(row.effectiveTo),
    endsAt: iso(ending?.endsAt ?? null),
    endingAmendmentId: ending?.amendmentId ?? null,
    dueOn: row.dueOn,
    listValue: (row.listValue as TermValues | null) ?? null,
    differenceReason: row.differenceReason,
    state: termState(toTermRecord(row), toRecord([], endings).endings, now),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * An amendment; an approved one with what it wrote (`applied`): its terms and the endings it set,
 * with the stored (pushed) dates.
 */
export function toAmendment(
  row: AmendmentRow,
  tenantId: string,
  written: { terms: readonly TermRow[]; endings: readonly EndingRow[] },
  now: Date,
): Amendment {
  const applied =
    row.status === 'approved'
      ? {
          terms: written.terms
            .filter((term) => term.amendmentId === row.id)
            .map((term) => toTermView(term, written.endings, now)),
          endings: written.endings
            .filter((ending) => ending.amendmentId === row.id)
            .map((ending) => ({ termId: ending.termId, endsAt: ending.endsAt.toISOString() })),
        }
      : null;
  return {
    id: row.id,
    tenantId,
    agreementId: row.agreementId,
    number: row.number,
    status: row.status as AmendmentStatus,
    changes: row.changes as AmendmentDraftChanges,
    note: row.note,
    authoredBy: row.authoredBy,
    authoredByOperator: row.authoredByOperator,
    submittedAt: iso(row.submittedAt),
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    decidedByOperator: row.decidedByOperator,
    decisionReason: row.decisionReason,
    applied,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
