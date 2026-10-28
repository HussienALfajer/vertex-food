import { z } from 'zod';
import { appVersionSchema, signatureSchema } from './identity.js';
import { idSchema, instantSchema, listQuerySchema, pageSchema } from './primitives.js';
import { businessDateOf } from './tenancy.js';
import { addDays, type LocalDate, localDateSchema, type TimeOfDay } from './time.js';

// The sync foundation (spec S04, ADR 0008, 0022, 0035): the signed command envelope a restaurant
// PC uploads, the outcomes the server records, protocol and app versions, clock rules, number
// blocks, branch connectivity, the needs-attention list and the quarantine. The hub's LAN API is
// in `hub.ts`; the hub protocol and the command registry are in `packages/sync`.

// Protocol and app versions (ADR 0035, VER-01).

/** The sync protocol of uploads to the server. A change that older PCs cannot read raises it. */
export const SYNC_PROTOCOL = 1;

/** The protocol of the hub's LAN API, between PCs and with hub clients. */
export const HUB_PROTOCOL = 1;

const protocolSchema = z.int().min(1).max(1000);

/** The server accepts the current and the previous protocol version. */
export function supportedSyncProtocols(current: number = SYNC_PROTOCOL): number[] {
  return current > 1 ? [current - 1, current] : [current];
}

export function isSyncProtocolSupported(
  protocol: number,
  current: number = SYNC_PROTOCOL,
): boolean {
  return supportedSyncProtocols(current).includes(protocol);
}

/**
 * Two LAN peers talk when their protocols are the same or one apart, in the older of the two, so
 * an update that reaches the hub before the standby keeps them talking (edge case 11).
 */
export function negotiateHubProtocol(ours: number, theirs: number): number | null {
  return Math.abs(ours - theirs) <= 1 ? Math.min(ours, theirs) : null;
}

type ParsedVersion = { core: [number, number, number]; prerelease: string | null };

function parseAppVersion(version: string): ParsedVersion | null {
  const match =
    /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]*)?$/.exec(
      version,
    );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/**
 * Compares two app versions (`major.minor.patch`, a prerelease before its release). A version
 * that does not parse sorts below every other, so a PC reporting one is told to update.
 */
export function compareAppVersions(a: string, b: string): number {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] as number) - (right.core[i] as number);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** Rule 45: below the minimum, a PC still uploads, then gets `UPDATE_REQUIRED`. */
export function isBelowMinimumAppVersion(version: string, minimum: string): boolean {
  return compareAppVersions(version, minimum) < 0;
}

// Commands (rules 1–4).

/** A registry name: `<module>.<action>`, lower snake case (`sync.network_check`). */
export const commandNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  .max(80)
  .meta({ id: 'CommandName' });

export const commandVersionSchema = z.int().min(1).max(1000).meta({ id: 'CommandVersion' });

/** Where a command was made: a restaurant PC or a phone or screen paired with the hub. */
export const commandOriginKindSchema = z
  .enum(['pc', 'hub_client'])
  .meta({ id: 'CommandOriginKind' });

export type CommandOriginKind = z.infer<typeof commandOriginKindSchema>;

/**
 * Who made a command: a member in a PIN session on a PC or a hub client, a station pairing (a
 * kitchen display), or the PC itself (housekeeping such as `audit.record_local_events`).
 */
export const commandActorSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('member'),
      membershipId: idSchema,
      sessionKind: z.enum(['pc', 'hub_client']),
    }),
    z.object({ kind: z.literal('station'), pairingId: idSchema }),
    z.object({ kind: z.literal('device') }),
  ])
  .meta({ id: 'CommandActor' });

export type CommandActor = z.infer<typeof commandActorSchema>;

/** SHA-256 in lower-case hex: payload hashes and certificate fingerprints. */
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .meta({ id: 'Sha256Hex' });

/** A JSON object; numbers in it are integers (the canonical form of `packages/sync` refuses others). */
const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * The signed envelope of a command (rule 3). The executing PC signs its canonical JSON without
 * `signature` (rule 4). The tenant and branch come only from the device token, never from here.
 */
