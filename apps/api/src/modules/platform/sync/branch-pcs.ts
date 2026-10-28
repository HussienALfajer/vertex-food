import type { SecretBox } from '@vertex-food/crypto';
import {
  branchCaKeys,
  branchCertificateAuthorities,
  devices,
  type Transaction,
} from '@vertex-food/db';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DeviceActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import type { BranchPcs } from '../identity/index.js';
import { createBranchAuthority } from './certificates.js';
import { lock } from './sync-locks.js';

// A branch's PCs as the sync module sees them (spec S04 rule 38, ADR 0035): the configured hub and
// standby, and the branch's certificate authority, both set up as PCs are registered.

/** The AES-256-GCM box of the branch CAs' keys (`SYNC_CA_ENCRYPTION_KEY`). */
export const CA_SECRET_BOX = Symbol('SyncCaSecretBox');

/** The seal context of a CA's key: bound to its tenant and authority, so it cannot be moved. */
const caKeyContext = (tenantId: string, authorityId: string) =>
  `sync.branch-ca:${tenantId}:${authorityId}`;

export type BranchAuthority = {
  id: string;
  certificatePem: string;
  fingerprint: string;
  privateKeyPkcs8: string;
};

/**
 * The branch's active CA, created on first need under a lock on the branch (ECDSA P-256, 10
 * years), its key sealed in `branch_ca_keys` and audited as `branch_ca.created` by `actor`.
 */
export async function branchAuthority(
  tx: Transaction,
  box: SecretBox,
  device: DeviceActor,
  now: Date,
): Promise<BranchAuthority> {
  await lock(tx, 'branch-ca', device.branchId);
  const [active] = await tx
    .select({
      id: branchCertificateAuthorities.id,
      certificatePem: branchCertificateAuthorities.certificatePem,
      fingerprint: branchCertificateAuthorities.fingerprintSha256,
      privateKeySealed: branchCaKeys.privateKeySealed,
    })
    .from(branchCertificateAuthorities)
    .innerJoin(branchCaKeys, eq(branchCaKeys.authorityId, branchCertificateAuthorities.id))
    .where(
      and(
        eq(branchCertificateAuthorities.branchId, device.branchId),
        isNull(branchCertificateAuthorities.archivedAt),
      ),
    );
  if (active) {
    const privateKeyPkcs8 = box.open(
      caKeyContext(device.tenantId, active.id),
      active.privateKeySealed,
    );
    if (!privateKeyPkcs8) throw new Error(`The key of branch CA ${active.id} does not open`);
    return { ...active, privateKeyPkcs8 };
  }
  const created = await createBranchAuthority(device.branchId, now);
  const id = uuidv7();
  await tx.insert(branchCertificateAuthorities).values({
    id,
    tenantId: device.tenantId,
    branchId: device.branchId,
    certificatePem: created.certificatePem,
    fingerprintSha256: created.fingerprint,
  });
  await tx.insert(branchCaKeys).values({
    tenantId: device.tenantId,
    authorityId: id,
    privateKeySealed: box.seal(caKeyContext(device.tenantId, id), created.privateKeyPkcs8),
  });
  await audit(tx, device.tenantId, device, {
    action: 'branch_ca.created',
    entityType: 'branch_certificate_authority',
    entityId: id,
    details: { branchId: device.branchId, fingerprint: created.fingerprint },
  });
  return {
    id,
    certificatePem: created.certificatePem,
    fingerprint: created.fingerprint,
    privateKeyPkcs8: created.privateKeyPkcs8,
  };
}

/**
 * Identity's `BRANCH_PCS` (rule 38): in the registration's transaction, the branch's first PC
 * becomes its configured hub and the next its standby, so the first two PCs are hub-capable;
 * later ones are client PCs. The branch's CA is made with its first PC.
 */
export class BranchPcsStore implements BranchPcs {
  constructor(private readonly box: SecretBox) {}

  async registered(tx: Transaction, device: DeviceActor, now: Date): Promise<void> {
    await lock(tx, 'hub-roles', device.branchId);
    const roles = await tx
      .select({ hubRole: devices.hubRole })
      .from(devices)
      .where(and(eq(devices.branchId, device.branchId), eq(devices.status, 'active')));
    const held = new Set(roles.map((row) => row.hubRole));
    const hubRole = !held.has('hub') ? 'hub' : !held.has('standby') ? 'standby' : null;
    if (hubRole) {
      await tx.update(devices).set({ hubRole }).where(eq(devices.id, device.deviceId));
    }
    await branchAuthority(tx, this.box, device, now);
  }
}
