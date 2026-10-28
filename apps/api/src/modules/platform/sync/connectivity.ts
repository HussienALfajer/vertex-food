import {
  type ConnectivityState,
  branchConnectivity as computeConnectivity,
  type Heartbeat,
  nextRecentRoundTrips,
} from '@vertex-food/contracts';
import {
  branchConnectivity,
  branchConnectivityChanges,
  deviceSyncStates,
  devices,
  type Transaction,
} from '@vertex-food/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { emit } from '../../../core/events/outbox.js';

// Heartbeats and the branch's connectivity (spec S04 rules 43, 44, ADR 0035): each hub-capable PC
// reports every 15 seconds; the branch's state is the best of its hub-capable PCs', moved here on
// each heartbeat and by the worker's sweep when heartbeats stop. Each change is recorded and
// published as `branch.connectivity_changed.v1` (S14 pauses online ordering on it).

/** Upserts the PC's sync state from its heartbeat at `now`. */
export async function recordHeartbeat(
  tx: Transaction,
  device: { tenantId: string; deviceId: string },
  heartbeat: Heartbeat,
  now: Date,
): Promise<void> {
  const [previous] = await tx
    .select({
      lastHeartbeatAt: deviceSyncStates.lastHeartbeatAt,
      recentRttMs: deviceSyncStates.recentRttMs,
    })
    .from(deviceSyncStates)
    .where(eq(deviceSyncStates.deviceId, device.deviceId))
    .for('update');
  const state = {
    lastHeartbeatAt: now,
    recentRttMs: nextRecentRoundTrips({
      previous: previous?.recentRttMs ?? [],
      previousHeartbeatAt: previous?.lastHeartbeatAt ?? null,
      now,
      roundTripMs: heartbeat.lastRoundTripMs,
    }),
    pendingUploads: heartbeat.pendingUploads,
    liveRole: heartbeat.liveRole,
    hubEpoch: heartbeat.hubEpoch,
    standbyInSync: heartbeat.standbyInSync,
    appVersion: heartbeat.appVersion,
    protocol: heartbeat.protocol,
    lanAddresses: heartbeat.lanAddresses,
    clockOffsetMs: heartbeat.clockOffsetMs,
    updatedAt: now,
  };
  await tx
    .insert(deviceSyncStates)
    .values({ tenantId: device.tenantId, deviceId: device.deviceId, ...state })
    .onConflictDoUpdate({
      target: [deviceSyncStates.tenantId, deviceSyncStates.deviceId],
      set: state,
    });
}

/**
 * Moves the branch's state from its hub-capable PCs' heartbeats at `now`, under a lock on its row
 * (a branch without one starts `offline`). Answers the state it is in afterwards.
 */
export async function updateBranchConnectivity(
  tx: Transaction,
  branch: { tenantId: string; branchId: string },
  now: Date,
): Promise<{ state: ConnectivityState; since: Date }> {
  await tx
    .insert(branchConnectivity)
    .values({ tenantId: branch.tenantId, branchId: branch.branchId, state: 'offline', since: now })
    .onConflictDoNothing({ target: [branchConnectivity.tenantId, branchConnectivity.branchId] });
  const [current] = await tx
    .select()
    .from(branchConnectivity)
    .where(eq(branchConnectivity.branchId, branch.branchId))
    .for('update');
  if (!current) throw new Error('No branch connectivity row');
  const pcs = await tx
    .select({
      lastHeartbeatAt: deviceSyncStates.lastHeartbeatAt,
      recentRttMs: deviceSyncStates.recentRttMs,
    })
    .from(deviceSyncStates)
    .innerJoin(devices, eq(devices.id, deviceSyncStates.deviceId))
    .where(
      and(
        eq(devices.branchId, branch.branchId),
        eq(devices.status, 'active'),
        isNotNull(devices.hubRole),
      ),
    );
  const from = current.state as ConnectivityState;
  const next = computeConnectivity({
    current: from,
    devices: pcs.map((pc) => ({
      lastHeartbeatAt: pc.lastHeartbeatAt,
      recentRoundTripsMs: pc.recentRttMs,
    })),
    now,
  });
  const streak = Math.min(next.healthyStreak, 5);
  if (next.state === from) {
    if (streak !== current.healthyStreak) {
      await tx
        .update(branchConnectivity)
        .set({ healthyStreak: streak, updatedAt: now })
        .where(eq(branchConnectivity.id, current.id));
    }
    return { state: from, since: current.since };
  }
  await tx
    .update(branchConnectivity)
    .set({ state: next.state, since: now, healthyStreak: streak, updatedAt: now })
    .where(eq(branchConnectivity.id, current.id));
  await tx.insert(branchConnectivityChanges).values({
    tenantId: branch.tenantId,
    branchId: branch.branchId,
    fromState: from,
    toState: next.state,
    at: now,
  });
  await emit(tx, branch.tenantId, 'branch.connectivity_changed.v1', {
    tenantId: branch.tenantId,
    branchId: branch.branchId,
    from,
    to: next.state,
  });
  return { state: next.state, since: now };
}

/** The branch's state as last recorded, `offline` since `fallbackSince` before any heartbeat. */
export async function readBranchConnectivity(
  tx: Transaction,
  branchId: string,
  fallbackSince: Date,
): Promise<{ state: ConnectivityState; since: Date }> {
  const [row] = await tx
    .select({ state: branchConnectivity.state, since: branchConnectivity.since })
    .from(branchConnectivity)
    .where(eq(branchConnectivity.branchId, branchId));
  return row
    ? { state: row.state as ConnectivityState, since: row.since }
    : { state: 'offline', since: fallbackSince };
}