export const commandEnvelopeSchema = z
  .object({
    /** UUIDv7 made where the command was made; re-sent until answered, never reused (rule 2). */
    id: idSchema,
    name: commandNameSchema,
    version: commandVersionSchema,
    protocol: protocolSchema,
    originKind: commandOriginKindSchema,
    /** The PC, or the pairing id of a hub client. */
    originDeviceId: idSchema,
    /** The PC that resolved and signed it. */
    executedByDeviceId: idSchema,
    actor: commandActorSchema,
    /** The member who approved it by PIN (S02 rule 27). */
    approvedByMembershipId: idSchema.optional(),
    /** As made on the device. */
    deviceTime: instantSchema,
    /** The executing PC's last measured server time minus device time (rule 14). */
    clockOffsetMs: z
      .int()
      .min(-(10 ** 12))
      .max(10 ** 12),
    /** The highest time the PC has seen (S02 rule 31). */
    highestSeenTime: instantSchema,
    /** Made after the PC's offline window closed (S02 rule 30). */
    afterOfflineWindow: z.boolean(),
    hubEpoch: z.int().min(0),
    hubSeq: z.int().min(0),
    payload: jsonObjectSchema,
    /** What only the hub decides (a number, a price row); `{}` when nothing. */
    resolved: jsonObjectSchema,
    /** SHA-256 of the canonical JSON of `{ payload, resolved }`. */
    payloadHash: sha256HexSchema,
    signature: signatureSchema,
  })
  .meta({ id: 'CommandEnvelope' });

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export type UnsignedCommandEnvelope = Omit<CommandEnvelope, 'signature'>;

/** What the server records once per command id (rule 7). */
export const commandOutcomeSchema = z
  .enum(['accepted', 'adjusted', 'rejected'])
  .meta({ id: 'CommandOutcome' });

export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

/**
 * Reason codes of refusals and rejections (rules 6, 8, 9, 20, 40, 16). The first six are also the
 * hub's refusals before journaling; `device_revoked` and `member_inactive` name a quarantine.
 */
export const commandReasons = [
  'payload_invalid',
  'permission_missing',
  'pin_session_ended',
  'station_not_allowed',
  'unknown_command',
  'version_unsupported',
  'protocol_unsupported',
  'signature_invalid',
  'device_revoked',
  'member_inactive',
  'approver_not_allowed',
  'number_out_of_block',
  'server_error',
] as const;

export const commandReasonSchema = z.enum(commandReasons).meta({ id: 'CommandReason' });

export type CommandReason = z.infer<typeof commandReasonSchema>;

/** The hub refuses these before journaling a command; nothing is written (rule 6). */
export const hubRefusalReasonSchema = z
  .enum([
    'payload_invalid',
    'permission_missing',
    'pin_session_ended',
    'station_not_allowed',
    'unknown_command',
    'version_unsupported',
  ])
  .meta({ id: 'HubRefusalReason' });

export type HubRefusalReason = z.infer<typeof hubRefusalReasonSchema>;

export const quarantineReasonSchema = z
  .enum(['device_revoked', 'member_inactive'])
  .meta({ id: 'QuarantineReason' });

export type QuarantineReason = z.infer<typeof quarantineReasonSchema>;

/** Flags carried to `command_log` and the audit. */
export const commandFlagSchema = z
  .enum(['clock_suspect', 'after_offline_window', 'from_quarantine', 'mirrored_false'])
  .meta({ id: 'CommandFlag' });

export type CommandFlag = z.infer<typeof commandFlagSchema>;

/** At most this many envelopes per upload (rule 7). */
export const MAX_COMMANDS_PER_UPLOAD = 100;

export const uploadCommandsSchema = z
  .object({
    protocol: protocolSchema,
    commands: z.array(commandEnvelopeSchema).min(1).max(MAX_COMMANDS_PER_UPLOAD),
  })
  .meta({ id: 'UploadCommands' });

export type UploadCommands = z.infer<typeof uploadCommandsSchema>;

/**
 * One command's answer: its recorded outcome, or `quarantined` (kept for the owner, rules 16 and
 * 40–42). Either way it is final: the PC drops it from its upload queue and never re-sends it.
 */
export const commandResultSchema = z
  .object({
    id: idSchema,
    outcome: z.enum([...commandOutcomeSchema.options, 'quarantined']),
    reason: commandReasonSchema.optional(),
    /** The adjustment or rejection, ids and codes only. */
    details: jsonObjectSchema.optional(),
    /** The id was known: this is its stored outcome. */
    replay: z.boolean(),
  })
  .meta({ id: 'CommandResult' });

