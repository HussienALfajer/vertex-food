import { Inject, Injectable } from '@nestjs/common';
import {
  type AgreementTemplate,
  type AgreementTemplateInput,
  type Amendment,
  type AmendmentAction,
  type AmendmentChanges,
  type AmendmentDraftChanges,
  amendmentChangesSchema,
  assertNotAuthor,
  assertPresetEntries,
  assertTemplateChargeTerms,
  businessWallClock,
  type ChargeTermDraft,
  type CommercialActor,
  type ConsoleAgreement,
  type CreateAmendment,
  catalogFeature,
  DomainError,
  draftFromTemplate,
  draftValues,
  effectiveStatus,
  type FeatureCatalogView,
  featureCatalog,
  featureCatalogView,
  isAgreementInForce,
  isMoneyKind,
  isOneOffKind,
  nextAmendmentStatus,
  type Package,
  type PackageInput,
  type PlannedTerm,
  planAmendment,
  sameTermValues,
  type TenantAgreement,
  type TermDraft,
  type TermValues,
  termEnd,
  termSlot,
  termState,
  type UpdateAgreementTemplate,
  type UpdateAmendment,
  type UpdatePackage,
} from '@vertex-food/contracts';
import {
  agreementAmendments,
  agreements,
  agreementTemplates,
  agreementTermEndings,
  agreementTerms,
  type Database,
  packages,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import {
  type PlatformOperator,
  requirePermission,
  type StaffActor,
} from '../../../core/access/actor.js';
import { audit, auditPlatform } from '../../../core/audit/audit.js';
import { assertCurrent, nextUpdatedAt } from '../../../core/concurrency/updated-at.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { databaseNow } from '../../../core/database/database-now.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { emit } from '../../../core/events/outbox.js';
import { businessDayEnds, EntitlementsService, operatorColumns } from '../entitlements/index.js';
import { readTenant, statusState } from '../tenancy/index.js';
import { AgreementRecordsStore, agreementOf, writtenTerms } from './agreement-records.js';
import {
  type AgreementRow,
  type AmendmentRow,
  type EndingRow,
  type PackageRow,
  type TemplateRow,
  type TermRow,
  toAmendment,
  toPackage,
  toRecord,
  toTemplate,
  toTermView,
} from './commercial.views.js';

const notFound = (what: string) => new DomainError('NOT_FOUND', `No such ${what}`);
const tenantClosed = () => new DomainError('TENANT_CLOSED', 'The tenant is closed');

/** The kinds "My agreement" lists as charges in force or scheduled (rule 28). */
const CHARGE_KINDS: readonly string[] = [
  'subscription',
  'listing_fee',
  'commission',
  'delivery_fee_share',
  'waiver',
];

function codeTaken(constraint: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error, constraint)) {
      throw new DomainError('CODE_TAKEN', 'The code is or was used');
    }
    throw error;
  };
}

/** A platform user, or the CLI's operator, as the four-eyes rule compares them (rule 11). */
function commercialActor(operator: PlatformOperator): CommercialActor {
  return operator.kind === 'platform'
    ? { userId: operator.userId, operator: null }
    : { userId: null, operator: operator.name };
}

function authorOf(row: AmendmentRow): CommercialActor {
  return { userId: row.authoredBy, operator: row.authoredByOperator };
}

/** The author of the amendment: the same platform user, or the same CLI operator's name. */
function isAuthor(row: AmendmentRow, operator: PlatformOperator): boolean {
  try {
    assertNotAuthor(authorOf(row), commercialActor(operator));
    return false;
  } catch {
    return true;
  }
}

/** Approvers withdraw too (spec S05, "Amendment states"); the CLI's operators are trusted staff. */
function isApprover(operator: PlatformOperator): boolean {
  return operator.kind === 'system' || operator.permissions.includes('console.agreements.approve');
}

