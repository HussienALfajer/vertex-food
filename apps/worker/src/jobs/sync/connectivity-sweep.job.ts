import { Inject, Injectable } from '@nestjs/common';
import {
  type ConnectivityState,
  branchConnectivity as computeConnectivity,
  connectivityPolicy,
  eventCatalog,
} from '@vertex-food/contracts';
import {
  and,
  branchConnectivity,
  branchConnectivityChanges,
  type Database,
  deviceSyncStates,
  devices,
  eq,
  isNotNull,
  outboxEvents,
  sql,
  withTenant,
} from '@vertex-food/db';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { RepeatingJob } from '../../core/repeat/repeating-job.js';

const rank: Record<ConnectivityState, number> = { offline: 0, weak: 1, online: 2 };

/**
 * Moves branches whose heartbeats stopped to `weak` or `offline` (spec S04 rule 44, ADR 0035),
 * every 15 seconds: the API moves a branch on each heartbeat, and only this job sees the silence.
 * Each change is recorded with its `branch.connectivity_changed.v1` event in the same
 * transaction. Safe twice: it locks the branch's row, recomputes from the heartbeats it finds, and
 * only ever lowers the state. Runs as the jobs role.
 */
@Injectable()
export class ConnectivitySweepJob implements RepeatingJob {
  readonly name = 'sync.connectivity-sweep';
  readonly intervalMs = connectivityPolicy.heartbeatSeconds * 1000;

  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  /** Sweeps at `now`; answers how many branches changed state. */
  async run(now = new Date()): Promise<number> {
    const branches = await this.db
      .select({ tenantId: branchConnectivity.tenantId, branchId: branchConnectivity.branchId })
      .from(branchConnectivity)
      .where(sql`${branchConnectivity.state} <> 'offline'`);
    let changed = 0;
    for (const branch of branches) {
      if (await this.sweep(branch, now)) changed += 1;
    }
    return changed;
  }

  private sweep(branch: { tenantId: string; branchId: string }, now: Date): Promise<boolean> {
    return withTenant(this.db, branch.tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(branchConnectivity)
        .where(eq(branchConnectivity.branchId, branch.branchId))
        .for('update');
      if (!current) return false;
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
      // A heartbeat raises the state; the silence this job sees only lowers it.
      if (rank[next.state] >= rank[from]) return false;
      await tx
        .update(branchConnectivity)
        .set({
          state: next.state,
          since: now,
          healthyStreak: Math.min(next.healthyStreak, 5),
          updatedAt: now,
        })
        .where(eq(branchConnectivity.id, current.id));
      await tx.insert(branchConnectivityChanges).values({
        tenantId: branch.tenantId,
        branchId: branch.branchId,
        fromState: from,
        toState: next.state,
        at: now,
      });
      await tx.insert(outboxEvents).values({
        tenantId: branch.tenantId,
        type: 'branch.connectivity_changed.v1',
        payload: eventCatalog['branch.connectivity_changed.v1'].parse({
          tenantId: branch.tenantId,
          branchId: branch.branchId,
          from,
          to: next.state,
        }),
      });
      return true;
    });
  }
}