export type CommandResult = z.infer<typeof commandResultSchema>;

export const uploadCommandsResultSchema = z
  .object({ results: z.array(commandResultSchema) })
  .meta({ id: 'UploadCommandsResult' });

export type UploadCommandsResult = z.infer<typeof uploadCommandsResultSchema>;

/**
 * A command's summary for needs attention and the quarantine: an i18n key of the `sync` namespace
 * and its parameters, rendered by each command's `describe`, never with customer data.
 */
export const commandSummarySchema = z
  .object({
    key: z.string().min(1).max(120),
    params: z.record(z.string(), z.union([z.string(), z.int()])),
  })
  .meta({ id: 'CommandSummary' });

export type CommandSummary = z.infer<typeof commandSummarySchema>;

// Clock (rules 14–16, ADR 0035).

/** The clock skew limit: 10 minutes. */
export const CLOCK_SKEW_LIMIT_MS = 10 * 60 * 1000;

/**
 * Server time minus device time from one round trip (rule 14): the server's time is taken as the
 * midpoint of the request, so half the round trip is added to the send time.
 */
export function measureClockOffset(input: {
  sentAt: Date;
  receivedAt: Date;
  serverTime: Date;
}): number {
  const roundTrip = input.receivedAt.getTime() - input.sentAt.getTime();
  return input.serverTime.getTime() - (input.sentAt.getTime() + Math.floor(roundTrip / 2));
}

/** `deviceTime + clockOffsetMs`, before the clamp to `receivedAt`. */
export function correctedTime(deviceTime: Date, clockOffsetMs: number): Date {
  return new Date(deviceTime.getTime() + clockOffsetMs);
}

/** A command's effective time: its corrected time, clamped to `receivedAt` if later (rule 14). */
export function effectiveTime(deviceTime: Date, clockOffsetMs: number, receivedAt: Date): Date {
  const corrected = correctedTime(deviceTime, clockOffsetMs).getTime();
  return new Date(Math.min(corrected, receivedAt.getTime()));
}

export type ClockSuspectReason = 'behind_highest_seen' | 'in_future' | 'offset_jumped';

/**
 * Why a command's time is uncertain (rule 15), or an empty list: its device time is more than 10
 * minutes earlier than the highest time the PC had seen; its corrected time is more than 10 minutes
 * after `receivedAt`; or the PC's offset changed by more than 10 minutes between the measure the
 * command carries and the PC's next one. The flag opens an attention item; it never rejects.
 */
export function clockSuspectReasons(input: {
  deviceTime: Date;
  highestSeenTime: Date;
  clockOffsetMs: number;
  receivedAt: Date;
  /** The PC's offset measured after the command, when the server knows one. */
  nextClockOffsetMs: number | null;
}): ClockSuspectReason[] {
  const reasons: ClockSuspectReason[] = [];
  if (input.highestSeenTime.getTime() - input.deviceTime.getTime() > CLOCK_SKEW_LIMIT_MS)
    reasons.push('behind_highest_seen');
  const corrected = correctedTime(input.deviceTime, input.clockOffsetMs).getTime();
  if (corrected - input.receivedAt.getTime() > CLOCK_SKEW_LIMIT_MS) reasons.push('in_future');
  if (
    input.nextClockOffsetMs !== null &&
    Math.abs(input.nextClockOffsetMs - input.clockOffsetMs) > CLOCK_SKEW_LIMIT_MS
  )
    reasons.push('offset_jumped');
  return reasons;
}

/**
 * Rule 16: a command of a member who became inactive or lost the branch runs when its effective
 * time is more than 10 minutes before the change and it is not clock-suspect; otherwise it goes to
 * the quarantine for the owner.
 */
export function inactiveMemberDecision(input: {
  effectiveTime: Date;
  inactiveSince: Date;
  clockSuspect: boolean;
}): 'run' | 'quarantine' {
  const margin = input.inactiveSince.getTime() - input.effectiveTime.getTime();
  return margin > CLOCK_SKEW_LIMIT_MS && !input.clockSuspect ? 'run' : 'quarantine';
}