/** The money columns a term mirrors from its values (ADR 0014). */
function moneyColumns(values: TermValues): { amountMinor: number | null; currency: string | null } {
  switch (values.kind) {
    case 'subscription':
    case 'listing_fee':
    case 'setup_fee':
    case 'hardware':
    case 'service':
      return { amountMinor: values.amount, currency: values.currency };
    case 'commission':
      return values.fixed
        ? { amountMinor: values.fixed.amount, currency: values.fixed.currency }
        : { amountMinor: null, currency: null };
    default:
      return { amountMinor: null, currency: null };
  }
}

type AmendmentContext = { tenantId: string; agreement: AgreementRow; amendment: AmendmentRow };

/**
 * Commercial agreements (spec S05, ADR 0013, 0036): the feature catalog, packages and templates
 * (presets, archived and never deleted), one agreement per tenant changed only by approved
 * amendments, the console's and the owner's reading of it. Every change writes its platform audit
 * entry in its transaction; an approval also writes its terms and endings, the tenant's audit
 * entry, `agreement.amended.v1` and the recompute of the tenant's entitlements.
 */
@Injectable()
export class CommercialService {
  private readonly records = new AgreementRecordsStore();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  catalog(): FeatureCatalogView {
    return featureCatalogView(featureCatalog);
  }

  // Packages (rule 1).

  async listPackages(includeArchived: boolean): Promise<Package[]> {
    const rows = await this.db
      .select()
      .from(packages)
      .where(includeArchived ? undefined : isNull(packages.archivedAt))
      .orderBy(asc(packages.code));
    return rows.map(toPackage);
  }

