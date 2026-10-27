import { DomainError } from '@vertex-food/contracts';
import { devices, staffSessions, type Transaction } from '@vertex-food/db';
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '../../../core/audit/audit.js';
import { emit } from '../../../core/events/outbox.js';
import type { TenantDevices } from '../tenancy/index.js';
import { endSessions } from './staff-sessions.js';

const CLOSURE = { kind: 'system', name: 'identity/tenant-closure' } as const;

/**
 * Rule 37: a closed tenant keeps no staff session on a PC and no active registered PC. Run in the
 * closure's transaction by tenancy, and again by the session verifier when it meets a tenant that
 * a scheduled closure closed (the worker's job writes the status only): ending and revoking only
 * what is still open, it changes nothing the second time.
 */
export async function closeTenantAccess(tx: Transaction, tenantId: string, now: Date) {
  await endSessions(tx, undefined, 'tenant_closed', now);
  const revoked = await tx
    .update(devices)
    .set({ status: 'revoked', revokedAt: now, revokeReason: 'tenant_closed', updatedAt: now })
    .where(eq(devices.status, 'active'))
    .returning({ id: devices.id, branchId: devices.branchId });
  for (const device of revoked) {
    await audit(tx, tenantId, CLOSURE, {
      action: 'device.revoked',
      entityType: 'device',
      entityId: device.id,
      details: { reason: 'tenant_closed' },
    });
    await emit(tx, tenantId, 'device.revoked.v1', {
      tenantId,
      branchId: device.branchId,
      deviceId: device.id,
    });
  }
}

/** Tenancy's view of the tenant's PCs (`TENANT_DEVICES`). */
export class TenantDevicesStore implements TenantDevices {
  async assertNoActiveDevices(tx: Transaction, branchId: string): Promise<void> {
    const [active] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.branchId, branchId), eq(devices.status, 'active')))
      .limit(1);
    if (active) {
      throw new DomainError('BRANCH_HAS_DEVICES', 'The branch has active PCs', {
        branchId,
      });
    }
  }

  closeAccess(tx: Transaction, tenantId: string, now: Date): Promise<void> {
    return closeTenantAccess(tx, tenantId, now);
  }
}

/** The open sessions on a PC, ended when it is revoked (rule 19). */
export const onDevice = (deviceId: string) =>
  and(eq(staffSessions.deviceId, deviceId), isNull(staffSessions.endedAt));