// Number blocks (rules 17–20, ADR 0035).

export const numberSeriesSchema = z.enum(['order']).meta({ id: 'NumberSeries' });

export type NumberSeries = z.infer<typeof numberSeriesSchema>;

/** Block *n* is `(n−1)·5000 + 1` to `n·5000 − 1`: 1–4999, 5001–9999… */
export const NUMBER_BLOCK_SIZE = 5000;

/** Blocks are reserved for the current and the next 6 business days. */
export const NUMBER_BLOCK_DAYS_AHEAD = 6;

export const MAX_NUMBER_BLOCK_INDEX = 400;

export function numberBlockRange(blockIndex: number): { first: number; last: number } {
  if (!Number.isInteger(blockIndex) || blockIndex < 1 || blockIndex > MAX_NUMBER_BLOCK_INDEX)
    throw new RangeError('A block index is a whole number from 1');
  return {
    first: (blockIndex - 1) * NUMBER_BLOCK_SIZE + 1,
    last: blockIndex * NUMBER_BLOCK_SIZE - 1,
  };
}

/** The block a number lies in, or null for a multiple of 5000 (never handed out) or below 1. */
export function numberBlockIndexOf(number: number): number | null {
  if (!Number.isInteger(number) || number < 1 || number % NUMBER_BLOCK_SIZE === 0) return null;
  return Math.floor(number / NUMBER_BLOCK_SIZE) + 1;
}

/** The next number of a block after `lastUsed` (null before the first), or null when used up. */
export function nextNumberInBlock(
  block: { first: number; last: number },
  lastUsed: number | null,
): number | null {
  const next = lastUsed === null ? block.first : lastUsed + 1;
  return next >= block.first && next <= block.last ? next : null;
}

/**
 * The label of an order the hub could not number (rule 19): `#` and the last four characters of
 * its command id; the server assigns its number on sync.
 */
export function provisionalOrderLabel(commandId: string): string {
  return `#${commandId.slice(-4)}`;
}

/** The business dates a PC holds blocks for at `now` (rule 17): today and the next 6. */
export function numberBlockDates(now: Date, businessDayEndsAt: TimeOfDay): LocalDate[] {
  const today = businessDateOf(now, businessDayEndsAt);
  return Array.from({ length: NUMBER_BLOCK_DAYS_AHEAD + 1 }, (_, day) => addDays(today, day));
}

export const numberBlocksRequestSchema = z
  .object({ series: numberSeriesSchema })
  .meta({ id: 'NumberBlocksRequest' });

export const numberBlockSchema = z
  .object({
    businessDate: localDateSchema,
    first: z.int().min(1),
    last: z.int().min(1),
  })
  .meta({ id: 'NumberBlock' });

export type NumberBlock = z.infer<typeof numberBlockSchema>;

export const numberBlocksSchema = z
  .object({ series: numberSeriesSchema, blocks: z.array(numberBlockSchema) })
  .meta({ id: 'NumberBlocks' });

export type NumberBlocks = z.infer<typeof numberBlocksSchema>;

// Hub roles and the branch's PCs (rule 38).

/** A PC's configured role, chosen online; every other PC of the branch is a client PC. */
export const hubRoleSchema = z.enum(['hub', 'standby']).meta({ id: 'HubRole' });

export type HubRole = z.infer<typeof hubRoleSchema>;

/** The role a PC plays right now on the LAN. */
export const liveRoleSchema = z
  .enum(['hub', 'standby', 'client', 'rejoining'])
  .meta({ id: 'LiveRole' });

export type LiveRole = z.infer<typeof liveRoleSchema>;

export const setHubRolesSchema = z
  .object({ hubDeviceId: idSchema, standbyDeviceId: idSchema.optional() })
  .meta({ id: 'SetHubRoles' });

export type SetHubRoles = z.infer<typeof setHubRolesSchema>;

// Heartbeats and connectivity (rules 43, 44, ADR 0035).

export const lanAddressesSchema = z.array(z.ipv4()).max(8).meta({ id: 'LanAddresses' });

