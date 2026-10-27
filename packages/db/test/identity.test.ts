import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  accountTenantLinks,
  branches,
  devices,
  platformSessions,
  platformUsers,
  staffMembershipBranches,
  staffMemberships,
  staffPins,
  staffSessions,
  tenantSlugs,
  tenants,
  usedTokens,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S02 in the database: memberships, PINs, devices and sessions isolated per tenant as the app
// role, composite keys that stop another tenant's ids, the guards of the rules, and the
// append-only used tokens.

const { owner, app } = connect();
const RLS_REFUSAL = /new row violates row-level security policy/;
const DENIED = /permission denied for table/;
const FK_REFUSAL = /violates foreign key constraint/;

const PUBLIC_KEY = `${'A'.repeat(42)}A=`;
const VERIFIER = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo';
let phoneCounter = 0;
const newPhone = () => `+9639440${String(Date.now() % 100000).padStart(5, '0')}${phoneCounter++}`;

/** A tenant with a branch, an owner and a registered PC, made as the app role. */
async function seedTenant() {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const accountId = uuidv7();
  const membershipId = uuidv7();
  const deviceId = uuidv7();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
    await tx.insert(accounts).values({ id: accountId, phone: newPhone() });
    await tx.insert(accountTenantLinks).values({ accountId, linkedTenantId: tenantId });
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
  return { tenantId, branchId, accountId, membershipId, deviceId };
}

