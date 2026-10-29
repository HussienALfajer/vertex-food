import type { INestApplication } from '@nestjs/common';
import {
  type Amendment,
  DomainError,
  removalTakesEffectAt,
  type TermDraft,
} from '@vertex-food/contracts';
import {
  agreementTerms,
  auditEntries,
  branchEntitlements,
  createDatabase,
  entitlementStates,
  outboxEvents,
  platformAuditEntries,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { SystemActor } from '../src/core/access/actor.js';
import { CommercialService } from '../src/modules/platform/commercial/index.js';
import { EntitlementsService } from '../src/modules/platform/entitlements/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import { approveChanges, FINANCE, featureTerms, giveAgreement, SALES } from './commercial.js';
import { asConsoleUser, consoleUser, reauthenticate } from './console.js';
import { OPERATOR, PASSWORD, pinFor, TestApi } from './staff.js';

// Spec S05's agreements over the API: the catalog, packages and templates, amendments through
// their state table with four eyes, the approval writing its terms, endings, audit entries, event
// and the tenant's entitlements in one transaction, and the owner's "My agreement". Rules on the
// service the console routes and the CLI call, access over HTTP.

let app: INestApplication;
let api: TestApi;
let commercial: CommercialService;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await createTestApp();
  api = new TestApi(app, db);
  commercial = app.get(CommercialService);
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await db.$client.end();
});

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

let codes = 0;
const code = (prefix: string) => {
  codes += 1;
  return `${prefix}_${Date.now().toString(36)}_${codes}`;
};

/** A draft of `changes` by sales, submitted. */
async function submitted(
  tenantId: string,
  add: TermDraft[],
  end: Amendment['changes']['end'] = [],
) {
  const draft = await commercial.createAmendment(SALES, tenantId, { changes: { add, end } });
  return commercial.submitAmendment(SALES, draft.id, draft.updatedAt);
}

const tomorrow = () => {
  const date = new Date(Date.now() + 2 * 86_400_000);
  return date.toISOString().slice(0, 10);
};

describe('packages and templates (rules 1, 2)', () => {
  it('stores presets, refuses private, unknown or unmet features and taken codes, audited', async () => {
    const pkg = await commercial.createPackage(OPERATOR, {
      code: code('pkg'),
      nameAr: 'باقة تجريبية',
      features: ['pos', 'kitchen_display'],
      limits: { devices: 3 },
    });
    expect(pkg).toMatchObject({ features: ['pos', 'kitchen_display'], limits: { devices: 3 } });
    const base = { nameAr: 'باقة', limits: {} };
    expect(
      await codeOf(commercial.createPackage(OPERATOR, { ...base, code: pkg.code, features: [] })),
    ).toBe('CODE_TAKEN');
    expect(
      await codeOf(
        commercial.createPackage(OPERATOR, { ...base, code: code('p'), features: ['nope'] }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        commercial.createPackage(OPERATOR, {
          ...base,
          code: code('p'),
          features: ['kitchen_display'],
        }),
      ),
    ).toBe('FEATURE_DEPENDENCY_MISSING');
    expect(
      await codeOf(
        commercial.updatePackage(OPERATOR, pkg.id, {
          ...base,
          features: ['pos'],
          updatedAt: new Date(0).toISOString(),
        }),
      ),
    ).toBe('CONFLICT');

    const template = await commercial.createTemplate(OPERATOR, {
      code: code('tpl'),
      nameAr: 'قالب تجريبي',
      packageId: pkg.id,
      chargeTerms: [
        { kind: 'subscription', amount: 2500, currency: 'USD', period: 'month', per: 'tenant' },
      ],
    });
    expect(template.packageId).toBe(pkg.id);
    const archived = await commercial.archivePackage(OPERATOR, pkg.id, pkg.updatedAt);
    expect(archived.archivedAt).not.toBeNull();
    expect((await commercial.listPackages(false)).map((p) => p.id)).not.toContain(pkg.id);
    expect((await commercial.listPackages(true)).map((p) => p.id)).toContain(pkg.id);
    expect(
      await codeOf(
        commercial.createTemplate(OPERATOR, {
          code: code('tpl'),
          nameAr: 'قالب',
          packageId: pkg.id,
          chargeTerms: [],
        }),
      ),
    ).toBe('NOT_FOUND');

    const entries = await db
      .select({ action: platformAuditEntries.action, name: platformAuditEntries.actorName })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, pkg.id));
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'package.archived',
      'package.created',
    ]);
  });
});

