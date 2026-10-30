import type { INestApplication } from '@nestjs/common';
import { eventCatalog } from '@vertex-food/contracts';
import {
  accounts,
  auditEntries,
  branchConnectivity,
  branchConnectivityChanges,
  branches,
  createDatabase,
  deviceSyncStates,
  devices,
  eq,
  outboxEvents,
  staffMemberships,
  tenantSlugs,
  tenants,
  withTenant,
} from '@vertex-food/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { ClearRevokedHubRoleJob } from '../src/jobs/sync/clear-revoked-hub-role.job.js';
import { ConnectivitySweepJob } from '../src/jobs/sync/connectivity-sweep.job.js';
import { startWorker } from './worker.js';

// Spec S04's jobs: sync/connectivity-sweep moves branches whose heartbeats stopped to weak or
// offline, once, across tenants; the device.revoked.v1 consumer, fed by the outbox dispatcher,
// clears the revoked PC's hub role. Synthetic tenants written as the app role, as the API would.

const app = createDatabase(inject('appUrl'));
const jobsDb = createDatabase(inject('jobsUrl'));
let worker: INestApplication;
let sweep: ConnectivitySweepJob;

beforeAll(async () => {
  worker = await startWorker({ events: [ClearRevokedHubRoleJob], repeating: [] });
  sweep = new ConnectivitySweepJob(jobsDb);
});
afterAll(async () => {
  await worker.close();
  await app.$client.end();
  await jobsDb.$client.end();
});

let counter = 0;

/** A tenant with a branch and its hub, whose last heartbeat was `secondsAgo`, in `state`. */
async function branchWithHub(secondsAgo: number, state: 'online' | 'weak' | 'offline') {
  counter += 1;
  const tenantId = uuidv7();
  const branchId = uuidv7();
  const membershipId = uuidv7();
  const accountId = uuidv7();
  const deviceId = uuidv7();
  const now = new Date();
  await app.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, nameAr: 'مطعم تجريبي', defaultCurrency: 'USD' });
    await tx
      .insert(tenantSlugs)
      .values({ slug: `s-${tenantId.slice(-12)}`, subjectTenantId: tenantId, isPrimary: true });
    await tx.insert(accounts).values({
      id: accountId,
      phone: `+96394${String(Date.now() % 1_000_000).padStart(6, '0')}${counter % 10}`,
    });
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
      publicKey: `${deviceId.replace(/-/g, '').slice(0, 32)}${'A'.repeat(10)}A=`,
      os: 'Windows 11',
      appVersion: '0.1.0',
      registeredByMembershipId: membershipId,
      hubRole: 'hub',
    });
    await tx.insert(deviceSyncStates).values({
      tenantId,
      deviceId,
      lastHeartbeatAt: new Date(now.getTime() - secondsAgo * 1000),
      recentRttMs: [40, 40, 40, 40, 40],
      pendingUploads: 0,
      liveRole: 'hub',
      hubEpoch: 1,
      appVersion: '0.1.0',
      protocol: 1,
    });
    await tx
      .insert(branchConnectivity)
      .values({ tenantId, branchId, state, since: new Date(now.getTime() - 3_600_000) });
  });
  return { tenantId, branchId, deviceId };
}

const stateOf = (b: { tenantId: string; branchId: string }) =>
  withTenant(app, b.tenantId, async (tx) => {
    const [row] = await tx
      .select({ state: branchConnectivity.state })
      .from(branchConnectivity)
      .where(eq(branchConnectivity.branchId, b.branchId));
    const changes = await tx
      .select({ from: branchConnectivityChanges.fromState, to: branchConnectivityChanges.toState })
      .from(branchConnectivityChanges);
    const events = await tx
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.type, 'branch.connectivity_changed.v1'));
    return { state: row?.state, changes, events: events.map((event) => event.payload) };
  });

describe('sync/connectivity-sweep (rule 44)', () => {
  it('runs every 15 seconds', () => {
    expect(sweep.intervalMs).toBe(15_000);
    expect(sweep.name).toBe('sync.connectivity-sweep');
  });

  it('moves silent branches of every tenant to weak or offline once, with the change and its event', async () => {
    const silent = await branchWithHub(60, 'online');
    const gone = await branchWithHub(200, 'weak');
    const healthy = await branchWithHub(5, 'online');
    expect(await sweep.run()).toBeGreaterThanOrEqual(2);
    expect(await stateOf(silent)).toEqual({
      state: 'weak',
      changes: [{ from: 'online', to: 'weak' }],
      events: [
        { tenantId: silent.tenantId, branchId: silent.branchId, from: 'online', to: 'weak' },
      ],
    });
    expect(await stateOf(gone)).toMatchObject({
      state: 'offline',
      changes: [{ from: 'weak', to: 'offline' }],
    });
    expect(await stateOf(healthy)).toEqual({ state: 'online', changes: [], events: [] });
    // Twice: nothing more.
    await sweep.run();
    expect((await stateOf(silent)).changes).toHaveLength(1);
    expect((await stateOf(gone)).changes).toHaveLength(1);
  });

  it('never raises a state, which only heartbeats do', async () => {
    const weak = await branchWithHub(5, 'weak');
    await sweep.run();
    expect((await stateOf(weak)).state).toBe('weak');
  });
});

describe('the device.revoked.v1 consumer', () => {
  it('clears a revoked PC’s hub role once, through the outbox, with its audit entry', async () => {
    const b = await branchWithHub(5, 'online');
    await withTenant(app, b.tenantId, async (tx) => {
      await tx
        .update(devices)
        .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'lost_or_stolen' })
        .where(eq(devices.id, b.deviceId));
      const payload = eventCatalog['device.revoked.v1'].parse({
        tenantId: b.tenantId,
        branchId: b.branchId,
        deviceId: b.deviceId,
      });
      // Twice, as a retried delivery would: the second changes nothing.
      await tx.insert(outboxEvents).values([
        { tenantId: b.tenantId, type: 'device.revoked.v1', payload },
        { tenantId: b.tenantId, type: 'device.revoked.v1', payload },
      ]);
    });
    const read = () =>
      withTenant(app, b.tenantId, async (tx) => {
        const [device] = await tx
          .select({ hubRole: devices.hubRole })
          .from(devices)
          .where(eq(devices.id, b.deviceId));
        const pending = await tx
          .select({ id: outboxEvents.id, dispatchedAt: outboxEvents.dispatchedAt })
          .from(outboxEvents)
          .where(eq(outboxEvents.type, 'device.revoked.v1'));
        const audited = await tx
          .select({
            details: auditEntries.details,
            actorName: auditEntries.actorName,
            branchId: auditEntries.branchId,
          })
          .from(auditEntries)
          .where(eq(auditEntries.action, 'branch.hub_roles_changed'));
        return { hubRole: device?.hubRole, pending, audited };
      });
    await vi.waitFor(
      async () => {
        const state = await read();
        expect(state.hubRole).toBeNull();
        expect(state.pending.every((event) => event.dispatchedAt !== null)).toBe(true);
      },
      { timeout: 15_000, interval: 200 },
    );
    // Both jobs worked: give the second its turn, then one entry only.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await read()).audited).toEqual([
      {
        actorName: 'sync/clear-revoked-hub-role',
        branchId: b.branchId,
        details: { deviceId: b.deviceId, before: 'hub', after: null, reason: 'device_revoked' },
      },
    ]);
  });
});
