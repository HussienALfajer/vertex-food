import { Inject, Injectable } from '@nestjs/common';
import {
  type BranchPc,
  type BranchSyncStatus,
  DomainError,
  type SetHubRoles,
} from '@vertex-food/contracts';
import {
  branches,
  type Database,
  deviceCertificates,
  deviceSyncStates,
  devices,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, asc, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { readBranchConnectivity } from './connectivity.js';
import { lock } from './sync-locks.js';

/**
 * The branch network for owners and managers (spec S04 rule 38, screens 1, 2): the branch's PCs
 * with their configured roles, sync states and certificates, and the choice of hub and standby,
 * online only.
 */
@Injectable()
export class BranchNetworkService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  status(actor: StaffActor, branchId: string): Promise<BranchSyncStatus> {
    requirePermission(actor, 'hub.manage', branchId);
    return withTenant(this.db, actor.tenantId, (tx) => readStatus(tx, branchId));
  }

  /**
   * Chooses the configured hub and standby among the branch's active PCs; every other PC becomes
   * a client PC. Refused with `HUB_ROLE_ACTIVE` when it would leave the PC that is the live hub
   * without a role, until the standby is promoted.
   */
  setRoles(actor: StaffActor, branchId: string, input: SetHubRoles): Promise<BranchSyncStatus> {
    requirePermission(actor, 'hub.manage', branchId);
    if (input.standbyDeviceId === input.hubDeviceId) {
      throw new DomainError('VALIDATION_FAILED', 'The hub and the standby are two PCs', {
        fields: ['standbyDeviceId'],
      });
    }
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await lock(tx, 'hub-roles', branchId);
      await branchOf(tx, branchId);
      const pcs = await tx
        .select({ id: devices.id, hubRole: devices.hubRole })
        .from(devices)
        .where(and(eq(devices.branchId, branchId), eq(devices.status, 'active')));
      const ids = new Set(pcs.map((pc) => pc.id));
      const chosen = [input.hubDeviceId, input.standbyDeviceId].filter(
        (id): id is string => id !== undefined,
      );
      if (chosen.some((id) => !ids.has(id))) {
        throw new DomainError('DEVICE_UNKNOWN', 'Not an active PC of the branch');
      }
      const liveHub = await liveHubOf(tx, branchId);
      if (liveHub && !chosen.includes(liveHub)) {
        throw new DomainError('HUB_ROLE_ACTIVE', 'The live hub keeps a role until it is replaced', {
          deviceId: liveHub,
        });
      }
      const before = {
        hubDeviceId: pcs.find((pc) => pc.hubRole === 'hub')?.id ?? null,
        standbyDeviceId: pcs.find((pc) => pc.hubRole === 'standby')?.id ?? null,
      };
      const after = {
        hubDeviceId: input.hubDeviceId,
        standbyDeviceId: input.standbyDeviceId ?? null,
      };
      if (
        before.hubDeviceId !== after.hubDeviceId ||
        before.standbyDeviceId !== after.standbyDeviceId
      ) {
        // Cleared first: the partial unique index allows one hub and one standby per branch.
        await tx
          .update(devices)
          .set({ hubRole: null })
          .where(and(eq(devices.branchId, branchId), isNotNull(devices.hubRole)));
        await tx.update(devices).set({ hubRole: 'hub' }).where(eq(devices.id, after.hubDeviceId));
        if (after.standbyDeviceId) {
          await tx
            .update(devices)
            .set({ hubRole: 'standby' })
            .where(eq(devices.id, after.standbyDeviceId));
        }
        await audit(tx, actor.tenantId, actor, {
          action: 'branch.hub_roles_changed',
          entityType: 'branch',
          entityId: branchId,
          branchId,
          details: { before, after },
        });
      }
      return readStatus(tx, branchId);
    });
  }
}

async function branchOf(tx: Transaction, branchId: string) {
  const [branch] = await tx
    .select({ id: branches.id, createdAt: branches.createdAt })
    .from(branches)
    .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)));
  if (!branch) throw new DomainError('NOT_FOUND', 'No such branch');
  return branch;
}

/**
 * The PC that last reported itself the branch's hub with the highest epoch (rule 28), or null:
 * the branch's LAN follows it whatever roles are configured.
 */
async function liveHubOf(tx: Transaction, branchId: string): Promise<string | null> {
  const [live] = await tx
    .select({ deviceId: deviceSyncStates.deviceId })
    .from(deviceSyncStates)
    .innerJoin(devices, eq(devices.id, deviceSyncStates.deviceId))
    .where(
      and(
        eq(devices.branchId, branchId),
        eq(devices.status, 'active'),
        eq(deviceSyncStates.liveRole, 'hub'),
      ),
    )
    .orderBy(desc(deviceSyncStates.hubEpoch), desc(deviceSyncStates.lastHeartbeatAt))
    .limit(1);
  return live?.deviceId ?? null;
}

async function readStatus(tx: Transaction, branchId: string): Promise<BranchSyncStatus> {
  const branch = await branchOf(tx, branchId);
  const now = new Date();
  const rows = await tx
    .select({ device: devices, sync: deviceSyncStates })
    .from(devices)
    .leftJoin(deviceSyncStates, eq(deviceSyncStates.deviceId, devices.id))
    .where(and(eq(devices.branchId, branchId), eq(devices.status, 'active')))
    .orderBy(asc(devices.createdAt));
  const certificates = await tx
    .select({
      deviceId: deviceCertificates.deviceId,
      fingerprint: deviceCertificates.fingerprintSha256,
      lanAddresses: deviceCertificates.lanAddresses,
      expiresAt: deviceCertificates.expiresAt,
    })
    .from(deviceCertificates)
    .where(and(eq(deviceCertificates.branchId, branchId), gt(deviceCertificates.expiresAt, now)))
    .orderBy(desc(deviceCertificates.issuedAt));
  const pcs: BranchPc[] = rows.map(({ device, sync }) => {
    const certificate = certificates.find((row) => row.deviceId === device.id);
    return {
      deviceId: device.id,
      name: device.name,
      hubRole: device.hubRole as BranchPc['hubRole'],
      sync: sync
        ? {
            lastHeartbeatAt: sync.lastHeartbeatAt.toISOString(),
            liveRole: sync.liveRole as NonNullable<BranchPc['sync']>['liveRole'],
            hubEpoch: sync.hubEpoch,
            standbyInSync: sync.standbyInSync,
            pendingUploads: sync.pendingUploads,
            appVersion: sync.appVersion,
            protocol: sync.protocol,
            lanAddresses: sync.lanAddresses,
            recentRoundTripsMs: sync.recentRttMs,
            clockOffsetMs: sync.clockOffsetMs,
          }
        : null,
      certificate: certificate
        ? {
            fingerprint: certificate.fingerprint,
            lanAddresses: certificate.lanAddresses,
            expiresAt: certificate.expiresAt.toISOString(),
          }
        : null,
    };
  });
  const connectivity = await readBranchConnectivity(tx, branchId, branch.createdAt);
  return {
    branchId,
    connectivity: { state: connectivity.state, since: connectivity.since.toISOString() },
    pcs,
  };
}