/** A private IPv4 address (RFC 1918): the only addresses a PC certificate may name (rule 39). */
export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export const heartbeatSchema = z
  .object({
    /** The round trip of the previous heartbeat, null on the first. */
    lastRoundTripMs: z.int().min(0).max(600_000).nullable(),
    pendingUploads: z.int().min(0),
    liveRole: liveRoleSchema,
    hubEpoch: z.int().min(0),
    /** Whether the standby holds every journal entry; null on a PC that is not the hub. */
    standbyInSync: z.boolean().nullable(),
    appVersion: appVersionSchema,
    protocol: protocolSchema,
    lanAddresses: lanAddressesSchema,
    /** The PC's last measured offset, null before its first. */
    clockOffsetMs: z
      .int()
      .min(-(10 ** 12))
      .max(10 ** 12)
      .nullable(),
  })
  .meta({ id: 'Heartbeat' });

export type Heartbeat = z.infer<typeof heartbeatSchema>;

export const connectivityStateSchema = z
  .enum(['online', 'weak', 'offline'])
  .meta({ id: 'ConnectivityState' });

export type ConnectivityState = z.infer<typeof connectivityStateSchema>;

export const heartbeatAnswerSchema = z
  .object({
    serverTime: instantSchema,
    connectivity: connectivityStateSchema,
    minimumAppVersion: z.string(),
    protocols: z.array(z.int()),
  })
  .meta({ id: 'HeartbeatAnswer' });

export type HeartbeatAnswer = z.infer<typeof heartbeatAnswerSchema>;

/** ADR 0035's thresholds. */
export const connectivityPolicy = {
  heartbeatSeconds: 15,
  weakAfterSilenceSeconds: 45,
  offlineAfterSilenceSeconds: 180,
  slowRoundTripMs: 3000,
  /** Weak when this many of the last five round trips are slow. */
  slowOfRecent: 3,
  recentRoundTrips: 5,
  /** Online again after this many healthy heartbeats in a row. */
  healthyToRecover: 4,
} as const;

/**
 * The round trips a PC's state keeps after a heartbeat: the last five, restarted after a silence
 * long enough to make the branch weak, so a recovery counts heartbeats in a row.
 */
export function nextRecentRoundTrips(input: {
  previous: readonly number[];
  previousHeartbeatAt: Date | null;
  now: Date;
  roundTripMs: number | null;
}): number[] {
  const gap =
    input.previousHeartbeatAt === null
      ? Number.POSITIVE_INFINITY
      : input.now.getTime() - input.previousHeartbeatAt.getTime();
  const kept = gap > connectivityPolicy.weakAfterSilenceSeconds * 1000 ? [] : [...input.previous];
  if (input.roundTripMs !== null) kept.push(input.roundTripMs);
  return kept.slice(-connectivityPolicy.recentRoundTrips);
}

/** Heartbeats in a row, newest first, whose round trip was not slow. */
export function healthyStreak(recentRoundTripsMs: readonly number[]): number {
  let streak = 0;
  for (let i = recentRoundTripsMs.length - 1; i >= 0; i--) {
    if ((recentRoundTripsMs[i] as number) > connectivityPolicy.slowRoundTripMs) break;
    streak++;
  }
  return streak;
}

export type DeviceHeartbeatState = {
  lastHeartbeatAt: Date | null;
  recentRoundTripsMs: readonly number[];
};

const connectivityRank: Record<ConnectivityState, number> = { offline: 0, weak: 1, online: 2 };

function deviceConnectivity(
  device: DeviceHeartbeatState,
  current: ConnectivityState,
  now: Date,
): ConnectivityState {
  if (device.lastHeartbeatAt === null) return 'offline';
  const silence = now.getTime() - device.lastHeartbeatAt.getTime();
  if (silence > connectivityPolicy.offlineAfterSilenceSeconds * 1000) return 'offline';
  if (silence > connectivityPolicy.weakAfterSilenceSeconds * 1000) return 'weak';
  const slow = device.recentRoundTripsMs.filter(
    (roundTrip) => roundTrip > connectivityPolicy.slowRoundTripMs,
  ).length;
  if (slow >= connectivityPolicy.slowOfRecent) return 'weak';
  if (current === 'online') return 'online';
  return healthyStreak(device.recentRoundTripsMs) >= connectivityPolicy.healthyToRecover
    ? 'online'
    : 'weak';
}