describe('tenant tables of S02', () => {
  it('show another tenant no membership, PIN, device or session', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await withTenant(app, a.tenantId, async (tx) => {
      await tx.insert(staffPins).values({
        tenantId: a.tenantId,
        membershipId: a.membershipId,
        verifier: VERIFIER,
        setOnDeviceId: a.deviceId,
        setByMembershipId: a.membershipId,
      });
      await tx.insert(staffSessions).values({
        tenantId: a.tenantId,
        membershipId: a.membershipId,
        kind: 'device',
        deviceId: a.deviceId,
        refreshTokenHash: `hash-${a.tenantId}`,
        expiresAt: new Date(Date.now() + 3600_000),
      });
    });
    const seen = await withTenant(app, b.tenantId, async (tx) => ({
      memberships: await tx
        .select()
        .from(staffMemberships)
        .where(eq(staffMemberships.id, a.membershipId)),
      pins: await tx.select().from(staffPins).where(eq(staffPins.membershipId, a.membershipId)),
      devices: await tx.select().from(devices).where(eq(devices.id, a.deviceId)),
      sessions: await tx
        .select()
        .from(staffSessions)
        .where(eq(staffSessions.membershipId, a.membershipId)),
    }));
    expect(seen).toEqual({ memberships: [], pins: [], devices: [], sessions: [] });
    // Outside any tenant the app role sees none of them either.
    expect(await app.select().from(staffMemberships)).toEqual([]);
  });

  it('refuse rows written for another tenant', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    expect(
      await refusal(
        withTenant(app, b.tenantId, (tx) =>
          tx.insert(staffMemberships).values({
            tenantId: a.tenantId,
            accountId: b.accountId,
            roles: ['cashier'],
            displayName: 'كاشير',
          }),
        ),
      ),
    ).toMatch(RLS_REFUSAL);
  });

  it("refuse another tenant's branch, member or device in a composite key", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    expect(
      await refusal(
        withTenant(app, b.tenantId, (tx) =>
          tx.insert(staffMembershipBranches).values({
            tenantId: b.tenantId,
            membershipId: b.membershipId,
            branchId: a.branchId,
          }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
    expect(
      await refusal(
        withTenant(app, b.tenantId, (tx) =>
          tx.insert(staffPins).values({
            tenantId: b.tenantId,
            membershipId: b.membershipId,
            verifier: VERIFIER,
            setOnDeviceId: a.deviceId,
            setByMembershipId: b.membershipId,
          }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
    expect(
      await refusal(
        withTenant(app, b.tenantId, (tx) =>
          tx.insert(devices).values({
            tenantId: b.tenantId,
            branchId: b.branchId,
            name: 'PC',
            publicKey: PUBLIC_KEY,
            os: 'Windows',
            appVersion: '0.1.0',
            registeredByMembershipId: a.membershipId,
          }),
        ),
      ),
    ).toMatch(FK_REFUSAL);
  });

  it('give the app role no DELETE on any of them', async () => {
    const a = await seedTenant();
    for (const table of [
      staffMemberships,
      staffMembershipBranches,
      devices,
      staffPins,
      staffSessions,
    ]) {
      expect(await refusal(withTenant(app, a.tenantId, (tx) => tx.delete(table)))).toMatch(DENIED);
    }
  });
});

describe('the guards of the rules', () => {
  it('keep owners on every branch and roles distinct (rule 4)', async () => {
    const a = await seedTenant();
    const accountId = uuidv7();
    await app.insert(accounts).values({ id: accountId, phone: newPhone() });
    const member = (values: Partial<typeof staffMemberships.$inferInsert>) =>
      withTenant(app, a.tenantId, (tx) =>
        tx.insert(staffMemberships).values({
          tenantId: a.tenantId,
          accountId,
          roles: ['cashier'],
          displayName: 'عضو',
          ...values,
        }),
      );
    expect(await refusal(member({ roles: ['owner'], allBranches: false }))).toMatch(
      /staff_memberships_owner_all_branches/,
    );
    expect(await refusal(member({ roles: ['cashier', 'cashier'] }))).toMatch(
      /staff_memberships_roles/,
    );
    expect(await refusal(member({ roles: ['chef'] }))).toMatch(/staff_memberships_roles/);
    expect(
      await refusal(
        member({ grantedPermissions: ['staff.view'], revokedPermissions: ['staff.view'] }),
      ),
    ).toMatch(/staff_memberships_adjustments_disjoint/);
  });

  it('keep one membership per account and tenant, and one current PIN per member', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.insert(staffMemberships).values({
            tenantId: a.tenantId,
            accountId: a.accountId,
            roles: ['cashier'],
            displayName: 'مرة ثانية',
          }),
        ),
      ),
    ).toMatch(/staff_memberships_tenant_account_unique/);
    const pin = {
      tenantId: a.tenantId,
      membershipId: a.membershipId,
      verifier: VERIFIER,
      setOnDeviceId: a.deviceId,
      setByMembershipId: a.membershipId,
    };
    await withTenant(app, a.tenantId, (tx) => tx.insert(staffPins).values(pin));
    expect(
      await refusal(withTenant(app, a.tenantId, (tx) => tx.insert(staffPins).values(pin))),
    ).toMatch(/staff_pins_current_idx/);
  });

  it('store only Argon2id verifiers and password hashes', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.insert(staffPins).values({
            tenantId: a.tenantId,
            membershipId: a.membershipId,
            verifier: '123456',
            setOnDeviceId: a.deviceId,
            setByMembershipId: a.membershipId,
          }),
        ),
      ),
    ).toMatch(/staff_pins_verifier/);
    expect(
      await refusal(
        app.update(accounts).set({ passwordHash: 'plain' }).where(eq(accounts.id, a.accountId)),
      ),
    ).toMatch(/accounts_password_hash/);
  });

  it('keep a revoked device revoked (rule 19)', async () => {
    const a = await seedTenant();
    const revoke = withTenant(app, a.tenantId, (tx) =>
      tx
        .update(devices)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedByMembershipId: a.membershipId,
          revokeReason: 'lost_or_stolen',
        })
        .where(eq(devices.id, a.deviceId)),
    );
    await revoke;
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx
            .update(devices)
            .set({ status: 'active', revokedAt: null, revokeReason: null })
            .where(eq(devices.id, a.deviceId)),
        ),
      ),
    ).toMatch(/a revoked device stays revoked/);
    await withTenant(app, a.tenantId, (tx) =>
      tx.update(devices).set({ wipedAt: new Date() }).where(eq(devices.id, a.deviceId)),
    );
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx
            .update(devices)
            .set({ wipedAt: new Date(0) })
            .where(eq(devices.id, a.deviceId)),
        ),
      ),
    ).toMatch(/a revoked device stays revoked/);
  });

  it('keep an ended session ended, staff and console', async () => {
    const a = await seedTenant();
    const sessionId = uuidv7();
    await withTenant(app, a.tenantId, (tx) =>
      tx.insert(staffSessions).values({
        id: sessionId,
        tenantId: a.tenantId,
        membershipId: a.membershipId,
        kind: 'device',
        deviceId: a.deviceId,
        refreshTokenHash: `hash-${sessionId}`,
        expiresAt: new Date(Date.now() + 3600_000),
        endedAt: new Date(),
        endReason: 'signed_out',
      }),
    );
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx
            .update(staffSessions)
            .set({ endedAt: null, endReason: null })
            .where(eq(staffSessions.id, sessionId)),
        ),
      ),
    ).toMatch(/an ended session stays ended/);

    const userId = uuidv7();
    await app
      .insert(platformUsers)
      .values({ id: userId, phone: newPhone(), name: 'مسؤول', role: 'admin' });
    const [session] = await app
      .insert(platformSessions)
      .values({
        platformUserId: userId,
        tokenHash: `console-${userId}`,
        expiresAt: new Date(Date.now() + 3600_000),
        endedAt: new Date(),
        endReason: 'idle',
      })
      .returning({ id: platformSessions.id });
    expect(
      await refusal(
        app
          .update(platformSessions)
          .set({ endReason: 'signed_out' })
          .where(eq(platformSessions.id, session?.id ?? '')),
      ),
    ).toMatch(/an ended session stays ended/);
  });

  it('tie a session to a device or a personal device by its kind', async () => {
    const a = await seedTenant();
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.insert(staffSessions).values({
            tenantId: a.tenantId,
            membershipId: a.membershipId,
            kind: 'personal',
            deviceId: a.deviceId,
            refreshTokenHash: `hash-${uuidv7()}`,
            expiresAt: new Date(Date.now() + 3600_000),
          }),
        ),
      ),
    ).toMatch(/staff_sessions_kind_device/);
  });

  it('keep the idle lock between 1 and 60 minutes, 5 by default (rule 32)', async () => {
    const a = await seedTenant();
    const [branch] = await withTenant(app, a.tenantId, (tx) =>
      tx
        .select({ minutes: branches.idleLockMinutes })
        .from(branches)
        .where(eq(branches.id, a.branchId)),
    );
    expect(branch?.minutes).toBe(5);
    expect(
      await refusal(
        withTenant(app, a.tenantId, (tx) =>
          tx.update(branches).set({ idleLockMinutes: 61 }).where(eq(branches.id, a.branchId)),
        ),
      ),
    ).toMatch(/branches_idle_lock_minutes/);
  });
});

describe('used_tokens', () => {
  it('records a use once, and never forgets it', async () => {
    const token = { kind: 'ticket', tokenId: uuidv7(), expiresAt: new Date(Date.now() + 600_000) };
    await app.insert(usedTokens).values(token);
    expect(await refusal(app.insert(usedTokens).values(token))).toMatch(
      /used_tokens_kind_token_id_unique/,
    );
    expect(
      await refusal(
        app
          .update(usedTokens)
          .set({ kind: 'console_step' })
          .where(eq(usedTokens.tokenId, token.tokenId)),
      ),
    ).toMatch(DENIED);
    expect(
      await refusal(app.delete(usedTokens).where(eq(usedTokens.tokenId, token.tokenId))),
    ).toMatch(DENIED);
    expect(
      await refusal(owner.delete(usedTokens).where(eq(usedTokens.tokenId, token.tokenId))),
    ).toBe('used_tokens is append-only: DELETE refused');
    expect(await refusal(owner.execute(sql`truncate used_tokens`))).toBe(
      'used_tokens is append-only: TRUNCATE refused',
    );
  });
});
