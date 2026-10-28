import { readFileSync } from 'node:fs';
import { effectivePermissions, numberBlockRange } from '@vertex-food/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  appendAccessSnapshot,
  attentionItems,
  branchCaKeys,
  branchCertificateAuthorities,
  branches,
  commandLog,
  commandPayloads,
  devices,
  membershipAccessSnapshots,
  numberBlocks,
  quarantineBatches,
  staffMembershipBranches,
  staffMemberships,
  tenantSlugs,
  tenants,
  withTenant,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// Spec S04 in the database: the command log and its payloads isolated per tenant and append-only,
// the guards of the rules (one hub and one standby, block layout, one item per command and kind,
// one batch per revocation), what the sync role may read, and the access snapshots.

const { owner, app, sync } = connect();
const UNIQUE = /duplicate key value violates unique constraint/;
const CHECK = /violates check constraint/;
const APPEND_ONLY = /append-only/;
const DENIED = /permission denied for table/;
const HASH = 'a'.repeat(64);

let phoneCounter = 0;
const newPhone = () => `+9639450${String(Date.now() % 100000).padStart(5, '0')}${phoneCounter++}`;
const publicKey = () => `${uuidv7().replace(/-/g, '').slice(0, 32)}${'A'.repeat(10)}A=`;

async function seedTenant() {
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const membershipId = uuidv7();
  const deviceId = uuidv7();
  const accountId = uuidv7();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `t-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
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
      publicKey: publicKey(),
      os: 'Windows 11',
      appVersion: '0.1.0',
      registeredByMembershipId: membershipId,
    });
  });
  return { tenantId, branchId, membershipId, deviceId };
}

type Seeded = Awaited<ReturnType<typeof seedTenant>>;

async function addDevice(t: Seeded): Promise<string> {
  const id = uuidv7();
  await withTenant(app, t.tenantId, (tx) =>
    tx.insert(devices).values({
      id,
      tenantId: t.tenantId,
      branchId: t.branchId,
      name: 'الكاشير 2',
      publicKey: publicKey(),
      os: 'Windows 11',
      appVersion: '0.1.0',
      registeredByMembershipId: t.membershipId,
    }),
  );
  return id;
}

function logged(t: Seeded, overrides: Partial<typeof commandLog.$inferInsert> = {}) {
  const now = new Date();
  return {
    id: uuidv7(),
    tenantId: t.tenantId,
    branchId: t.branchId,
    name: 'sync.network_check',
    version: 1,
    protocol: 1,
    originKind: 'pc',
    originDeviceId: t.deviceId,
    executedByDeviceId: t.deviceId,
    uploadedByDeviceId: t.deviceId,
    actorKind: 'member',
    membershipId: t.membershipId,
    hubEpoch: 1,
    hubSeq: 1,
    deviceTime: now,
    clockOffsetMs: 0,
    effectiveTime: now,
    receivedAt: now,
    payloadHash: HASH,
    outcome: 'accepted',
    ...overrides,
  } satisfies typeof commandLog.$inferInsert;
}

describe('the command log', () => {
  it('keeps a tenant’s commands and payloads from every other tenant', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const command = logged(a);
    await withTenant(app, a.tenantId, async (tx) => {
      await tx.insert(commandLog).values(command);
      await tx.insert(commandPayloads).values({
        tenantId: a.tenantId,
        commandId: command.id,
        payload: { sequence: 1 },
        resolved: {},
      });
    });
    const seen = await withTenant(app, b.tenantId, async (tx) => ({
      log: await tx.select().from(commandLog).where(eq(commandLog.id, command.id)),
      payloads: await tx
        .select()
        .from(commandPayloads)
        .where(eq(commandPayloads.commandId, command.id)),
    }));
    expect(seen).toEqual({ log: [], payloads: [] });
  });

  it('refuses any change to a recorded outcome', async () => {
    const t = await seedTenant();
    const command = logged(t);
    await withTenant(app, t.tenantId, (tx) => tx.insert(commandLog).values(command));
    expect(
      await refusal(
        withTenant(owner, t.tenantId, (tx) =>
          tx
            .update(commandLog)
            .set({ outcome: 'rejected', reason: 'server_error' })
            .where(eq(commandLog.id, command.id)),
        ),
      ),
    ).toMatch(APPEND_ONLY);
  });

  it('names a membership for a member, a pairing for a station, neither for the PC', async () => {
    const t = await seedTenant();
    const refuse = (overrides: Partial<typeof commandLog.$inferInsert>) =>
      refusal(
        withTenant(app, t.tenantId, (tx) => tx.insert(commandLog).values(logged(t, overrides))),
      );
    expect(await refuse({ actorKind: 'member', membershipId: null })).toMatch(CHECK);
    expect(await refuse({ actorKind: 'station', membershipId: null })).toMatch(CHECK);
    expect(await refuse({ actorKind: 'device' })).toMatch(CHECK);
    expect(await refuse({ outcome: 'rejected' })).toMatch(CHECK);
    expect(await refuse({ reason: 'not_a_reason' })).toMatch(CHECK);
    expect(await refuse({ effectiveTime: new Date(Date.now() + 60_000) })).toMatch(CHECK);
    await withTenant(app, t.tenantId, (tx) =>
      tx
        .insert(commandLog)
        .values(logged(t, { actorKind: 'station', membershipId: null, pairingId: uuidv7() })),
    );
  });

  it('opens one attention item per command and kind', async () => {
    const t = await seedTenant();
    const command = logged(t, { outcome: 'adjusted' });
    const item = {
      tenantId: t.tenantId,
      branchId: t.branchId,
      commandId: command.id,
      membershipId: t.membershipId,
    };
    await withTenant(app, t.tenantId, async (tx) => {
      await tx.insert(commandLog).values(command);
      await tx.insert(attentionItems).values({ ...item, kind: 'adjusted' });
      await tx.insert(attentionItems).values({ ...item, kind: 'clock_suspect' });
    });
    expect(
      await refusal(
        withTenant(app, t.tenantId, (tx) =>
          tx.insert(attentionItems).values({ ...item, kind: 'adjusted' }),
        ),
      ),
    ).toMatch(UNIQUE);
  });
});

describe('hub roles (rule 38)', () => {
  it('allows one hub and one standby among the active PCs of a branch', async () => {
    const t = await seedTenant();
    const second = await addDevice(t);
    const third = await addDevice(t);
    const setRole = (deviceId: string, hubRole: string | null) =>
      withTenant(app, t.tenantId, (tx) =>
        tx.update(devices).set({ hubRole }).where(eq(devices.id, deviceId)),
      );
    await setRole(t.deviceId, 'hub');
    await setRole(second, 'standby');
    expect(await refusal(setRole(third, 'hub'))).toMatch(UNIQUE);
    expect(await refusal(setRole(third, 'client'))).toMatch(CHECK);
    // A revoked PC no longer holds its role.
    await withTenant(app, t.tenantId, (tx) =>
      tx
        .update(devices)
        .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'other' })
        .where(eq(devices.id, t.deviceId)),
    );
    await setRole(third, 'hub');
  });
});

describe('number blocks (rules 17, 20)', () => {
  it('holds the block layout and hands a block once per branch and a PC one per day', async () => {
    const t = await seedTenant();
    const second = await addDevice(t);
    const block = (deviceId: string, blockIndex: number, businessDate = '2026-10-28') => ({
      tenantId: t.tenantId,
      branchId: t.branchId,
      series: 'order',
      businessDate,
      blockIndex,
      firstNumber: numberBlockRange(blockIndex).first,
      lastNumber: numberBlockRange(blockIndex).last,
      deviceId,
      allocatedAt: new Date(),
    });
    const insert = (row: typeof numberBlocks.$inferInsert) =>
      withTenant(app, t.tenantId, (tx) => tx.insert(numberBlocks).values(row));
    await insert(block(t.deviceId, 1));
    await insert(block(second, 2));
    expect(await refusal(insert(block(second, 1, '2026-10-28')))).toMatch(UNIQUE);
    expect(await refusal(insert(block(t.deviceId, 3)))).toMatch(UNIQUE);
    expect(
      await refusal(insert({ ...block(t.deviceId, 1, '2026-10-29'), lastNumber: 5000 })),
    ).toMatch(CHECK);
    await insert(block(t.deviceId, 1, '2026-10-29'));
  });
});

describe('the quarantine (rules 40–42)', () => {
  it('holds one batch per revoked PC, and a member for a member’s batch', async () => {
    const t = await seedTenant();
    const batch = { tenantId: t.tenantId, branchId: t.branchId, deviceId: t.deviceId };
    const insert = (row: typeof quarantineBatches.$inferInsert) =>
      withTenant(app, t.tenantId, (tx) => tx.insert(quarantineBatches).values(row));
    await insert({ ...batch, reason: 'device_revoked' });
    expect(await refusal(insert({ ...batch, reason: 'device_revoked' }))).toMatch(UNIQUE);
    expect(await refusal(insert({ ...batch, reason: 'member_inactive' }))).toMatch(CHECK);
    await insert({ ...batch, reason: 'member_inactive', membershipId: t.membershipId });
    await insert({ ...batch, reason: 'member_inactive', membershipId: t.membershipId });
  });
});

describe('the sync role (ADR 0035)', () => {
  it('reads the published tables and never the payloads or the CA keys', async () => {
    const t = await seedTenant();
    const command = logged(t);
    const [authority] = await withTenant(app, t.tenantId, async (tx) => {
      await tx.insert(commandLog).values(command);
      await tx
        .insert(commandPayloads)
        .values({ tenantId: t.tenantId, commandId: command.id, payload: {}, resolved: {} });
      const rows = await tx
        .insert(branchCertificateAuthorities)
        .values({
          tenantId: t.tenantId,
          branchId: t.branchId,
          certificatePem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----',
          fingerprintSha256: HASH,
        })
        .returning();
      return rows;
    });
    if (!authority) throw new Error('no authority');
    await withTenant(app, t.tenantId, (tx) =>
      tx
        .insert(branchCaKeys)
        .values({ tenantId: t.tenantId, authorityId: authority.id, privateKeySealed: 'v1.a.b.c' }),
    );
    const [row] = await sync
      .select({ id: commandLog.id })
      .from(commandLog)
      .where(eq(commandLog.id, command.id));
    expect(row?.id).toBe(command.id);
    expect(await refusal(sync.select().from(commandPayloads))).toMatch(DENIED);
    expect(await refusal(sync.select().from(branchCaKeys))).toMatch(DENIED);
    expect(await refusal(sync.select().from(membershipAccessSnapshots))).toMatch(DENIED);
  });
});

describe('access snapshots (ADR 0035)', () => {
  async function addMember(
    t: Seeded,
    input: { roles: string[]; granted?: string[]; revoked?: string[]; allBranches?: boolean },
  ) {
    const accountId = uuidv7();
    const id = uuidv7();
    await app.insert(accounts).values({ id: accountId, phone: newPhone() });
    await withTenant(app, t.tenantId, async (tx) => {
      await tx.insert(staffMemberships).values({
        id,
        tenantId: t.tenantId,
        accountId,
        roles: input.roles,
        allBranches: input.allBranches ?? false,
        grantedPermissions: input.granted ?? [],
        revokedPermissions: input.revoked ?? [],
        displayName: 'عضو تجريبي',
      });
      if (!input.allBranches) {
        await tx
          .insert(staffMembershipBranches)
          .values({ tenantId: t.tenantId, membershipId: id, branchId: t.branchId });
      }
    });
    return id;
  }

  const latest = (t: Seeded, membershipId: string) =>
    withTenant(app, t.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(membershipAccessSnapshots)
        .where(eq(membershipAccessSnapshots.membershipId, membershipId))
        .orderBy(desc(membershipAccessSnapshots.createdAt), desc(membershipAccessSnapshots.id))
        .limit(1);
      return row;
    });

  it('records the effective permissions and branches as they stand', async () => {
    const t = await seedTenant();
    const manager = await addMember(t, {
      roles: ['manager'],
      granted: ['branch.settings.edit'],
      revoked: ['hub.manage'],
    });
    await withTenant(app, t.tenantId, (tx) => appendAccessSnapshot(tx, manager));
    expect(await latest(t, manager)).toMatchObject({
      status: 'active',
      roles: ['manager'],
      allBranches: false,
      branchIds: [t.branchId],
      permissions: effectivePermissions(['manager'], ['branch.settings.edit'], ['hub.manage']),
    });
    await withTenant(app, t.tenantId, async (tx) => {
      await tx
        .update(staffMemberships)
        .set({ status: 'deactivated', deactivatedAt: new Date(), deactivationReason: 'left' })
        .where(eq(staffMemberships.id, manager));
      await appendAccessSnapshot(tx, manager);
    });
    expect((await latest(t, manager))?.status).toBe('deactivated');
  });

  it('are backfilled by the migration with the same permissions as effectivePermissions', async () => {
    const t = await seedTenant();
    const cases = [
      { roles: ['owner'], allBranches: true, revoked: ['branch.hours.edit', 'staff.manage'] },
      {
        roles: ['manager', 'cashier'],
        granted: ['branch.settings.edit'],
        revoked: ['devices.manage'],
      },
      { roles: ['cashier'], granted: ['staff.view', 'sync.quarantine.review'] },
      { roles: ['kitchen', 'waiter'] },
    ];
    const ids = [];
    for (const input of cases) ids.push(await addMember(t, input));
    // The migration's backfill block, run again: it writes one more snapshot per membership.
    const migration = readFileSync(
      new URL('../migrations/0011_sync-isolation-grants-publication.sql', import.meta.url),
      'utf8',
    );
    const backfill = migration.slice(migration.indexOf('DO $$'), migration.indexOf('$$;') + 3);
    await owner.transaction((tx) => tx.execute(sql.raw(backfill)));
    for (const [i, input] of cases.entries()) {
      const id = ids[i] as string;
      const row = await latest(t, id);
      expect(row?.permissions, input.roles.join()).toEqual(
        effectivePermissions(
          input.roles as never,
          (input.granted ?? []) as never,
          (input.revoked ?? []) as never,
        ),
      );
      expect(row?.branchIds).toEqual(input.allBranches ? [] : [t.branchId]);
      expect(row?.effectiveFrom).toBeInstanceOf(Date);
    }
    const [check] = await withTenant(app, t.tenantId, (tx) =>
      tx
        .select({ version: sql<number>`uuid_extract_version(${membershipAccessSnapshots.id})` })
        .from(membershipAccessSnapshots)
        .where(and(eq(membershipAccessSnapshots.tenantId, t.tenantId)))
        .limit(1),
    );
    expect(check?.version).toBe(7);
  });
});