/**
 * The branch's connectivity (rule 44, ADR 0035) from its hub-capable PCs: the best of their
 * states. A PC is `offline` after 3 minutes without a heartbeat, `weak` after 45 seconds or when 3
 * of its last 5 round trips exceed 3 seconds, and brings a weak or offline branch back `online`
 * only after 4 healthy heartbeats in a row.
 */
export function branchConnectivity(input: {
  current: ConnectivityState;
  devices: readonly DeviceHeartbeatState[];
  now: Date;
}): { state: ConnectivityState; healthyStreak: number } {
  let state: ConnectivityState = 'offline';
  let streak = 0;
  for (const device of input.devices) {
    const candidate = deviceConnectivity(device, input.current, input.now);
    if (connectivityRank[candidate] > connectivityRank[state]) state = candidate;
    if (candidate !== 'offline')
      streak = Math.max(streak, healthyStreak(device.recentRoundTripsMs));
  }
  return { state, healthyStreak: streak };
}

// The branch's PCs and their sync state (screens 1, 2).

export const branchPcSchema = z
  .object({
    deviceId: idSchema,
    name: z.string(),
    hubRole: hubRoleSchema.nullable(),
    sync: z
      .object({
        lastHeartbeatAt: instantSchema,
        liveRole: liveRoleSchema,
        hubEpoch: z.int().min(0),
        standbyInSync: z.boolean().nullable(),
        pendingUploads: z.int().min(0),
        appVersion: z.string(),
        protocol: z.int(),
        lanAddresses: z.array(z.string()),
        recentRoundTripsMs: z.array(z.int()),
        clockOffsetMs: z.int().nullable(),
      })
      .nullable(),
    certificate: z
      .object({
        fingerprint: sha256HexSchema,
        lanAddresses: z.array(z.string()),
        expiresAt: instantSchema,
      })
      .nullable(),
  })
  .meta({ id: 'BranchPc' });

export type BranchPc = z.infer<typeof branchPcSchema>;

export const branchSyncStatusSchema = z
  .object({
    branchId: idSchema,
    connectivity: z.object({ state: connectivityStateSchema, since: instantSchema }),
    pcs: z.array(branchPcSchema),
  })
  .meta({ id: 'BranchSyncStatus' });

export type BranchSyncStatus = z.infer<typeof branchSyncStatusSchema>;

// Tokens, certificates (rules 38, 39).

/** A PowerSync token: EdDSA, 5 minutes, `aud: powersync`. */
export const syncTokenSchema = z
  .object({ token: z.string(), expiresAt: instantSchema, endpoint: z.url() })
  .meta({ id: 'SyncToken' });

export type SyncToken = z.infer<typeof syncTokenSchema>;

/** A PC certificate lasts a year. */
export const DEVICE_CERTIFICATE_DAYS = 365;

/** The branch CA lasts 10 years. */
export const BRANCH_CA_YEARS = 10;

export const certificateRequestSchema = z
  .object({
    /** A PKCS #10 request in PEM for a new P-256 key. */
    csr: z.string().min(100).max(8000),
    lanAddresses: lanAddressesSchema.min(1),
  })
  .meta({ id: 'CertificateRequest' });

export type CertificateRequest = z.infer<typeof certificateRequestSchema>;

export const issuedCertificateSchema = z
  .object({
    certificate: z.string(),
    caCertificate: z.string(),
    /** The branch CA's SHA-256 fingerprint. */
    fingerprint: sha256HexSchema,
  })
  .meta({ id: 'IssuedCertificate' });

export type IssuedCertificate = z.infer<typeof issuedCertificateSchema>;

// The quarantine (rules 40–42).

/** One batch per revocation holds at most this many commands. */
export const MAX_QUARANTINE_COMMANDS = 10_000;

/**
 * A revoked PC's pending commands and unacknowledged journal entries. It has no device token: it
 * signs `quarantineUploadMessage(nonce, deviceId)` with its device key, the nonce from S02's
 * device-token challenge.
 */
export const quarantineUploadSchema = z
  .object({
    tenantId: idSchema,
    deviceId: idSchema,
    nonce: z.string().min(1).max(100),
    signature: signatureSchema,
    protocol: protocolSchema,
    commands: z.array(commandEnvelopeSchema).min(1).max(MAX_QUARANTINE_COMMANDS),
  })
  .meta({ id: 'QuarantineUpload' });