  async createPackage(operator: PlatformOperator, input: PackageInput): Promise<Package> {
    assertPresetEntries(featureCatalog, input.features, input.limits);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(packages)
        .values({
          code: input.code,
          nameAr: input.nameAr,
          nameLatin: input.nameLatin ?? null,
          features: input.features,
          limits: input.limits,
        })
        .returning()
        .catch(codeTaken('packages_code_unique'));
      if (!row) throw new Error('No package inserted');
      await auditPlatform(tx, operator, {
        action: 'package.created',
        entityType: 'package',
        entityId: row.id,
        details: { code: row.code, features: input.features, limits: input.limits },
      });
      return toPackage(row);
    });
  }

  async updatePackage(
    operator: PlatformOperator,
    id: string,
    input: UpdatePackage,
  ): Promise<Package> {
    assertPresetEntries(featureCatalog, input.features, input.limits);
    return this.db.transaction(async (tx) => {
      const row = await this.lockPackage(tx, id);
      assertCurrent(row, input.updatedAt);
      const [updated] = await tx
        .update(packages)
        .set({
          nameAr: input.nameAr,
          nameLatin: input.nameLatin ?? null,
          features: input.features,
          limits: input.limits,
          updatedAt: nextUpdatedAt(row),
        })
        .where(eq(packages.id, id))
        .returning();
      if (!updated) throw new Error('No package updated');
      await auditPlatform(tx, operator, {
        action: 'package.updated',
        entityType: 'package',
        entityId: id,
        details: {
          from: { features: row.features, limits: row.limits },
          to: { features: input.features, limits: input.limits },
        },
      });
      return toPackage(updated);
    });
  }

  /** Archived, never deleted; archiving twice is a no-op. */
  async archivePackage(
    operator: PlatformOperator,
    id: string,
    updatedAt: string,
  ): Promise<Package> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockPackage(tx, id);
      if (row.archivedAt) return toPackage(row);
      assertCurrent(row, updatedAt);
      const now = new Date();
      const [archived] = await tx
        .update(packages)
        .set({ archivedAt: now, updatedAt: nextUpdatedAt(row, now) })
        .where(eq(packages.id, id))
        .returning();
      if (!archived) throw new Error('No package archived');
      await auditPlatform(tx, operator, {
        action: 'package.archived',
        entityType: 'package',
        entityId: id,
      });
      return toPackage(archived);
    });
  }

  /** The CLI names packages and templates by code. */
  async packageIdByCode(code: string): Promise<string> {
    const [row] = await this.db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.code, code));
    if (!row) throw notFound('package');
    return row.id;
  }

  // Agreement templates (rules 1, 2).

  async listTemplates(includeArchived: boolean): Promise<AgreementTemplate[]> {
    const rows = await this.db
      .select()
      .from(agreementTemplates)
      .where(includeArchived ? undefined : isNull(agreementTemplates.archivedAt))
      .orderBy(asc(agreementTemplates.code));
    return rows.map(toTemplate);
  }

  async createTemplate(
    operator: PlatformOperator,
    input: AgreementTemplateInput,
  ): Promise<AgreementTemplate> {
    assertTemplateChargeTerms(input.chargeTerms);
    return this.db.transaction(async (tx) => {
      await this.offeredPackage(tx, input.packageId);
      const [row] = await tx
        .insert(agreementTemplates)
        .values({
          code: input.code,
          nameAr: input.nameAr,
          nameLatin: input.nameLatin ?? null,
          packageId: input.packageId,
          chargeTerms: input.chargeTerms,
        })
        .returning()
        .catch(codeTaken('agreement_templates_code_unique'));
      if (!row) throw new Error('No template inserted');
      await auditPlatform(tx, operator, {
        action: 'agreement_template.created',
        entityType: 'agreement_template',
        entityId: row.id,
        details: { code: row.code, packageId: row.packageId, chargeTerms: input.chargeTerms },
      });
      return toTemplate(row);
    });
  }

  async updateTemplate(
    operator: PlatformOperator,
    id: string,
    input: UpdateAgreementTemplate,
  ): Promise<AgreementTemplate> {
    assertTemplateChargeTerms(input.chargeTerms);
    return this.db.transaction(async (tx) => {
      const row = await this.lockTemplate(tx, id);
      assertCurrent(row, input.updatedAt);
      // An archived package is not offered for templates, unless the template already uses it.
      if (input.packageId !== row.packageId) await this.offeredPackage(tx, input.packageId);
      const [updated] = await tx
        .update(agreementTemplates)
        .set({
          nameAr: input.nameAr,
          nameLatin: input.nameLatin ?? null,
          packageId: input.packageId,
          chargeTerms: input.chargeTerms,
          updatedAt: nextUpdatedAt(row),
        })
        .where(eq(agreementTemplates.id, id))
        .returning();
      if (!updated) throw new Error('No template updated');
      await auditPlatform(tx, operator, {
        action: 'agreement_template.updated',
        entityType: 'agreement_template',
        entityId: id,
        details: {
          from: { packageId: row.packageId, chargeTerms: row.chargeTerms },
          to: { packageId: input.packageId, chargeTerms: input.chargeTerms },
        },
      });
      return toTemplate(updated);
    });
  }

  async archiveTemplate(
    operator: PlatformOperator,
    id: string,
    updatedAt: string,
  ): Promise<AgreementTemplate> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockTemplate(tx, id);
      if (row.archivedAt) return toTemplate(row);
      assertCurrent(row, updatedAt);
      const now = new Date();
      const [archived] = await tx
        .update(agreementTemplates)
        .set({ archivedAt: now, updatedAt: nextUpdatedAt(row, now) })
        .where(eq(agreementTemplates.id, id))
        .returning();
      if (!archived) throw new Error('No template archived');
      await auditPlatform(tx, operator, {
        action: 'agreement_template.archived',
        entityType: 'agreement_template',
        entityId: id,
      });
      return toTemplate(archived);
    });
  }

  async templateIdByCode(code: string): Promise<string> {
    const [row] = await this.db
      .select({ id: agreementTemplates.id })
      .from(agreementTemplates)
      .where(eq(agreementTemplates.code, code));
    if (!row) throw notFound('template');
    return row.id;
  }

  // Reading (rules 27, 28).

  /** Rule 27: every term, ending, amendment and override; exceptions have their own route. */
  async consoleAgreement(tenantId: string): Promise<ConsoleAgreement> {
    return withTenant(this.db, tenantId, async (tx) => {
      await readTenant(tx, tenantId);
      const now = new Date();
      const overrides = await this.entitlements.overrideViews(tx, tenantId);
      const agreement = await agreementOf(tx, tenantId);
      if (!agreement) return { tenantId, agreement: null, terms: [], amendments: [], overrides };
      const written = await writtenTerms(tx, agreement.id);
      const amendments = await tx
        .select()
        .from(agreementAmendments)
        .where(eq(agreementAmendments.agreementId, agreement.id))
        .orderBy(asc(agreementAmendments.number));
      return {
        tenantId,
        agreement: {
          id: agreement.id,
          templateId: agreement.templateId,
          inForce: isAgreementInForce(toRecord(written.terms, written.endings), now),
          createdAt: agreement.createdAt.toISOString(),
        },
        terms: written.terms.map((term) => toTermView(term, written.endings, now)),
        amendments: amendments.map((row) => toAmendment(row, tenantId, written, now)),
        overrides,
      };
    });
  }

  /**
   * Rule 28, "My agreement" (owner): features with their source, limits with usage, the charges
   * in force and scheduled, one-off fees and the approved amendments; never list values, reasons,
   * notes, drafts, rejected amendments or Vertex staff.
   */
  async tenantAgreement(actor: StaffActor): Promise<TenantAgreement> {
    requirePermission(actor, 'agreement.view');
    const { version, resolved } = await this.entitlements.resolvedNow(actor.tenantId);
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const now = new Date(resolved.at);
      const { limits } = await this.entitlements.withUsage(tx, version, resolved);
      const agreement = await agreementOf(tx, actor.tenantId);
      const written = agreement
        ? await writtenTerms(tx, agreement.id)
        : { terms: [] as TermRow[], endings: [] as EndingRow[] };
      const record = toRecord(written.terms, written.endings);
      const charges = record.terms.flatMap((term) => {
        if (!CHARGE_KINDS.includes(term.values.kind) || !term.effectiveFrom) return [];
        const end = termEnd(term, record.endings);
        // A term ended at its own start was never in force (a correction).
        if (end && end.getTime() <= term.effectiveFrom.getTime()) return [];
        const state = termState(term, record.endings, now);
        if (state !== 'in_force' && state !== 'future') return [];
        return [
          {
            id: term.id,
            values: term.values,
            effectiveFrom: term.effectiveFrom.toISOString(),
            endsAt: end?.toISOString() ?? null,
            state: state === 'in_force' ? ('in_force' as const) : ('scheduled' as const),
          },
        ];
      });
      const oneOffFees = record.terms.flatMap((term) =>
        term.dueOn ? [{ id: term.id, values: term.values, dueOn: term.dueOn }] : [],
      );
      const approved = agreement
        ? await tx
            .select({
              number: agreementAmendments.number,
              decidedAt: agreementAmendments.decidedAt,
            })
            .from(agreementAmendments)
            .where(
              and(
                eq(agreementAmendments.agreementId, agreement.id),
                eq(agreementAmendments.status, 'approved'),
              ),
            )
            .orderBy(asc(agreementAmendments.number))
        : [];
      return {
        at: resolved.at,
        features: resolved.features.map((feature) => ({
          ...feature,
          private: catalogFeature(featureCatalog, feature.key)?.private ?? false,
        })),
        limits,
        charges,
        oneOffFees,
        amendments: approved.flatMap((row) =>
          row.decidedAt ? [{ number: row.number, approvedAt: row.decidedAt.toISOString() }] : [],
        ),
      };
    });
  }

  // Amendments (spec S05, "Amendment states", rules 2, 6, 10, 11).

  /**
   * A draft, empty or pre-filled from a template (rule 2); the tenant's agreement is created with
   * its first draft. At most one open amendment per agreement (`AMENDMENT_OPEN`).
   */
  async createAmendment(
    operator: PlatformOperator,
    tenantId: string,
    input: CreateAmendment,
  ): Promise<Amendment> {
    return withTenant(this.db, tenantId, async (tx) => {
      const tenant = await readTenant(tx, tenantId, { lock: 'share' });
      const now = new Date();
      if (effectiveStatus(statusState(tenant), now) === 'closed') throw tenantClosed();
      const template = input.templateId ? await this.offeredTemplate(tx, input.templateId) : null;
      await tx
        .insert(agreements)
        .values({ subjectTenantId: tenantId, templateId: template?.id ?? null })
        .onConflictDoNothing({ target: agreements.subjectTenantId });
      const agreement = await this.lockAgreement(tx, tenantId);
      // List values are the agreement's template's (rule 2): one template per agreement.
      if (template && agreement.templateId !== template.id) {
        throw new DomainError('VALIDATION_FAILED', 'The agreement follows another template', {
          field: 'templateId',
        });
      }
      const [open] = await tx
        .select({ id: agreementAmendments.id })
        .from(agreementAmendments)
        .where(
          and(
            eq(agreementAmendments.agreementId, agreement.id),
            inArray(agreementAmendments.status, ['draft', 'submitted']),
          ),
        );
      if (open) throw amendmentOpen(open.id);
      let changes: AmendmentDraftChanges = input.changes ?? { add: [], end: [] };
      if (template) {
        const [preset] = await tx
          .select()
          .from(packages)
          .where(eq(packages.id, template.packageId));
        if (!preset) throw notFound('package');
        changes = draftFromTemplate(
          {
            features: preset.features as string[],
            limits: preset.limits as Record<string, number>,
          },
          template.chargeTerms as ChargeTermDraft[],
          businessWallClock(now).date,
        );
      }
      const [last] = await tx
        .select({ number: max(agreementAmendments.number) })
        .from(agreementAmendments)
        .where(eq(agreementAmendments.agreementId, agreement.id));
      const { by, byOperator } = operatorColumns(operator);
      const [row] = await tx
        .insert(agreementAmendments)
        .values({
          agreementId: agreement.id,
          number: (last?.number ?? 0) + 1,
          changes,
          note: input.note ?? null,
          authoredBy: by,
          authoredByOperator: byOperator,
        })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'agreement_amendments_open_idx')) throw amendmentOpen();
          throw error;
        });
      if (!row) throw new Error('No amendment inserted');
      await this.touchAgreement(tx, agreement, now);
      await auditPlatform(tx, operator, {
        action: 'amendment.created',
        entityType: 'amendment',
        entityId: row.id,
        details: { number: row.number, templateId: template?.id ?? null },
        subjectTenantId: tenantId,
      });
      return toAmendment(row, tenantId, { terms: [], endings: [] }, now);
    });
  }

  /** One amendment, as the console reads it (the CLI reads its `updatedAt` before a change). */
  async readAmendment(id: string): Promise<Amendment> {
    return this.withAmendment(id, async (tx, { tenantId, agreement, amendment }) =>
      toAmendment(amendment, tenantId, await writtenTerms(tx, agreement.id), new Date()),
    );
  }

  /** The author edits a draft (`CONFLICT` when stale). */
  async updateAmendment(
    operator: PlatformOperator,
    id: string,
    input: UpdateAmendment,
  ): Promise<Amendment> {
    return this.withAmendment(id, async (tx, context) => {
      const { amendment } = context;
      this.assertAuthor(amendment, operator);
      return this.transition(tx, context, operator, 'edit', input.updatedAt, {
        set: { changes: input.changes, note: input.note ?? null },
        action: 'amendment.updated',
      });
    });
  }

  /** Rule 6 at submit, at the submit instant: the same checks as the approval's. */
  async submitAmendment(operator: PlatformOperator, id: string, updatedAt: string) {
    return this.withAmendment(id, async (tx, context) => {
      this.assertAuthor(context.amendment, operator);
      nextAmendmentStatus(context.amendment.status as Amendment['status'], 'submit');
      assertCurrent(context.amendment, updatedAt);
      const now = new Date();
      await this.plan(tx, context, now);
      return this.transition(tx, context, operator, 'submit', updatedAt, {
        set: { submittedAt: now },
        action: 'amendment.submitted',
      });
    });
  }

  /** The author takes a submitted amendment back to edit it. */
  async unsubmitAmendment(operator: PlatformOperator, id: string, updatedAt: string) {
    return this.withAmendment(id, async (tx, context) => {
      this.assertAuthor(context.amendment, operator);
      return this.transition(tx, context, operator, 'unsubmit', updatedAt, {
        set: { submittedAt: null },
        action: 'amendment.unsubmitted',
      });
    });
  }

  /** The author, or an approver, withdraws an open amendment. */
  async withdrawAmendment(operator: PlatformOperator, id: string, updatedAt: string) {
    return this.withAmendment(id, async (tx, context) => {
      if (!isAuthor(context.amendment, operator) && !isApprover(operator)) {
        throw new DomainError('FORBIDDEN', 'Only the author or an approver withdraws');
      }
      const { by, byOperator } = operatorColumns(operator);
      return this.transition(tx, context, operator, 'withdraw', updatedAt, {
        set: { decidedAt: await databaseNow(tx), decidedBy: by, decidedByOperator: byOperator },
        action: 'amendment.withdrawn',
      });
    });
  }

  /**
   * Rules 6, 10, 11: another user than the author approves, at the approval instant read from the
   * database clock in this transaction (`decided_at`, which the amendment guard checks); the
   * amendment is validated again at that instant, removals pushed to the next business day end,
   * and its terms, endings, audit entries, event and the tenant's entitlements written in the
   * same transaction, which the term guard requires. A refusal changes nothing.
   */
  async approveAmendment(operator: PlatformOperator, id: string, updatedAt: string) {
    return this.withAmendment(id, async (tx, context) => {
      const { tenantId, agreement, amendment } = context;
      assertNotAuthor(authorOf(amendment), commercialActor(operator));
      nextAmendmentStatus(amendment.status as Amendment['status'], 'approve');
      assertCurrent(amendment, updatedAt);
      const now = await databaseNow(tx);
      const planned = await this.plan(tx, context, now);
      const { by, byOperator } = operatorColumns(operator);
      const updated = await this.writeTransition(tx, context, 'approve', {
        decidedAt: now,
        decidedBy: by,
        decidedByOperator: byOperator,
      });
      const terms: TermRow[] = [];
      for (const term of planned.add) {
        terms.push(await this.insertTerm(tx, agreement.id, amendment.id, term));
      }
      const endings: EndingRow[] = [];
      for (const ending of planned.end) {
        const [row] = await tx
          .insert(agreementTermEndings)
          .values({ termId: ending.termId, amendmentId: amendment.id, endsAt: ending.endsAt })
          .returning();
        if (!row) throw new Error('No ending inserted');
        endings.push(row);
      }
      const details = {
        number: amendment.number,
        terms: terms.map((term) => term.id),
        endings: endings.map((ending) => ({
          termId: ending.termId,
          endsAt: ending.endsAt.toISOString(),
        })),
      };
      await auditPlatform(tx, operator, {
        action: 'amendment.approved',
        entityType: 'amendment',
        entityId: amendment.id,
        details,
        subjectTenantId: tenantId,
      });
      await audit(tx, tenantId, operator, {
        action: 'agreement.amended',
        entityType: 'amendment',
        entityId: amendment.id,
        details,
      });
      await emit(tx, tenantId, 'agreement.amended.v1', { tenantId, amendmentId: amendment.id });
      await this.entitlements.agreementChanged(tx, tenantId, now);
      return toAmendment(updated, tenantId, { terms, endings }, now);
    });
  }

  /** An approver rejects a submitted amendment, with a reason. */
  async rejectAmendment(
    operator: PlatformOperator,
    id: string,
    input: { reason: string; updatedAt: string },
  ) {
    return this.withAmendment(id, async (tx, context) => {
      const { by, byOperator } = operatorColumns(operator);
      return this.transition(tx, context, operator, 'reject', input.updatedAt, {
        set: {
          decidedAt: await databaseNow(tx),
          decidedBy: by,
          decidedByOperator: byOperator,
          decisionReason: input.reason,
        },
        action: 'amendment.rejected',
        reason: input.reason,
      });
    });
  }

  // Shared steps.

  private async lockAgreement(tx: Transaction, tenantId: string): Promise<AgreementRow> {
    const [row] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.subjectTenantId, tenantId))
      .for('update');
    if (!row) throw notFound('agreement');
    return row;
  }

  private async touchAgreement(tx: Transaction, agreement: AgreementRow, now: Date) {
    await tx
      .update(agreements)
      .set({ updatedAt: nextUpdatedAt(agreement, now) })
      .where(eq(agreements.id, agreement.id));
  }

  /**
   * Runs `work` in the amendment's tenant, with its agreement locked first (the lock of a
   * tenant's amendments) and then the amendment.
   */
  private async withAmendment<T>(
    id: string,
    work: (tx: Transaction, context: AmendmentContext) => Promise<T>,
  ): Promise<T> {
    const [found] = await this.db
      .select({ tenantId: agreements.subjectTenantId })
      .from(agreementAmendments)
      .innerJoin(agreements, eq(agreements.id, agreementAmendments.agreementId))
      .where(eq(agreementAmendments.id, id));
    if (!found) throw notFound('amendment');
    return withTenant(this.db, found.tenantId, async (tx) => {
      const agreement = await this.lockAgreement(tx, found.tenantId);
      const [amendment] = await tx
        .select()
        .from(agreementAmendments)
        .where(eq(agreementAmendments.id, id))
        .for('update');
      if (!amendment) throw notFound('amendment');
      return work(tx, { tenantId: found.tenantId, agreement, amendment });
    });
  }

  private assertAuthor(amendment: AmendmentRow, operator: PlatformOperator): void {
    if (!isAuthor(amendment, operator)) {
      throw new DomainError('FORBIDDEN', 'Only the author changes the amendment');
    }
  }

  /** A transition of the state table with the `updatedAt` the client read, and its audit entry. */
  private async transition(
    tx: Transaction,
    context: AmendmentContext,
    operator: PlatformOperator,
    action: AmendmentAction,
    expectedUpdatedAt: string,
    change: {
      set: Partial<typeof agreementAmendments.$inferInsert>;
      action: Parameters<typeof auditPlatform>[2]['action'];
      reason?: string;
    },
  ): Promise<Amendment> {
    const { tenantId, amendment } = context;
    nextAmendmentStatus(amendment.status as Amendment['status'], action);
    assertCurrent(amendment, expectedUpdatedAt);
    const updated = await this.writeTransition(tx, context, action, change.set);
    await auditPlatform(tx, operator, {
      action: change.action,
      entityType: 'amendment',
      entityId: amendment.id,
      reason: change.reason ?? null,
      details: { number: amendment.number, from: amendment.status, to: updated.status },
      subjectTenantId: tenantId,
    });
    return toAmendment(updated, tenantId, { terms: [], endings: [] }, new Date());
  }

  private async writeTransition(
    tx: Transaction,
    context: AmendmentContext,
    action: AmendmentAction,
    set: Partial<typeof agreementAmendments.$inferInsert>,
  ): Promise<AmendmentRow> {
    const { agreement, amendment } = context;
    const now = new Date();
    const status = nextAmendmentStatus(amendment.status as Amendment['status'], action);
    const [updated] = await tx
      .update(agreementAmendments)
      .set({ ...set, status, updatedAt: nextUpdatedAt(amendment, now) })
      .where(eq(agreementAmendments.id, amendment.id))
      .returning();
    if (!updated) throw new Error('No amendment updated');
    await this.touchAgreement(tx, agreement, now);
    return updated;
  }

  /** Rule 6 at `now`: the list values against the agreement's template, then the plan. */
  private async plan(tx: Transaction, context: AmendmentContext, now: Date) {
    const { tenantId, agreement, amendment } = context;
    const parsed = amendmentChangesSchema.safeParse(amendment.changes);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', 'An amendment changes something', {
        field: 'changes',
      });
    }
    const changes: AmendmentChanges = parsed.data;
    await this.assertListValues(tx, agreement, changes);
    return planAmendment(changes, {
      catalog: featureCatalog,
      agreement: await this.records.read(tx, tenantId),
      now,
      businessDayEnds: await businessDayEnds(tx),
    });
  }

  /**
   * ADR 0013's record of list values, checked on the server: a money term's `listValue` is the
   * agreement's template's charge term of its slot (or kind, for one-off fees), and null only when
   * the template has none; so a list value cannot be lowered to skip `differenceReason`.
   */
  private async assertListValues(
    tx: Transaction,
    agreement: AgreementRow,
    changes: AmendmentChanges,
  ): Promise<void> {
    let listed: ChargeTermDraft[] = [];
    if (agreement.templateId) {
      const [template] = await tx
        .select({ chargeTerms: agreementTemplates.chargeTerms })
        .from(agreementTemplates)
        .where(eq(agreementTemplates.id, agreement.templateId));
      listed = (template?.chargeTerms as ChargeTermDraft[] | undefined) ?? [];
    }
    changes.add.forEach((draft: TermDraft, index) => {
      if (!isMoneyKind(draft.kind)) return;
      const values = draftValues(draft);
      const candidates = listed.filter((charge) =>
        isOneOffKind(charge.kind)
          ? charge.kind === values.kind
          : termSlot(charge) === termSlot(values),
      );
      const listValue = (draft as { listValue?: TermValues | null }).listValue ?? null;
      const known =
        listValue === null
          ? candidates.length === 0
          : candidates.some((charge) => sameTermValues(charge, listValue));
      if (!known) {
        throw new DomainError('VALIDATION_FAILED', 'The list value is not the template value', {
          index,
          field: 'listValue',
        });
      }
    });
  }

  private async insertTerm(
    tx: Transaction,
    agreementId: string,
    amendmentId: string,
    term: PlannedTerm,
  ): Promise<TermRow> {
    const [row] = await tx
      .insert(agreementTerms)
      .values({
        agreementId,
        amendmentId,
        kind: term.values.kind,
        values: term.values,
        effectiveFrom: term.effectiveFrom,
        effectiveTo: term.effectiveTo,
        dueOn: term.dueOn,
        ...moneyColumns(term.values),
        listValue: term.listValue,
        differenceReason: term.differenceReason,
      })
      .returning();
    if (!row) throw new Error('No term inserted');
    return row;
  }

  private async lockPackage(tx: Transaction, id: string): Promise<PackageRow> {
    const [row] = await tx.select().from(packages).where(eq(packages.id, id)).for('update');
    if (!row) throw notFound('package');
    return row;
  }

  private async lockTemplate(tx: Transaction, id: string): Promise<TemplateRow> {
    const [row] = await tx
      .select()
      .from(agreementTemplates)
      .where(eq(agreementTemplates.id, id))
      .for('update');
    if (!row) throw notFound('template');
    return row;
  }

  /** A package offered for templates: it exists and is not archived (`NOT_FOUND`). */
  private async offeredPackage(tx: Transaction, id: string): Promise<PackageRow> {
    const [row] = await tx
      .select()
      .from(packages)
      .where(and(eq(packages.id, id), isNull(packages.archivedAt)))
      .for('share');
    if (!row) throw notFound('package');
    return row;
  }

  private async offeredTemplate(tx: Transaction, id: string): Promise<TemplateRow> {
    const [row] = await tx
      .select()
      .from(agreementTemplates)
      .where(and(eq(agreementTemplates.id, id), isNull(agreementTemplates.archivedAt)));
    if (!row) throw notFound('template');
    return row;
  }
}

function amendmentOpen(amendmentId?: string) {
  return new DomainError(
    'AMENDMENT_OPEN',
    'The agreement has an open amendment',
    amendmentId ? { amendmentId } : undefined,
  );
}
