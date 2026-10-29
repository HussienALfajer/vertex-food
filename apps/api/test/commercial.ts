import type { INestApplication } from '@nestjs/common';
import type { AmendmentDraftChanges, TermDraft } from '@vertex-food/contracts';
import type { SystemActor } from '../src/core/access/actor.js';
import { CommercialService } from '../src/modules/platform/commercial/index.js';

// Agreements for tests (spec S05): a sales operator drafts and submits, a finance operator
// approves, through the service the console routes and the CLI call.

export const SALES: SystemActor = { kind: 'system', name: 'sales1' };
export const FINANCE: SystemActor = { kind: 'system', name: 'finance1' };

/** Feature terms from the approval instant, with no end. */
export function featureTerms(features: readonly string[]): TermDraft[] {
  return features.map((featureKey) => ({ kind: 'feature', featureKey, effectiveFrom: 'now' }));
}

/** Drafts, submits and approves `changes` for the tenant: its next approved amendment. */
export async function approveChanges(
  app: INestApplication,
  tenantId: string,
  changes: AmendmentDraftChanges,
) {
  const commercial = app.get(CommercialService);
  const draft = await commercial.createAmendment(SALES, tenantId, { changes });
  const submitted = await commercial.submitAmendment(SALES, draft.id, draft.updatedAt);
  return commercial.approveAmendment(FINANCE, submitted.id, submitted.updatedAt);
}

/** An agreement in force with `features` (`pos` by default), so the tenant can be activated. */
export function giveAgreement(
  app: INestApplication,
  tenantId: string,
  features: readonly string[] = ['pos'],
) {
  return approveChanges(app, tenantId, { add: featureTerms(features), end: [] });
}
