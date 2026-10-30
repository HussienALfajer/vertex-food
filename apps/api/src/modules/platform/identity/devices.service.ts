import { Inject, Injectable } from '@nestjs/common';
import {
  type Device,
  type DeviceToken,
  type DeviceTokenChallenge,
  type DeviceTokenRequest,
  DomainError,
  deviceTokenMessage,
  deviceTokenTtlSeconds,
  type MemberListResult,
  type Nonce,
  type RegisterDevice,
  type RegisteredDevice,
  type RevokeDevice,
} from '@vertex-food/contracts';
import type { KeyedHash } from '@vertex-food/crypto';
import { branches, type Database, devices, staffSessions, withTenant } from '@vertex-food/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  type DeviceActor,
  holds,
  requirePermission,
  type StaffActor,
  type Ticket,
} from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { emit } from '../../../core/events/outbox.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import { permissionsOf, readMembership } from '../access/index.js';
import { memberListOf, tenantStatusAt } from './member-lists.js';
import { BRANCH_PCS, type BranchPcs, DEVICE_LIMIT, type DeviceLimit } from './ports.js';
import { verifyEd25519 } from './secrets.js';
import type { Nonces } from './single-use.js';
import { endSessions, SessionIssuer } from './staff-sessions.js';
import { Tickets } from './tickets.js';
import { TokenSigner } from './tokens.js';

const MINUTE_MS = 60_000;

/** The nonces registered PCs sign for their device tokens. */
export const DEVICE_NONCES = Symbol('DeviceNonces');

/** The keyed hashes of identity (`IDENTITY_HASH_KEY`). */
export const KEYED_HASH = Symbol('KeyedHash');

