import { createHash } from 'node:crypto';
import {
  type DeviceMember,
  effectiveStatus,
  type MemberList,
  type TenantStatus,
} from '@vertex-food/contracts';
import { accounts, branches, devices, staffPins, type Transaction } from '@vertex-food/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { inScope, permissionsOf, readMemberships } from '../access/index.js';
import { readTenant, statusState } from '../tenancy/index.js';
import { MemberCredentialsStore } from './pins.js';

/** The status of the transaction's tenant in force at `now`, with its row. */
export async function tenantStatusAt(
  tx: Transaction,
  tenantId: string,
  now: Date,
  options: { lock?: 'update' | 'share' } = {},
) {
  const row = await readTenant(tx, tenantId, options);
  const status: TenantStatus = effectiveStatus(statusState(row), now);
  return { row, status };
}

/**
 * The member list of a registered PC (spec S02 rule 28): every active member whose scope holds the
 * PC's branch, with their name, roles, effective permissions and PIN verifier, and what the lock
 * screen shows. Hub clients and browsers never receive it. The version is a digest of the contents,
 * so the PC learns of any change (a PIN, a role, a deactivation, the idle lock) by comparing it.
 */
export async function memberListOf(
  tx: Transaction,
  deviceId: string,
  now: Date,
): Promise<MemberList> {
  const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
  if (!device) throw new Error('No such device');
  const [branch] = await tx.select().from(branches).where(eq(branches.id, device.branchId));
  if (!branch) throw new Error('A device without its branch');
  const tenant = await tenantStatusAt(tx, device.tenantId, now);
  const members = (await readMemberships(tx)).filter(
    (member) => member.status === 'active' && inScope(member, branch.id),
  );
  const ids = members.map((member) => member.id);
  const pins =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(staffPins)
          .where(and(inArray(staffPins.membershipId, ids), isNull(staffPins.archivedAt)));
  const accountIds = members.map((member) => member.accountId);
  const names =
    accountIds.length === 0
      ? []
      : await tx
          .select({ id: accounts.id, nameAr: accounts.nameAr })
          .from(accounts)
          .where(inArray(accounts.id, accountIds));
  const present = await new MemberCredentialsStore().presentIn(tx, ids);
  const listed: DeviceMember[] = members
    .map((member) => {
      const pin = pins.find((row) => row.membershipId === member.id);
      // The name the person chose, once they have been present here (rule 1, edge case 3).
      const chosen = present.has(member.id)
        ? names.find((row) => row.id === member.accountId)?.nameAr
        : undefined;
      return {
        membershipId: member.id,
        name: chosen ?? member.displayName,
        roles: member.roles,
        permissions: permissionsOf(member),
        pinVerifier: pin?.verifier ?? null,
        pinDisabled: pin?.disabledAt != null,
      };
    })
    .sort((a, b) => a.membershipId.localeCompare(b.membershipId));
  const contents = {
    tenant: {
      id: tenant.row.id,
      nameAr: tenant.row.nameAr,
      status: tenant.status,
      logoFileId: tenant.row.logoFileId,
    },
    branch: { id: branch.id, nameAr: branch.nameAr, idleLockMinutes: branch.idleLockMinutes },
    device: { id: device.id, name: device.name },
    members: listed,
  };
  const version = createHash('sha256').update(JSON.stringify(contents)).digest('base64url');
  return { version, issuedAt: now.toISOString(), ...contents };
}
