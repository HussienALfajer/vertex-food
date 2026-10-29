import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  agreementAmendments,
  agreements,
  agreementTermEndings,
  agreementTerms,
  branchEntitlements,
  branches,
  devices,
  entitlementExceptions,
  entitlementOverrideRevocations,
  entitlementOverrides,
  entitlementStates,
  packages,
  platformUsers,
  staffMemberships,
  tenantSlugs,
  tenants,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S05 in the database: the presets' shapes, amendments that follow their state table and
// freeze, terms and endings written only by an approved amendment and never changed, the term
// values and money columns, overrides and revocations, the branch copies isolated and published,
// and the exceptions once per command.

const { owner, app, jobs, sync } = connect();
const UNIQUE = /duplicate key value violates unique constraint/;
const CHECK = /violates check constraint/;
const APPEND_ONLY = /append-only/;
const DENIED = /permission denied for table/;
const FOREIGN = /violates foreign key constraint/;

let counter = 0;
const newPhone = () => `+9639451${String(Date.now() % 100000).padStart(5, '0')}${counter++}`;

async function seedTenant() {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const deviceId = uuidv7();
  const membershipId = uuidv7();
  const accountId = uuidv7();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `c-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
    await tx.insert(accounts).values({ id: accountId, phone: newPhone() });
  });
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(branches).values({
      id: branchId,
      tenantId,
      nameAr: 'الفرع الرئيسي',
      code: 'main',
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD'],
    });
    await tx.insert(staffMemberships).values({
      id: membershipId,
      tenantId,
      accountId,
      roles: ['owner'],
      allBranches: true,
      displayName: 'مالك تجريبي',
    });
    await tx.insert(devices).values({
      id: deviceId,
      tenantId,
      branchId,
      name: 'الكاشير 1',
      publicKey: `${uuidv7().replace(/-/g, '').slice(0, 32)}${'A'.repeat(10)}A=`,
      os: 'Windows 11',
      appVersion: '0.1.0',
      registeredByMembershipId: membershipId,
    });
  });
  const agreementId = uuidv7();
  await app.insert(agreements).values({ id: agreementId, subjectTenantId: tenantId });
  return { tenantId, branchId, deviceId, agreementId };
}

type Seeded = Awaited<ReturnType<typeof seedTenant>>;

const EMPTY = { add: [], end: [] };

async function amendment(t: Seeded, number = 1) {
  const id = uuidv7();
  await app.insert(agreementAmendments).values({
    id,
    agreementId: t.agreementId,
    number,
    changes: EMPTY,
    authoredByOperator: 'sales1',
  });
  return id;
}

type Tx = Parameters<Parameters<typeof app.transaction>[0]>[0];

async function submit(id: string) {
  await app
    .update(agreementAmendments)
    .set({ status: 'submitted', submittedAt: new Date() })
    .where(eq(agreementAmendments.id, id));
}

/** Approves a submitted amendment and writes its terms in the same transaction (rule 10). */
function approveWith(id: string, write: (tx: Tx) => Promise<unknown> = async () => {}) {
  return app.transaction(async (tx) => {
    await tx
      .update(agreementAmendments)
      .set({ status: 'approved', decidedAt: sql`now()`, decidedByOperator: 'finance1' })
      .where(eq(agreementAmendments.id, id));
    await write(tx);
  });
}

async function approve(id: string, write?: (tx: Tx) => Promise<unknown>) {
  await submit(id);
  await approveWith(id, write);
}

const DAY = 86_400_000;
/** Terms start a week from now, so their approval (now) comes first. */
const start = new Date(Date.now() + 7 * DAY);
const day = (n: number) => new Date(start.getTime() + n * DAY);

function featureTerm(t: Seeded, amendmentId: string, key = 'pos') {
  return {
    id: uuidv7(),
    agreementId: t.agreementId,
    amendmentId,
    kind: 'feature',
    values: { kind: 'feature', featureKey: key },
    effectiveFrom: start,
  } satisfies typeof agreementTerms.$inferInsert;
}

describe('packages', () => {
  it('hold catalog keys and whole limits', async () => {
    const base = { nameAr: 'باقة تجريبية', features: ['pos'], limits: { staff: 5 } };
    await app.insert(packages).values({ ...base, code: `p_${counter++}` });
    for (const bad of [
      { features: ['Bad Key'] },
      { features: 'pos' },
      { limits: { staff: -1 } },
      { limits: { staff: 2.5 } },
      { limits: { 'Bad Key': 1 } },
      { code: 'No Spaces' },
    ]) {
      expect(
        await refusal(app.insert(packages).values({ ...base, code: `p_${counter++}`, ...bad })),
        JSON.stringify(bad),
      ).toMatch(CHECK);
    }
    const code = `p_${counter++}`;
    await app.insert(packages).values({ ...base, code });
    expect(await refusal(app.insert(packages).values({ ...base, code }))).toMatch(UNIQUE);
  });
});

describe('amendments', () => {
  it('follow the state table, one open at a time, and freeze once submitted or decided', async () => {
    const t = await seedTenant();
    const id = await amendment(t);
    expect(await refusal(amendment(t, 2))).toMatch(UNIQUE);
    const changes = {
      add: [{ kind: 'feature', featureKey: 'pos', effectiveFrom: 'now' }],
      end: [],
    };
    await app.update(agreementAmendments).set({ changes }).where(eq(agreementAmendments.id, id));
    // draft → approved skips the submission.
    expect(
      await refusal(
        app
          .update(agreementAmendments)
          .set({
            status: 'approved',
            submittedAt: new Date(),
            decidedAt: sql`now()`,
            decidedByOperator: 'f',
          })
          .where(eq(agreementAmendments.id, id)),
      ),
    ).toMatch(/cannot become/);
    await app
      .update(agreementAmendments)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(eq(agreementAmendments.id, id));
    expect(
      await refusal(
        app
          .update(agreementAmendments)
          .set({ changes: EMPTY })
          .where(eq(agreementAmendments.id, id)),
      ),
    ).toMatch(/frozen/);
    // Taken back to edit, then submitted and approved.
    await app
      .update(agreementAmendments)
      .set({ status: 'draft', submittedAt: null })
      .where(eq(agreementAmendments.id, id));
    await app
      .update(agreementAmendments)
      .set({ changes: EMPTY })
      .where(eq(agreementAmendments.id, id));
    await approve(id);
    expect(
      await refusal(
        app.update(agreementAmendments).set({ note: 'x' }).where(eq(agreementAmendments.id, id)),
      ),
    ).toMatch(/never changes/);
    expect(
      await refusal(app.delete(agreementAmendments).where(eq(agreementAmendments.id, id))),
    ).toMatch(DENIED);
    // The next amendment opens once the first is decided.
    await amendment(t, 2);
  });

  it('start as drafts, with one author and a reason for a rejection', async () => {
    const t = await seedTenant();
    const base = { agreementId: t.agreementId, number: 1, changes: EMPTY };
    expect(
      await refusal(
        app.insert(agreementAmendments).values({
          ...base,
          status: 'submitted',
          authoredByOperator: 's',
          submittedAt: new Date(),
        }),
      ),
    ).toMatch(/is a draft/);
    expect(await refusal(app.insert(agreementAmendments).values(base))).toMatch(CHECK);
    const id = await amendment(t);
    await app
      .update(agreementAmendments)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(eq(agreementAmendments.id, id));
    expect(
      await refusal(
        app
          .update(agreementAmendments)
          .set({ status: 'rejected', decidedAt: sql`now()`, decidedByOperator: 'f' })
          .where(eq(agreementAmendments.id, id)),
      ),
    ).toMatch(CHECK);
  });
});

describe('agreement terms', () => {
  it('are written only in their amendment’s approval, no earlier than it, and never change', async () => {
    const t = await seedTenant();
    const id = await amendment(t);
    expect(await refusal(app.insert(agreementTerms).values(featureTerm(t, id)))).toMatch(
      /only an approved amendment/,
    );
    await submit(id);
    // Backdated before its approval: refused, and the approval rolls back with it.
    expect(
      await refusal(
        approveWith(id, (tx) =>
          tx.insert(agreementTerms).values({ ...featureTerm(t, id), effectiveFrom: day(-30) }),
        ),
      ),
    ).toMatch(/no earlier than its approval/);
    // Approved with an old decision time to let an old term through: refused too.
    expect(
      await refusal(
        app.transaction(async (tx) => {
          await tx
            .update(agreementAmendments)
            .set({ status: 'approved', decidedAt: day(-60), decidedByOperator: 'finance1' })
            .where(eq(agreementAmendments.id, id));
          await tx
            .insert(agreementTerms)
            .values({ ...featureTerm(t, id), effectiveFrom: day(-30) });
        }),
      ),
    ).toMatch(/no earlier than its transaction/);
    const term = featureTerm(t, id);
    await approveWith(id, (tx) => tx.insert(agreementTerms).values(term));
    // A later transaction cannot add a term to an amendment approved earlier.
    expect(
      await refusal(app.insert(agreementTerms).values(featureTerm(t, id, 'waiter_app'))),
    ).toMatch(/in its approval/);
    expect(
      await refusal(
        app
          .update(agreementTerms)
          .set({ effectiveTo: new Date() })
          .where(eq(agreementTerms.id, term.id)),
      ),
    ).toMatch(DENIED);
    // A term names an amendment of its own agreement.
    const other = await seedTenant();
    const otherAmendment = await amendment(other);
    await submit(otherAmendment);
    expect(
      await refusal(
        approveWith(otherAmendment, (tx) =>
          tx.insert(agreementTerms).values(featureTerm(t, otherAmendment)),
        ),
      ),
    ).toMatch(FOREIGN);
  });

  it('hold the values of their kind, with the money columns mirroring them', async () => {
    const t = await seedTenant();
    const id = await amendment(t);
    await submit(id);
    const subscription = {
      kind: 'subscription',
      amount: 5000,
      currency: 'USD',
      period: 'month',
      per: 'tenant',
    };
    const row = (fields: Partial<typeof agreementTerms.$inferInsert>) =>
      ({
        id: uuidv7(),
        agreementId: t.agreementId,
        amendmentId: id,
        effectiveFrom: start,
        ...fields,
      }) as typeof agreementTerms.$inferInsert;
    for (const bad of [
      { kind: 'subscription', values: subscription, amountMinor: 4000, currency: 'USD' },
      {
        kind: 'subscription',
        values: { ...subscription, amount: 50.5 },
        amountMinor: 50,
        currency: 'USD',
      },
      {
        kind: 'subscription',
        values: { ...subscription, currency: 'EUR' },
        amountMinor: 5000,
        currency: 'EUR',
      },
      {
        kind: 'feature',
        values: { kind: 'feature', featureKey: 'pos' },
        amountMinor: 1,
        currency: 'USD',
      },
      { kind: 'feature', values: { kind: 'limit', limitKey: 'staff', value: 1 } },
      { kind: 'commission', values: { kind: 'commission', channel: 'web', percentBp: 0 } },
      { kind: 'commission', values: { kind: 'commission', channel: 'pos', percentBp: 10 } },
      { kind: 'delivery_fee_share', values: { kind: 'delivery_fee_share', percentBp: 10001 } },
      { kind: 'waiver', values: { kind: 'waiver', waives: { kind: 'commission' } } },
      {
        kind: 'setup_fee',
        values: { kind: 'setup_fee', amount: 9000, currency: 'USD', label: 'Setup' },
        amountMinor: 9000,
        currency: 'USD',
      },
      { kind: 'feature', values: { kind: 'feature', featureKey: 'pos' }, effectiveTo: start },
    ]) {
      expect(
        await refusal(
          approveWith(id, (tx) =>
            tx
              .insert(agreementTerms)
              .values(row(bad as Partial<typeof agreementTerms.$inferInsert>)),
          ),
        ),
        JSON.stringify(bad),
      ).toMatch(CHECK);
    }
    await approveWith(id, (tx) =>
      tx.insert(agreementTerms).values([
        row({ kind: 'subscription', values: subscription, amountMinor: 5000, currency: 'USD' }),
        row({
          kind: 'commission',
          values: {
            kind: 'commission',
            channel: 'web',
            percentBp: 0,
            fixed: { amount: 50, currency: 'TRY' },
          },
          amountMinor: 50,
          currency: 'TRY',
        }),
        // A one-off fee may be due in the past (a setup fee agreed at signing).
        row({
          kind: 'setup_fee',
          values: { kind: 'setup_fee', amount: 9000, currency: 'USD', label: 'Setup' },
          amountMinor: 9000,
          currency: 'USD',
          effectiveFrom: null,
          dueOn: '2026-10-01',
        }),
        row({
          kind: 'waiver',
          values: { kind: 'waiver', waives: { kind: 'commission', channel: 'web' } },
        }),
      ]),
    );
  });
});

describe('term endings', () => {
  it('close a dated term of the agreement once, in their approval, no earlier than its start', async () => {
    const t = await seedTenant();
    const first = await amendment(t);
    const term = featureTerm(t, first);
    const fee = {
      id: uuidv7(),
      agreementId: t.agreementId,
      amendmentId: first,
      kind: 'service',
      values: { kind: 'service', amount: 100, currency: 'USD', label: 'Training' },
      amountMinor: 100,
      currency: 'USD',
      dueOn: '2026-11-01',
    };
    await approve(first, (tx) => tx.insert(agreementTerms).values([term, fee]));
    const second = await amendment(t, 2);
    const end = (tx: Tx | typeof app, termId: string, endsAt: Date, amendmentId = second) =>
      tx.insert(agreementTermEndings).values({ termId, amendmentId, endsAt });
    expect(await refusal(end(app, term.id, day(30)))).toMatch(/only an approved amendment/);
    await submit(second);
    expect(await refusal(approveWith(second, (tx) => end(tx, fee.id, day(30))))).toMatch(
      /dated term/,
    );
    expect(await refusal(approveWith(second, (tx) => end(tx, term.id, day(-1))))).toMatch(
      /dated term/,
    );
    const other = await seedTenant();
    const foreign = await amendment(other);
    await submit(foreign);
    expect(await refusal(approveWith(foreign, (tx) => end(tx, term.id, day(30), foreign)))).toMatch(
      /dated term/,
    );
    await approveWith(second, (tx) => end(tx, term.id, day(30)));
    const third = await amendment(t, 3);
    await submit(third);
    expect(await refusal(approveWith(third, (tx) => end(tx, term.id, day(31), third)))).toMatch(
      UNIQUE,
    );
  });
});

describe('entitlement overrides', () => {
  it('need an expiry within the limit, except a grant, and are revoked once', async () => {
    const t = await seedTenant();
    const startsAt = new Date('2026-11-10T12:00:00Z');
    const base = {
      subjectTenantId: t.tenantId,
      reason: 'Trial',
      startsAt,
      createdByOperator: 'finance1',
    };
    const [grant] = await app
      .insert(entitlementOverrides)
      .values({ ...base, kind: 'grant', featureKey: 'made_for_one' })
      .returning();
    await app.insert(entitlementOverrides).values({
      ...base,
      kind: 'limit',
      limitKey: 'staff',
      value: 9,
      expiresAt: new Date('2026-12-10T01:00:00Z'),
    });
    for (const bad of [
      { kind: 'deny', featureKey: 'pos' },
      { kind: 'deny', featureKey: 'pos', expiresAt: new Date('2028-01-01T00:00:00Z') },
      { kind: 'grant', featureKey: 'pos', expiresAt: startsAt },
      { kind: 'limit', limitKey: 'staff', expiresAt: new Date('2026-12-10T00:00:00Z') },
      { kind: 'grant', featureKey: 'pos', limitKey: 'staff' },
      { kind: 'grant', featureKey: 'pos', reason: 'x' },
    ]) {
      expect(
        await refusal(app.insert(entitlementOverrides).values({ ...base, ...bad })),
        JSON.stringify(bad),
      ).toMatch(CHECK);
    }
    if (!grant) throw new Error('no grant');
    const revocation = {
      overrideId: grant.id,
      revokedAt: new Date(),
      reason: 'Ended',
      revokedByOperator: 'f',
    };
    await app.insert(entitlementOverrideRevocations).values(revocation);
    expect(await refusal(app.insert(entitlementOverrideRevocations).values(revocation))).toMatch(
      UNIQUE,
    );
    expect(
      await refusal(app.delete(entitlementOverrides).where(eq(entitlementOverrides.id, grant.id))),
    ).toMatch(DENIED);
  });
});

describe('branch entitlements', () => {
  it('are isolated per tenant, upserted in place and published to the sync service', async () => {
    const t = await seedTenant();
    const other = await seedTenant();
    const row = {
      tenantId: t.tenantId,
      branchId: t.branchId,
      version: 1,
      features: [{ key: 'pos', until: null }],
      limits: { devices: 3 },
    };
    await withTenant(app, t.tenantId, (tx) => tx.insert(branchEntitlements).values(row));
    await withTenant(app, t.tenantId, (tx) =>
      tx
        .insert(branchEntitlements)
        .values({ ...row, version: 2 })
        .onConflictDoUpdate({
          target: [branchEntitlements.tenantId, branchEntitlements.branchId],
          set: { version: 2, updatedAt: new Date() },
        }),
    );
    const seen = await withTenant(app, other.tenantId, (tx) =>
      tx.select().from(branchEntitlements),
    );
    expect(seen).toEqual([]);
    expect(
      await refusal(
        withTenant(app, other.tenantId, (tx) =>
          tx.insert(branchEntitlements).values({ ...row, tenantId: other.tenantId }),
        ),
      ),
    ).toMatch(FOREIGN);
    expect(
      await refusal(
        withTenant(app, t.tenantId, (tx) =>
          tx.insert(branchEntitlements).values({ ...row, features: [{ key: 'Bad' }] }),
        ),
      ),
    ).toMatch(CHECK);
    const [published] = await sync
      .select({ version: branchEntitlements.version })
      .from(branchEntitlements)
      .where(eq(branchEntitlements.branchId, t.branchId));
    expect(published?.version).toBe(2);
    // The jobs role reaches a tenant's copies only inside that tenant.
    expect(await jobs.select().from(branchEntitlements)).toEqual([]);
    const own = await withTenant(jobs, t.tenantId, (tx) => tx.select().from(branchEntitlements));
    expect(own).toHaveLength(1);
  });
});

describe('entitlement states and exceptions', () => {
  it('keep one state per tenant and one exception per command, of the tenant’s branch', async () => {
    const t = await seedTenant();
    const resolved = { at: new Date().toISOString(), features: [], limits: [], validUntil: null };
    await app.insert(entitlementStates).values({
      subjectTenantId: t.tenantId,
      version: 1,
      resolved,
      computedAt: new Date(),
    });
    expect(
      await refusal(
        app.insert(entitlementStates).values({
          subjectTenantId: t.tenantId,
          version: 1,
          resolved,
          computedAt: new Date(),
        }),
      ),
    ).toMatch(UNIQUE);
    const [state] = await jobs
      .select({ version: entitlementStates.version })
      .from(entitlementStates)
      .where(eq(entitlementStates.subjectTenantId, t.tenantId));
    expect(state?.version).toBe(1);
    expect(await refusal(jobs.select().from(packages))).toMatch(DENIED);

    const exception = {
      subjectTenantId: t.tenantId,
      branchId: t.branchId,
      deviceId: t.deviceId,
      commandId: uuidv7(),
      featureKey: 'waiter_app',
      effectiveAt: new Date(),
    };
    await app.insert(entitlementExceptions).values(exception);
    expect(await refusal(app.insert(entitlementExceptions).values(exception))).toMatch(UNIQUE);
    const other = await seedTenant();
    expect(
      await refusal(
        app
          .insert(entitlementExceptions)
          .values({ ...exception, commandId: uuidv7(), branchId: other.branchId }),
      ),
    ).toMatch(FOREIGN);
    expect(
      await refusal(app.execute(sql`update entitlement_exceptions set feature_key = 'pos'`)),
    ).toMatch(DENIED);
  });
});

it('keeps the append-only commercial tables from every role', async () => {
  const t = await seedTenant();
  const id = await amendment(t);
  const term = featureTerm(t, id);
  await approve(id, (tx) => tx.insert(agreementTerms).values(term));
  // The owner owns the tables; the trigger still refuses.
  expect(
    await refusal(owner.execute(sql`delete from agreement_terms where id = ${term.id}`)),
  ).toMatch(APPEND_ONLY);
});

describe('four eyes (rule 11)', () => {
  it('refuses an approval by the author, as a user or by the operator’s name', async () => {
    const t = await seedTenant();
    const [author] = await app
      .insert(platformUsers)
      .values({ phone: newPhone(), name: 'مبيعات تجريبي', role: 'sales' })
      .returning();
    if (!author) throw new Error('no user');
    const byUser = uuidv7();
    await app.insert(agreementAmendments).values({
      id: byUser,
      agreementId: t.agreementId,
      number: 1,
      changes: EMPTY,
      authoredBy: author.id,
    });
    await submit(byUser);
    expect(
      await refusal(
        app
          .update(agreementAmendments)
          .set({ status: 'approved', decidedAt: sql`now()`, decidedBy: author.id })
          .where(eq(agreementAmendments.id, byUser)),
      ),
    ).toMatch(CHECK);
    await app
      .update(agreementAmendments)
      .set({ status: 'withdrawn', decidedAt: sql`now()`, decidedBy: author.id })
      .where(eq(agreementAmendments.id, byUser));
    const id = await amendment(t, 2);
    await submit(id);
    expect(
      await refusal(
        app
          .update(agreementAmendments)
          .set({ status: 'approved', decidedAt: sql`now()`, decidedByOperator: ' Sales1 ' })
          .where(eq(agreementAmendments.id, id)),
      ),
    ).toMatch(CHECK);
  });
});
