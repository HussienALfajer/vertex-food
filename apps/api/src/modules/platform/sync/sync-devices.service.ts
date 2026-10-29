import { Inject, Injectable } from '@nestjs/common';
import {
  type CertificateRequest,
  DomainError,
  type Heartbeat,
  type HeartbeatAnswer,
  type IssuedCertificate,
  isBelowMinimumAppVersion,
  isPrivateIpv4,
  type NumberBlocks,
  type NumberSeries,
  numberBlockDates,
  type SyncToken,
  supportedSyncProtocols,
  type TimeOfDay,
} from '@vertex-food/contracts';
import type { SecretBox } from '@vertex-food/crypto';
import {
  branches,
  type Database,
  deviceCertificates,
  devices,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import type { DeviceActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import type { Config } from '../../../core/config/config.js';
import { CONFIG } from '../../../core/config/config.module.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { branchAuthority, CA_SECRET_BOX } from './branch-pcs.js';
import { CertificateRequestError, issueDeviceCertificate } from './certificates.js';
import { recordHeartbeat, updateBranchConnectivity } from './connectivity.js';
import { allocateNumberBlocks } from './number-blocks.js';
import { SyncTokenSigner } from './sync-tokens.js';

/** The PC's row as the device routes need it. */
async function pcOf(tx: Transaction, deviceId: string) {
  const [row] = await tx
    .select({ hubRole: devices.hubRole, appVersion: devices.appVersion })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (!row) throw new DomainError('DEVICE_UNKNOWN', 'Unknown device');
  return { hubRole: row.hubRole as 'hub' | 'standby' | null, appVersion: row.appVersion };
}

function hubCapable(role: 'hub' | 'standby' | null): 'hub' | 'standby' {
  if (!role) throw new DomainError('DEVICE_NOT_HUB_CAPABLE', 'Only the hub and the standby');
  return role;
}

/**
 * The restaurant PC's sync routes besides the command upload (spec S04 rules 17, 39, 43–45): the
 * sync service's token, heartbeats, number blocks and its LAN certificate, each with its device
 * token (S02's `@DeviceRoute`); a revoked PC is refused before reaching here.
 */
@Injectable()
export class SyncDevicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SyncTokenSigner) private readonly tokens: SyncTokenSigner,
    @Inject(CA_SECRET_BOX) private readonly box: SecretBox,
  ) {}

  /** Rule 45: below the minimum app version, a PC stops downloading and is told to update. */
  private assertCurrentVersion(appVersion: string): void {
    if (isBelowMinimumAppVersion(appVersion, this.config.sync.minimumAppVersion)) {
      throw new DomainError('UPDATE_REQUIRED', 'The app is below the minimum version', {
        minimumAppVersion: this.config.sync.minimumAppVersion,
      });
    }
  }

  /** A 5-minute token for the sync service, naming the PC's tenant and branch. */
  async token(device: DeviceActor): Promise<SyncToken> {
    const pc = await withTenant(this.db, device.tenantId, (tx) => pcOf(tx, device.deviceId));
    this.assertCurrentVersion(pc.appVersion);
    const signed = this.tokens.sign(device);
    return {
      token: signed.token,
      expiresAt: signed.expiresAt.toISOString(),
      endpoint: this.config.sync.endpoint,
    };
  }

  /** Rules 43, 44: the PC's state, the branch's connectivity, the server's time and versions. */
  heartbeat(device: DeviceActor, input: Heartbeat): Promise<HeartbeatAnswer> {
    return withTenant(this.db, device.tenantId, async (tx) => {
      hubCapable((await pcOf(tx, device.deviceId)).hubRole);
      const now = new Date();
      await recordHeartbeat(tx, device, input, now);
      const connectivity = await updateBranchConnectivity(tx, device, now);
      return {
        serverTime: now.toISOString(),
        connectivity: connectivity.state,
        minimumAppVersion: this.config.sync.minimumAppVersion,
        protocols: supportedSyncProtocols(),
      };
    });
  }

  /** Rule 17: the PC's blocks for the branch's current and next 6 business days. */
  numberBlocks(device: DeviceActor, series: NumberSeries): Promise<NumberBlocks> {
    return withTenant(this.db, device.tenantId, async (tx) => {
      const pc = await pcOf(tx, device.deviceId);
      const hubRole = hubCapable(pc.hubRole);
      this.assertCurrentVersion(pc.appVersion);
      const [branch] = await tx
        .select({ businessDayEndsAt: branches.businessDayEndsAt })
        .from(branches)
        .where(eq(branches.id, device.branchId));
      if (!branch) throw new DomainError('NOT_FOUND', 'No such branch');
      const now = new Date();
      const blocks = await allocateNumberBlocks(tx, {
        tenantId: device.tenantId,
        branchId: device.branchId,
        deviceId: device.deviceId,
        hubRole,
        series,
        dates: numberBlockDates(now, branch.businessDayEndsAt.slice(0, 5) as TimeOfDay),
        now,
      });
      return { series, blocks };
    });
  }

  /**
   * Rule 39: a certificate for the PC's private LAN addresses, signed by the branch CA (made here
   * if the branch has none yet, for PCs registered before S04).
   */
  async certificate(device: DeviceActor, input: CertificateRequest): Promise<IssuedCertificate> {
    if (!input.lanAddresses.every(isPrivateIpv4)) {
      throw new DomainError('CERTIFICATE_ADDRESS_INVALID', 'Only private IPv4 addresses');
    }
    const lanAddresses = [...new Set(input.lanAddresses)];
    return withTenant(this.db, device.tenantId, async (tx) => {
      const now = new Date();
      const authority = await branchAuthority(tx, this.box, device, now);
      const issued = await issueDeviceCertificate({
        request: input.csr,
        deviceId: device.deviceId,
        lanAddresses,
        authority,
        now,
      }).catch((error: unknown) => {
        if (error instanceof CertificateRequestError) {
          throw new DomainError('VALIDATION_FAILED', 'The certificate request is not valid', {
            fields: ['csr'],
          });
        }
        throw error;
      });
      const [row] = await tx
        .insert(deviceCertificates)
        .values({
          tenantId: device.tenantId,
          branchId: device.branchId,
          deviceId: device.deviceId,
          certificatePem: issued.certificatePem,
          fingerprintSha256: issued.fingerprint,
          lanAddresses,
          issuedAt: now,
          expiresAt: issued.expiresAt,
        })
        .returning({ id: deviceCertificates.id });
      await audit(tx, device.tenantId, device, {
        action: 'device_certificate.issued',
        entityType: 'device_certificate',
        entityId: row?.id ?? null,
        branchId: device.branchId,
        details: { fingerprint: issued.fingerprint, authorityId: authority.id },
      });
      return {
        certificate: issued.certificatePem,
        caCertificate: authority.certificatePem,
        fingerprint: authority.fingerprint,
      };
    });
  }
}
