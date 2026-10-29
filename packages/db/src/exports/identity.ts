import { asc, eq, gt } from 'drizzle-orm';
import { devices } from '../schema/identity.js';
import { deviceSyncStates } from '../schema/sync.js';
import { branches } from '../schema/tenancy.js';
import { byPages, EXPORT_PAGE_SIZE, type ExportDataset } from './dataset.js';

// The restaurant's PCs (module `identity`, spec S02), with each one's last sync (spec S04), so
// the owner sees which PC may hold work the export does not include yet (edge case 10).

export const devicesDataset: ExportDataset = {
  stem: 'devices',
  tables: ['devices'],
  reads: ['branches', 'device_sync_states'],
  columns: [
    { name: 'id', kind: 'text' },
    { name: 'name', kind: 'text' },
    { name: 'branch_id', kind: 'text' },
    { name: 'branch_code', kind: 'text' },
    { name: 'hub_role', kind: 'text' },
    { name: 'status', kind: 'text' },
    { name: 'os', kind: 'text' },
    { name: 'app_version', kind: 'text' },
    { name: 'registered_at', kind: 'instant' },
    { name: 'last_seen_at', kind: 'instant' },
    { name: 'last_sync_at', kind: 'instant' },
    { name: 'revoked_at', kind: 'instant' },
    { name: 'revoke_reason', kind: 'text' },
    { name: 'revoke_note', kind: 'text' },
    { name: 'wiped_at', kind: 'instant' },
  ],
  async *rows(tx) {
    const pages = byPages((after) =>
      tx
        .select({
          id: devices.id,
          device: devices,
          branchCode: branches.code,
          lastSyncAt: deviceSyncStates.lastHeartbeatAt,
        })
        .from(devices)
        .innerJoin(branches, eq(branches.id, devices.branchId))
        .leftJoin(deviceSyncStates, eq(deviceSyncStates.deviceId, devices.id))
        .where(after === null ? undefined : gt(devices.id, after))
        .orderBy(asc(devices.id))
        .limit(EXPORT_PAGE_SIZE),
    );
    for await (const { device, branchCode, lastSyncAt } of pages) {
      yield {
        id: device.id,
        name: device.name,
        branch_id: device.branchId,
        branch_code: branchCode,
        hub_role: device.hubRole,
        status: device.status,
        os: device.os,
        app_version: device.appVersion,
        registered_at: device.createdAt,
        last_seen_at: device.lastSeenAt,
        last_sync_at: lastSyncAt,
        revoked_at: device.revokedAt,
        revoke_reason: device.revokeReason,
        revoke_note: device.revokeNote,
        wiped_at: device.wipedAt,
      };
    }
  },
};