/** The AES-256-GCM box of identity (`IDENTITY_ENCRYPTION_KEY`), for the console's TOTP secrets. */
export const SECRET_BOX = Symbol('SecretBox');

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    branchId: row.branchId,
    name: row.name,
    status: row.status as Device['status'],
    os: row.os,
    appVersion: row.appVersion,
    lastSeenAt: row.lastSeenAt.toISOString(),
    membersSyncedAt: iso(row.membersSyncedAt),
    registeredAt: row.createdAt.toISOString(),
    revokedAt: iso(row.revokedAt),
    revokeReason: row.revokeReason as Device['revokeReason'],
    wipedAt: iso(row.wipedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const notFound = () => new DomainError('NOT_FOUND', 'No such device');

/**
 * Registered restaurant PCs (spec S02 rules 16–21, 28): registration with a sign-in ticket, device
 * tokens by signing a server nonce with the device key, the member list and its confirmation, the
 * wipe confirmation of a revoked PC, and the devices screen (list, rename, revoke).
 */
@Injectable()
export class DevicesService {
  private readonly challengesPerAddress = new RateLimiter(600, 10 * MINUTE_MS);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TokenSigner) private readonly tokens: TokenSigner,
    @Inject(Tickets) private readonly tickets: Tickets,
    @Inject(SessionIssuer) private readonly issuer: SessionIssuer,
    @Inject(DEVICE_NONCES) private readonly nonces: Nonces,
    @Inject(KEYED_HASH) private readonly hashes: KeyedHash,
    @Inject(BRANCH_PCS) private readonly branchPcs: BranchPcs,
    @Inject(DEVICE_LIMIT) private readonly limit: DeviceLimit,
  ) {}

  /**
   * Rules 16, 18, 36: a member with `devices.manage` for the branch registers this installation,
   * then holds a session on it. The ticket must come from a sign-in with an OTP (no device token).
   */
  async register(ticket: Ticket, input: RegisterDevice): Promise<RegisteredDevice> {
    if (ticket.intent !== 'register_device' || ticket.deviceId !== null) {
      throw new DomainError('TICKET_INVALID', 'Not a registration ticket');
    }
    const now = new Date();
    return withTenant(this.db, input.tenantId, async (tx) => {
      const tenant = await tenantStatusAt(tx, input.tenantId, now, { lock: 'share' });
      const member = await readMembership(tx, { accountId: ticket.accountId }, { lock: 'share' });
      if (member?.status !== 'active') {
        throw new DomainError('FORBIDDEN', 'Not an active member of this restaurant');
      }
      if (tenant.status === 'closed') throw new DomainError('TENANT_CLOSED', 'Closed');
      if (tenant.status === 'suspended') throw new DomainError('TENANT_SUSPENDED', 'Suspended');
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, input.branchId), isNull(branches.archivedAt)));
      const permissions = permissionsOf(member);
      const inBranch = member.allBranches || member.branchIds.includes(input.branchId);
      if (!branch || !permissions.includes('devices.manage') || !inBranch) {
        throw new DomainError('FORBIDDEN', 'No devices.manage for this branch');
      }
      // S05 rule 21: the agreement's device limit, counted under the entitlement state's lock.
      await this.limit.assertPcFits(tx, input.tenantId);
      await this.tickets.consume(tx, ticket);
      const [row] = await tx
        .insert(devices)
        .values({
          tenantId: input.tenantId,
          branchId: input.branchId,
          name: input.name,
          publicKey: input.publicKey,
          os: input.os,
          appVersion: input.appVersion,
          registeredByMembershipId: member.id,
          lastSeenAt: now,
        })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error, 'devices_tenant_public_key_unique')) {
            throw new DomainError('CONFLICT', 'This installation is already registered');
          }
          throw error;
        });
      if (!row) throw new Error('No device inserted');
      const actor = { kind: 'device', tenantId: input.tenantId, deviceId: row.id } as const;
      // Spec S04 rule 38: the hub and standby roles of the first two PCs, the branch's CA.
      await this.branchPcs.registered(
        tx,
        { ...actor, branchId: row.branchId, status: 'active' },
        now,
      );
      await audit(
        tx,
        input.tenantId,
        { ...actor, branchId: row.branchId, status: 'active' },
        {
          action: 'device.registered',
          entityType: 'device',
          entityId: row.id,
          branchId: row.branchId,
          details: { branchId: row.branchId, registeredByMembershipId: member.id },
        },
      );
      await emit(tx, input.tenantId, 'device.registered.v1', {
        tenantId: input.tenantId,
        branchId: row.branchId,
        deviceId: row.id,
      });
      // The registering member just entered their password: their first session counts it.
      const session = await this.issuer.openDevice(
        tx,
        { tenantId: input.tenantId, membershipId: member.id, deviceId: row.id },
        now,
        now,
      );
      await audit(
        tx,
        input.tenantId,
        { ...actor, branchId: row.branchId, status: 'active' },
        {
          action: 'staff_session.started',
          entityType: 'staff_session',
          entityId: session.sessionId,
          branchId: row.branchId,
          details: { kind: 'device', membershipId: member.id },
        },
      );
      return { device: toDevice(row), members: await memberListOf(tx, row.id, now), session };
    });
  }

  challenge(input: DeviceTokenChallenge, address: string): Nonce {
    this.challengesPerAddress.take(this.hashes.hash('address', address));
    const { nonce, expiresAt } = this.nonces.issue(`device:${input.tenantId}:${input.deviceId}`);
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Rule 44: a 5-minute device token for a signature of the nonce by the device key. A revoked PC
   * still gets one until it confirms its wipe; every other device route refuses it.
   */
  async token(input: DeviceTokenRequest): Promise<DeviceToken> {
    this.nonces.take(input.nonce, `device:${input.tenantId}:${input.deviceId}`);
    const now = new Date();
    return withTenant(this.db, input.tenantId, async (tx) => {
      const [row] = await tx.select().from(devices).where(eq(devices.id, input.deviceId));
      if (!row) throw new DomainError('DEVICE_UNKNOWN', 'Unknown device');
      const message = deviceTokenMessage(input.nonce, input.deviceId);
      if (!verifyEd25519(row.publicKey, message, input.signature)) {
        throw new DomainError('SIGNATURE_INVALID', 'The device signature does not verify');
      }
      if (row.wipedAt) throw new DomainError('DEVICE_REVOKED', 'The PC was removed and wiped');
      await tx
        .update(devices)
        .set({ lastSeenAt: now, appVersion: input.appVersion, updatedAt: now })
        .where(eq(devices.id, row.id));
      const signed = this.tokens.sign(
        'device',
        { tid: input.tenantId, did: input.deviceId },
        deviceTokenTtlSeconds,
        now,
      );
      return { deviceToken: signed.token, expiresAt: signed.expiresAt.toISOString() };
    });
  }

  /** Rule 28: the member list, or `not_modified` when the PC holds this version. */
  members(device: DeviceActor, knownVersion: string | undefined): Promise<MemberListResult> {
    const now = new Date();
    return withTenant(this.db, device.tenantId, async (tx) => {
      const list = await memberListOf(tx, device.deviceId, now);
      return list.version === knownVersion
        ? { status: 'not_modified' as const, issuedAt: list.issuedAt }
        : { status: 'current' as const, list };
    });
  }

  /** The PC holds the current list: the offline window counts from now (rule 30). */
  async acknowledge(device: DeviceActor, version: string): Promise<void> {
    const now = new Date();
    await withTenant(this.db, device.tenantId, async (tx) => {
      const list = await memberListOf(tx, device.deviceId, now);
      // An older version confirms nothing: the PC fetches the list again.
      if (list.version !== version) return;
      await tx
        .update(devices)
        .set({ membersSyncedAt: now, updatedAt: now })
        .where(eq(devices.id, device.deviceId));
    });
  }

  /** Rule 19: a revoked PC confirms it deleted its keys and member list. */
  async wiped(device: DeviceActor): Promise<void> {
    const now = new Date();
    await withTenant(this.db, device.tenantId, async (tx) => {
      const [row] = await tx
        .update(devices)
        .set({ wipedAt: now, updatedAt: now })
        .where(
          and(
            eq(devices.id, device.deviceId),
            eq(devices.status, 'revoked'),
            isNull(devices.wipedAt),
          ),
        )
        .returning({ id: devices.id });
      if (!row) return;
      await audit(tx, device.tenantId, device, {
        action: 'device.wiped',
        entityType: 'device',
        entityId: row.id,
        branchId: device.branchId,
      });
    });
  }

  // The devices screen (rule 19).

  list(actor: StaffActor): Promise<Device[]> {
    requirePermission(actor, 'devices.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const rows = await tx.select().from(devices).orderBy(asc(devices.createdAt));
      return rows.filter((row) => holds(actor, 'devices.manage', row.branchId)).map(toDevice);
    });
  }

  get(actor: StaffActor, id: string): Promise<Device> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(devices).where(eq(devices.id, id));
      if (!row || !holds(actor, 'devices.manage', row.branchId)) throw notFound();
      return toDevice(row);
    });
  }

  rename(actor: StaffActor, id: string, name: string): Promise<Device> {
    const now = new Date();
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(devices).where(eq(devices.id, id)).for('update');
      if (!row || !holds(actor, 'devices.manage', row.branchId)) throw notFound();
      const [renamed] = await tx
        .update(devices)
        .set({ name, updatedAt: now })
        .where(eq(devices.id, id))
        .returning();
      if (!renamed) throw new Error('No device renamed');
      await audit(tx, actor.tenantId, actor, {
        action: 'device.renamed',
        entityType: 'device',
        entityId: id,
        branchId: row.branchId,
        details: { before: row.name, after: name },
      });
      return toDevice(renamed);
    });
  }

  /**
   * Rule 19: immediate on the server; its sessions end and its device routes answer
   * `DEVICE_REVOKED`, so the PC wipes on its next connection.
   */
  revoke(actor: StaffActor, id: string, input: RevokeDevice): Promise<Device> {
    const now = new Date();
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(devices).where(eq(devices.id, id)).for('update');
      if (!row || !holds(actor, 'devices.manage', row.branchId)) throw notFound();
      if (row.status !== 'active') {
        throw new DomainError('INVALID_STATUS_TRANSITION', 'The PC is already revoked');
      }
      const [revoked] = await tx
        .update(devices)
        .set({
          status: 'revoked',
          revokedAt: now,
          revokedByMembershipId: actor.membershipId,
          revokeReason: input.reason,
          revokeNote: input.note ?? null,
          updatedAt: now,
        })
        .where(eq(devices.id, id))
        .returning();
      if (!revoked) throw new Error('No device revoked');
      await endSessions(tx, eq(staffSessions.deviceId, id), 'device_revoked', now);
      await audit(tx, actor.tenantId, actor, {
        action: 'device.revoked',
        entityType: 'device',
        entityId: id,
        branchId: row.branchId,
        reason: input.note ?? null,
        details: { reason: input.reason },
      });
      await emit(tx, actor.tenantId, 'device.revoked.v1', {
        tenantId: actor.tenantId,
        branchId: row.branchId,
        deviceId: id,
      });
      return toDevice(revoked);
    });
  }
}