describe('amendments (states, rules 2, 6, 10, 11)', () => {
  it('pre-fills a draft from a template, checks list values on the server, approves with four eyes', async () => {
    const { tenantId } = await api.newTenant();
    const pkg = await commercial.createPackage(OPERATOR, {
      code: code('pkg'),
      nameAr: 'باقة تجريبية',
      features: ['pos'],
      limits: { devices: 2 },
    });
    const template = await commercial.createTemplate(OPERATOR, {
      code: code('tpl'),
      nameAr: 'قالب تجريبي',
      packageId: pkg.id,
      chargeTerms: [
        { kind: 'subscription', amount: 2500, currency: 'USD', period: 'month', per: 'tenant' },
        { kind: 'setup_fee', amount: 5000, currency: 'USD', label: 'Setup' },
      ],
    });
    const draft = await commercial.createAmendment(SALES, tenantId, { templateId: template.id });
    expect(draft).toMatchObject({ number: 1, status: 'draft', authoredByOperator: 'sales1' });
    expect(draft.changes.add.map((term) => term.kind)).toEqual([
      'feature',
      'limit',
      'subscription',
      'setup_fee',
    ]);
    expect(await codeOf(commercial.createAmendment(SALES, tenantId, {}))).toBe('AMENDMENT_OPEN');

    // A lowered price without a reason, then with its list value lowered too: both refused.
    const [feature, limit, subscription, fee] = draft.changes.add as [
      TermDraft,
      TermDraft,
      TermDraft & { amount: number; listValue: Record<string, unknown> },
      TermDraft,
    ];
    const cheaper = { ...subscription, amount: 2000 };
    const edit = (add: TermDraft[], updatedAt: string) =>
      commercial.updateAmendment(SALES, draft.id, {
        changes: { add, end: [] },
        note: 'خصم',
        updatedAt,
      });
    let current = await edit([feature, limit, cheaper, fee], draft.updatedAt);
    expect(await codeOf(commercial.submitAmendment(SALES, draft.id, current.updatedAt))).toBe(
      'VALIDATION_FAILED',
    );
    current = await edit(
      [feature, limit, { ...cheaper, listValue: { ...subscription.listValue, amount: 2000 } }, fee],
      current.updatedAt,
    );
    expect(await codeOf(commercial.submitAmendment(SALES, draft.id, current.updatedAt))).toBe(
      'VALIDATION_FAILED',
    );
    current = await edit(
      [feature, limit, { ...cheaper, differenceReason: 'Pilot restaurant' }, fee],
      current.updatedAt,
    );
    // Only the author edits; a stale edit is a conflict.
    const other: SystemActor = { kind: 'system', name: 'sales2' };
    expect(
      await codeOf(
        commercial.updateAmendment(other, draft.id, {
          changes: current.changes,
          note: null,
          updatedAt: current.updatedAt,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(await codeOf(edit(current.changes.add, draft.updatedAt))).toBe('CONFLICT');

    const sent = await commercial.submitAmendment(SALES, draft.id, current.updatedAt);
    expect(sent.status).toBe('submitted');
    expect(
      await codeOf(
        commercial.updateAmendment(SALES, draft.id, {
          changes: current.changes,
          note: null,
          updatedAt: sent.updatedAt,
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
    // Four eyes, whatever the case of the operator's name (rule 11).
    const self: SystemActor = { kind: 'system', name: ' SALES1 ' };
    expect(await codeOf(commercial.approveAmendment(self, draft.id, sent.updatedAt))).toBe(
      'SELF_APPROVAL',
    );

    const approved = await commercial.approveAmendment(FINANCE, draft.id, sent.updatedAt);
    expect(approved).toMatchObject({ status: 'approved', decidedByOperator: 'finance1' });
    expect(approved.applied?.terms.map((term) => term.values.kind)).toEqual([
      'feature',
      'limit',
      'subscription',
      'setup_fee',
    ]);
    const stored = approved.applied?.terms.find((term) => term.values.kind === 'subscription');
    expect(stored).toMatchObject({
      values: { amount: 2000 },
      listValue: { amount: 2500 },
      differenceReason: 'Pilot restaurant',
    });
    const view = await commercial.consoleAgreement(tenantId);
    expect(view.agreement).toMatchObject({ templateId: template.id, inForce: true });
    expect(view.terms).toHaveLength(4);
    // A decided amendment is final.
    expect(await codeOf(commercial.withdrawAmendment(SALES, draft.id, approved.updatedAt))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('writes terms, state, branch copies, audit entries and events in the approval, or nothing', async () => {
    const { tenantId, branchIds } = await api.newTenant(['main', 'east']);
    const sent = await submitted(tenantId, featureTerms(['pos', 'kitchen_display']));
    const entitlements = app.get(EntitlementsService);
    const failing = vi
      .spyOn(entitlements, 'agreementChanged')
      .mockRejectedValueOnce(new Error('a failing step'));
    await expect(commercial.approveAmendment(FINANCE, sent.id, sent.updatedAt)).rejects.toThrow(
      'a failing step',
    );
    failing.mockRestore();
    expect((await commercial.readAmendment(sent.id)).status).toBe('submitted');
    const agreement = await commercial.consoleAgreement(tenantId);
    expect(agreement.terms).toEqual([]);

    const approved = await commercial.approveAmendment(FINANCE, sent.id, sent.updatedAt);
    const [state] = await db
      .select()
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, tenantId));
    expect(state?.version).toBe(2);
    const [copies, events, entries] = await withTenant(db, tenantId, async (tx) => [
      await tx.select().from(branchEntitlements),
      await tx
        .select({ type: outboxEvents.type, payload: outboxEvents.payload })
        .from(outboxEvents),
      await tx
        .select({ action: auditEntries.action, kind: auditEntries.actorKind })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, sent.id)),
    ]);
    expect(copies.map((copy) => copy.branchId).sort()).toEqual([...branchIds].sort());
    for (const copy of copies) {
      expect(copy).toMatchObject({
        version: 2,
        features: [
          { key: 'pos', until: null },
          { key: 'kitchen_display', until: null },
        ],
      });
    }
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'agreement.amended.v1', payload: { tenantId, amendmentId: approved.id } },
        { type: 'entitlements.changed.v1', payload: { tenantId, version: 2 } },
      ]),
    );
    expect(entries).toEqual([{ action: 'agreement.amended', kind: 'system' }]);
    const platform = await db
      .select({ action: platformAuditEntries.action })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, sent.id));
    expect(platform.map((entry) => entry.action).sort()).toEqual([
      'amendment.approved',
      'amendment.created',
      'amendment.submitted',
    ]);
    // The decision is dated by the database's clock, and every term from it on (rule 6).
    const terms = await db
      .select({ from: agreementTerms.effectiveFrom })
      .from(agreementTerms)
      .where(eq(agreementTerms.amendmentId, approved.id));
    for (const term of terms) expect(term.from?.toISOString()).toBe(approved.decidedAt);
  });

  it('refuses past dates, overlaps in a slot and missing dependencies', async () => {
    const { tenantId } = await api.newTenant();
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const draft = await commercial.createAmendment(SALES, tenantId, {
      changes: { add: [{ kind: 'feature', featureKey: 'pos', effectiveFrom: yesterday }], end: [] },
    });
    expect(await codeOf(commercial.submitAmendment(SALES, draft.id, draft.updatedAt))).toBe(
      'EFFECTIVE_DATE_PAST',
    );
    const withdrawn = await commercial.withdrawAmendment(FINANCE, draft.id, draft.updatedAt);
    expect(withdrawn).toMatchObject({ status: 'withdrawn', decidedByOperator: 'finance1' });

    const lone = await commercial.createAmendment(SALES, tenantId, {
      changes: { add: featureTerms(['kitchen_display']), end: [] },
    });
    expect(await codeOf(commercial.submitAmendment(SALES, lone.id, lone.updatedAt))).toBe(
      'FEATURE_DEPENDENCY_MISSING',
    );
    await commercial.withdrawAmendment(SALES, lone.id, lone.updatedAt);

    await giveAgreement(app, tenantId);
    const again = await commercial.createAmendment(SALES, tenantId, {
      changes: {
        add: [{ kind: 'feature', featureKey: 'pos', effectiveFrom: tomorrow() }],
        end: [],
      },
    });
    expect(await codeOf(commercial.submitAmendment(SALES, again.id, again.updatedAt))).toBe(
      'TERM_OVERLAP',
    );
  });

  it('pushes a removal to the next business day end (rule 7), shown to the branch copies', async () => {
    const { tenantId } = await api.newTenant();
    const first = await giveAgreement(app, tenantId, ['pos', 'waiter_app']);
    const waiter = first.applied?.terms.find(
      (term) => term.values.kind === 'feature' && term.values.featureKey === 'waiter_app',
    );
    if (!waiter) throw new Error('No waiter_app term');
    const removal = await approveChanges(app, tenantId, {
      add: [],
      end: [{ termId: waiter.id, endsAt: 'now' }],
    });
    const decidedAt = new Date(removal.decidedAt as string);
    const expected = removalTakesEffectAt(decidedAt, ['04:00']).toISOString();
    expect(removal.applied?.endings).toEqual([{ termId: waiter.id, endsAt: expected }]);
    const resolved = await app.get(EntitlementsService).forConsole(tenantId);
    expect(resolved.features.find((feature) => feature.key === 'waiter_app')).toMatchObject({
      on: true,
      until: expected,
    });
    expect(resolved.validUntil).toBe(expected);
    const copies = await withTenant(db, tenantId, (tx) => tx.select().from(branchEntitlements));
    expect(copies[0]?.features).toContainEqual({ key: 'waiter_app', until: expected });
  });

  it('lets one of two concurrent approvals pass', async () => {
    const { tenantId } = await api.newTenant();
    const sent = await submitted(tenantId, featureTerms(['pos']));
    const admin: SystemActor = { kind: 'system', name: 'admin1' };
    const outcomes = await Promise.allSettled([
      commercial.approveAmendment(FINANCE, sent.id, sent.updatedAt),
      commercial.approveAmendment(admin, sent.id, sent.updatedAt),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(['CONFLICT', 'INVALID_STATUS_TRANSITION']).toContain(
      ((refused as PromiseRejectedResult).reason as DomainError).code,
    );
  });

  it('refuses new amendments for a closed tenant, and rejects with a reason', async () => {
    const { tenantId } = await api.newTenant();
    const sent = await submitted(tenantId, featureTerms(['pos']));
    const rejected = await commercial.rejectAmendment(FINANCE, sent.id, {
      reason: 'Wrong price',
      updatedAt: sent.updatedAt,
    });
    expect(rejected).toMatchObject({ status: 'rejected', decisionReason: 'Wrong price' });
    await app
      .get(TenancyService)
      .changeStatus(OPERATOR, tenantId, { to: 'closed', reason: 'other' });
    expect(await codeOf(commercial.createAmendment(SALES, tenantId, {}))).toBe('TENANT_CLOSED');
  });
});

describe('the console routes (access, re-auth)', () => {
  it('need the right permission, a TOTP re-entry to decide, and another user to approve', async () => {
    const { tenantId } = await api.newTenant();
    const sales = await consoleUser(app, 'sales');
    const finance = await consoleUser(app, 'finance');
    const support = await consoleUser(app, 'support');
    const admin = await consoleUser(app, 'admin');
    const dispatch = await consoleUser(app, 'dispatch');

    await asConsoleUser(app, support).get('/api/console/feature-catalog').expect(200);
    const denied = await asConsoleUser(app, dispatch).get(
      `/api/console/tenants/${tenantId}/agreement`,
    );
    expect([denied.status, denied.body.code]).toEqual([403, 'FORBIDDEN']);
    const noDraft = await asConsoleUser(app, support)
      .post(`/api/console/tenants/${tenantId}/amendments`)
      .send({});
    expect([noDraft.status, noDraft.body.code]).toEqual([403, 'FORBIDDEN']);
    const noCatalog = await asConsoleUser(app, sales)
      .post('/api/console/packages')
      .send({ code: code('p'), nameAr: 'باقة', features: [], limits: {} });
    expect([noCatalog.status, noCatalog.body.code]).toEqual([403, 'FORBIDDEN']);

    const draft = await asConsoleUser(app, sales)
      .post(`/api/console/tenants/${tenantId}/amendments`)
      .send({ changes: { add: featureTerms(['pos']), end: [] } })
      .expect(201);
    const sent = await asConsoleUser(app, sales)
      .post(`/api/console/amendments/${draft.body.id}/submit`)
      .send({ updatedAt: draft.body.updatedAt })
      .expect(200);
    const salesApproves = await asConsoleUser(app, sales)
      .post(`/api/console/amendments/${draft.body.id}/approve`)
      .send({ updatedAt: sent.body.updatedAt });
    expect([salesApproves.status, salesApproves.body.code]).toEqual([403, 'FORBIDDEN']);

    vi.setSystemTime(Date.now() + 6 * 60_000);
    const stale = await asConsoleUser(app, finance)
      .post(`/api/console/amendments/${draft.body.id}/approve`)
      .send({ updatedAt: sent.body.updatedAt });
    expect([stale.status, stale.body.code]).toEqual([403, 'REAUTH_REQUIRED']);
    await reauthenticate(app, finance);
    const approved = await asConsoleUser(app, finance)
      .post(`/api/console/amendments/${draft.body.id}/approve`)
      .send({ updatedAt: sent.body.updatedAt })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: finance.userId });

    // An admin holds both permissions and still cannot approve their own amendment.
    const own = await asConsoleUser(app, admin)
      .post(`/api/console/tenants/${tenantId}/amendments`)
      .send({ changes: { add: [], end: [] } })
      .expect(201);
    expect(own.body.changes).toEqual({ add: [], end: [] });
    const empty = await asConsoleUser(app, admin)
      .post(`/api/console/amendments/${own.body.id}/submit`)
      .send({ updatedAt: own.body.updatedAt });
    expect([empty.status, empty.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const withdrawn = await asConsoleUser(app, admin)
      .post(`/api/console/amendments/${own.body.id}/withdraw`)
      .send({ updatedAt: own.body.updatedAt })
      .expect(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    const mine = await asConsoleUser(app, admin)
      .post(`/api/console/tenants/${tenantId}/amendments`)
      .send({ changes: { add: featureTerms(['analytics']), end: [] } })
      .expect(201);
    const mineSent = await asConsoleUser(app, admin)
      .post(`/api/console/amendments/${mine.body.id}/submit`)
      .send({ updatedAt: mine.body.updatedAt })
      .expect(200);
    await reauthenticate(app, admin);
    const self = await asConsoleUser(app, admin)
      .post(`/api/console/amendments/${mine.body.id}/approve`)
      .send({ updatedAt: mineSent.body.updatedAt });
    expect([self.status, self.body.code]).toEqual([403, 'SELF_APPROVAL']);

    const agreement = await asConsoleUser(app, support)
      .get(`/api/console/tenants/${tenantId}/agreement`)
      .expect(200);
    expect(agreement.body.amendments.map((a: Amendment) => a.status)).toEqual([
      'approved',
      'withdrawn',
      'submitted',
    ]);
  });
});

describe('"My agreement" (rule 28)', () => {
  it('shows the owner the terms in force without list values, and nothing to a manager', async () => {
    const setup = await api.ownerOnDevice();
    const other = await api.ownerOnDevice();
    await approveChanges(app, setup.tenantId, {
      add: [
        ...featureTerms(['pos']),
        { kind: 'limit', limitKey: 'devices', value: 3, effectiveFrom: 'now' },
        {
          kind: 'commission',
          channel: 'marketplace',
          percentBp: 500,
          effectiveFrom: 'now',
          listValue: null,
        },
        {
          kind: 'subscription',
          amount: 2500,
          currency: 'USD',
          period: 'month',
          per: 'active_branch',
          effectiveFrom: tomorrow(),
          listValue: null,
        },
        {
          kind: 'setup_fee',
          amount: 5000,
          currency: 'USD',
          label: 'Setup',
          dueOn: tomorrow(),
          listValue: null,
        },
      ],
      end: [],
    });
    await setup.device
      .as(setup.owner)
      .post('/api/sessions/current/reauth')
      .send({ password: PASSWORD })
      .expect(204);
    const response = await setup.device.as(setup.owner).get('/api/tenant/agreement').expect(200);
    expect(response.body.features.find((f: { key: string }) => f.key === 'pos')).toMatchObject({
      on: true,
      source: 'agreement',
      private: false,
    });
    // A first limit lowers "unlimited": it takes effect at the business day's end (rule 7).
    expect(response.body.limits.find((l: { key: string }) => l.key === 'devices')).toEqual({
      key: 'devices',
      value: null,
      source: 'default',
      usage: 1,
    });
    expect(
      response.body.charges.map((c: { values: { kind: string }; state: string }) => [
        c.values.kind,
        c.state,
      ]),
    ).toEqual([
      ['commission', 'in_force'],
      ['subscription', 'scheduled'],
    ]);
    expect(response.body.oneOffFees).toHaveLength(1);
    expect(response.body.amendments).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toMatch(/listValue|differenceReason|finance1|sales1/);

    // Another tenant's owner reads their own agreement only: none.
    const theirs = await other.device.as(other.owner).get('/api/tenant/agreement').expect(200);
    expect(theirs.body).toMatchObject({ charges: [], oneOffFees: [], amendments: [] });

    const manager = await setup.device.addMember(
      setup.owner,
      { displayName: 'مدير', roles: ['manager'], branchScope: { allBranches: true } },
      pinFor(1),
    );
    await api.firstSignIn(manager.phone);
    const session = await setup.device.signIn(manager.id, pinFor(1));
    const refused = await setup.device.as(session).get('/api/tenant/agreement');
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const entitlements = await setup.device.as(session).get('/api/tenant/entitlements').expect(200);
    expect(entitlements.body.version).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(entitlements.body)).not.toMatch(/amount|currency|percentBp/);
  });
});