export type QuarantineUpload = z.infer<typeof quarantineUploadSchema>;

export function quarantineUploadMessage(nonce: string, deviceId: string): string {
  return `vertex-food/quarantine-upload/v1\n${nonce}\n${deviceId}`;
}

export const quarantineUploadResultSchema = z
  .object({ batchId: idSchema })
  .meta({ id: 'QuarantineUploadResult' });

/** A written reason: closing an attention item, rejecting a quarantine batch. */
export const decisionReasonSchema = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .meta({ id: 'DecisionReason' });

export const quarantineDecisionSchema = z
  .object({
    decision: z.enum(['accept', 'reject']),
    reason: z.string().nullable(),
    decidedByMembershipId: idSchema,
    decidedAt: instantSchema,
  })
  .meta({ id: 'QuarantineDecision' });

export const quarantineBatchSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    deviceId: idSchema,
    deviceName: z.string(),
    reason: quarantineReasonSchema,
    membershipId: idSchema.nullable(),
    commandCount: z.int().min(0),
    createdAt: instantSchema,
    decision: quarantineDecisionSchema.nullable(),
  })
  .meta({ id: 'QuarantineBatch' });

export type QuarantineBatch = z.infer<typeof quarantineBatchSchema>;

export const quarantineBatchListSchema = z
  .array(quarantineBatchSchema)
  .meta({ id: 'QuarantineBatchList' });

export const quarantineCommandSchema = z
  .object({
    commandId: idSchema,
    name: commandNameSchema,
    summary: commandSummarySchema,
    deviceTime: instantSchema,
    hubEpoch: z.int().min(0),
    hubSeq: z.int().min(0),
    /** Uploaded earlier by another PC: shown as already executed and skipped on accept. */
    alreadyExecuted: z.boolean(),
  })
  .meta({ id: 'QuarantineCommand' });

export const quarantineBatchDetailSchema = z
  .object({ batch: quarantineBatchSchema, commands: z.array(quarantineCommandSchema) })
  .meta({ id: 'QuarantineBatchDetail' });

export type QuarantineBatchDetail = z.infer<typeof quarantineBatchDetailSchema>;

export const rejectQuarantineSchema = z
  .object({ reason: decisionReasonSchema })
  .meta({ id: 'RejectQuarantine' });

export const quarantineDecisionResultSchema = z
  .object({ batch: quarantineBatchSchema, results: z.array(commandResultSchema) })
  .meta({ id: 'QuarantineDecisionResult' });

// Needs attention (rule 47).

export const attentionKindSchema = z
  .enum([
    'adjusted',
    'rejected',
    'replay_mismatch',
    'number_taken',
    'clock_suspect',
    'server_error',
  ])
  .meta({ id: 'AttentionKind' });

export type AttentionKind = z.infer<typeof attentionKindSchema>;

export const attentionItemSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    commandId: idSchema,
    kind: attentionKindSchema,
    /** The member who made the command; null for a station or the PC itself. */
    membershipId: idSchema.nullable(),
    createdAt: instantSchema,
    command: z.object({
      name: commandNameSchema,
      summary: commandSummarySchema,
      outcome: commandOutcomeSchema,
      reason: commandReasonSchema.nullable(),
      details: jsonObjectSchema.nullable(),
      receivedAt: instantSchema,
    }),
    resolution: z
      .object({
        reason: z.string(),
        resolvedByMembershipId: idSchema,
        resolvedAt: instantSchema,
      })
      .nullable(),
  })
  .meta({ id: 'AttentionItem' });

export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const listAttentionQuerySchema = listQuerySchema(['createdAt'])
  .extend({
    branchId: idSchema,
    status: z.enum(['open', 'closed', 'all']).default('open'),
    kind: attentionKindSchema.optional(),
  })
  .meta({ id: 'ListAttentionQuery' });

export type ListAttentionQuery = z.infer<typeof listAttentionQuerySchema>;

export const attentionPageSchema = pageSchema(attentionItemSchema).meta({ id: 'AttentionPage' });

export const resolveAttentionSchema = z
  .object({ reason: decisionReasonSchema })
  .meta({ id: 'ResolveAttention' });
