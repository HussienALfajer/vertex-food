import { z } from 'zod';
import { staffPermissionSchema, staffRoleSchema } from './access.js';
import { pinSchema } from './identity.js';
import { idSchema, instantSchema } from './primitives.js';
import {
  commandActorSchema,
  commandEnvelopeSchema,
  commandNameSchema,
  commandVersionSchema,
  connectivityStateSchema,
  hubRefusalReasonSchema,
  liveRoleSchema,
  sha256HexSchema,
} from './sync.js';

// The branch hub's LAN API (spec S04 rules 21–37, ADR 0022, 0035): what hub clients (phones and
// screens) and client PCs exchange with the active hub over HTTPS. The protocol between the
// hub-capable PCs (`/peer/*`) is internal to `packages/sync`.

/** HTTPS with the PC certificate: the hub client pages, `/hub/*` and `/peer/*`. */
export const HUB_HTTPS_PORT = 7443;

/** Plain HTTP, only while pairing is open, serving only the branch CA certificate (rule 37). */
export const HUB_CA_HTTP_PORT = 7080;

/** The hub's timing (ADR 0022, kept as Spike A tested it). */
export const hubPolicy = {
  heartbeatMs: 500,
  /** A standby holding every reported entry promotes itself after this silence. */
  promoteAfterSilenceMs: 3000,
  /** The hub waits this long for the standby's answer to a mirror. */
  mirrorTimeoutMs: 800,
  /** A client asks every hub-capable PC again after this long without the live stream. */
  clientRediscoverMs: 3000,
  /** Journal entries are kept at least this many business days (rule 29). */
  journalRetentionBusinessDays: 7,
  /** Catch-up tries during a pending rejoin before "needs the other PC" (rule 27). */
  rejoinCatchUpTries: 3,
} as const;

// Pairing (rules 33–37).

export const pairingPolicy = {
  windowSeconds: 120,
  maxWrongCodes: 5,
  codeDigits: 6,
  /** A pairing ends after this many days without a request (rule 34). */
  idleExpiryDays: 30,
  /** Delays between failed attempts from one address grow 1, 2, 4… seconds, up to this. */
  maxRetryDelaySeconds: 64,
} as const;

export const pairingKindSchema = z.enum(['station', 'personal']).meta({ id: 'PairingKind' });

export type PairingKind = z.infer<typeof pairingKindSchema>;

/** A pairing's name on the hub («شاشة المطبخ 1», «هاتف الصالة»). */
export const pairingNameSchema = z.string().trim().min(2).max(50).meta({ id: 'PairingName' });

export const pairingCodeSchema = z
  .string()
  .regex(/^\d{6}$/)
  .meta({ id: 'PairingCode' });

/** A manager opens pairing on the active hub for one kind of client. */
export const openPairingSchema = z
  .object({ kind: pairingKindSchema, name: pairingNameSchema })
  .meta({ id: 'OpenPairing' });

export type OpenPairing = z.infer<typeof openPairingSchema>;

export type PairingWindow = { openedAt: Date; closedAt: Date | null; wrongCodes: number };

/** Open for 2 minutes, until closed by hand, by a successful pairing, or by 5 wrong codes. */
export function isPairingWindowOpen(window: PairingWindow, now: Date): boolean {
  return (
    window.closedAt === null &&
    window.wrongCodes < pairingPolicy.maxWrongCodes &&
    now.getTime() < window.openedAt.getTime() + pairingPolicy.windowSeconds * 1000 &&
    now.getTime() >= window.openedAt.getTime()
  );
}

/** How long an address waits before its next try after `failures` wrong codes in a row. */
export function pairingRetryDelaySeconds(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(2 ** (failures - 1), pairingPolicy.maxRetryDelaySeconds);
}

/** A pairing unused for 30 days has ended (rule 34, edge case 12). */
export function isPairingExpired(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() > pairingPolicy.idleExpiryDays * 24 * 60 * 60 * 1000;
}

/**
 * The pairing QR (rule 37): the hub's address with the peers, the CA fingerprint and the code in
 * the fragment, which never reaches a server log.
 */
export function pairingQrUrl(input: {
  hubAddress: string;
  peers: readonly string[];
  caFingerprint: string;
  code: string;
}): string {
  const fragment = `peers=${input.peers.join(',')}&fp=${input.caFingerprint}&code=${input.code}`;
  return `https://${input.hubAddress}:${HUB_HTTPS_PORT}/pair#${fragment}`;
}

/** The download QR of the branch CA, served only while pairing is open. */
export function caDownloadUrl(hubAddress: string): string {
  return `http://${hubAddress}:${HUB_CA_HTTP_PORT}/ca.crt`;
}

export type PairingFragment = { peers: string[]; caFingerprint: string; code: string };

/** Reads the pairing QR's fragment (with or without `#`), or null when anything is missing. */
export function parsePairingFragment(fragment: string): PairingFragment | null {
  const fields = new Map<string, string>();
  for (const part of fragment.replace(/^#/, '').split('&')) {
    const at = part.indexOf('=');
    if (at > 0) fields.set(part.slice(0, at), part.slice(at + 1));
  }
  const peers = (fields.get('peers') ?? '').split(',').filter((peer) => peer.length > 0);
  const caFingerprint = fields.get('fp') ?? '';
  const code = fields.get('code') ?? '';
  if (
    peers.length === 0 ||
    !peers.every((peer) => z.ipv4().safeParse(peer).success) ||
    !sha256HexSchema.safeParse(caFingerprint).success ||
    !pairingCodeSchema.safeParse(code).success
  )
    return null;
  return { peers, caFingerprint, code };
}

/** `POST /hub/pair`. */
export const hubPairRequestSchema = z
  .object({ code: pairingCodeSchema })
  .meta({ id: 'HubPairRequest' });

export const hubPairResultSchema = z
  .object({
    token: z.string(),
    pairingId: idSchema,
    kind: pairingKindSchema,
    /** The addresses of both hub-capable PCs: a client follows a failover by itself. */
    peers: z.array(z.ipv4()).min(1).max(16),
    caFingerprint: sha256HexSchema,
  })
  .meta({ id: 'HubPairResult' });

export type HubPairResult = z.infer<typeof hubPairResultSchema>;

/** A pairing as the branch network screen lists it. */
export const hubPairingSchema = z
  .object({
    id: idSchema,
    kind: pairingKindSchema,
    name: z.string(),
    createdAt: instantSchema,
    lastUsedAt: instantSchema,
  })
  .meta({ id: 'HubPairing' });

export type HubPairing = z.infer<typeof hubPairingSchema>;

// Discovery (rule 30).

/** `GET /hub/hello`: a client takes the highest epoch among the PCs it can reach. */
export const hubHelloSchema = z
  .object({
    deviceId: idSchema,
    role: liveRoleSchema,
    epoch: z.int().min(0),
    protocol: z.int().min(1),
    appVersion: z.string(),
  })
  .meta({ id: 'HubHello' });

export type HubHello = z.infer<typeof hubHelloSchema>;

// Member sessions on personal pairings (rule 35).

/** A hub client session ends after the branch's idle lock without input, or after 12 hours. */
export const HUB_SESSION_MAX_HOURS = 12;

export function isHubSessionActive(
  session: { startedAt: Date; lastInputAt: Date; idleLockMinutes: number },
  now: Date,
): boolean {
  return (
    now.getTime() - session.lastInputAt.getTime() < session.idleLockMinutes * 60 * 1000 &&
    now.getTime() - session.startedAt.getTime() < HUB_SESSION_MAX_HOURS * 60 * 60 * 1000
  );
}

/** `GET /hub/members`: names and roles only, never verifiers. */
export const hubMembersSchema = z
  .object({
    members: z.array(
      z.object({ membershipId: idSchema, name: z.string(), roles: z.array(staffRoleSchema) }),
    ),
  })
  .meta({ id: 'HubMembers' });

export type HubMembers = z.infer<typeof hubMembersSchema>;

export const hubSessionRequestSchema = z
  .object({ membershipId: idSchema, pin: pinSchema })
  .meta({ id: 'HubSessionRequest' });

export const hubSessionSchema = z
  .object({
    /** Kept in the page's memory only. */
    token: z.string(),
    membershipId: idSchema,
    name: z.string(),
    permissions: z.array(staffPermissionSchema),
    idleLockMinutes: z.int().min(1),
    expiresAt: instantSchema,
  })
  .meta({ id: 'HubSession' });

export type HubSession = z.infer<typeof hubSessionSchema>;

// Commands on the LAN (rules 5, 6, 31).

/**
 * `POST /hub/commands`. A hub client's actor comes from its pairing and session; a client PC names
 * the member signed in on it, their approver and its offline-window flag (S02), checked by the hub
 * against its member list. `resent` is a version answered `mirrored: false`, re-sent after a
 * failover with its executor's signature (rule 31).
 */
export const hubCommandSchema = z
  .object({
    id: idSchema,
    name: commandNameSchema,
    version: commandVersionSchema,
    payload: z.record(z.string(), z.unknown()),
    deviceTime: instantSchema,
    actor: commandActorSchema.optional(),
    approvedByMembershipId: idSchema.optional(),
    afterOfflineWindow: z.boolean().optional(),
    resent: commandEnvelopeSchema.optional(),
  })
  .meta({ id: 'HubCommand' });

export type HubCommand = z.infer<typeof hubCommandSchema>;

/**
 * The hub's answer: `ok` with the signed envelope (its resolved version, epoch and sequence) and
 * whether the standby holds it; `duplicate` with the stored answer of a command already in the
 * journal; `refused` before journaling (nothing written); `not_hub` with the hub it knows of.
 */
export const hubCommandAnswerSchema = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), mirrored: z.boolean(), envelope: commandEnvelopeSchema }),
    z.object({
      status: z.literal('duplicate'),
      mirrored: z.boolean(),
      envelope: commandEnvelopeSchema,
    }),
    z.object({ status: z.literal('refused'), reason: hubRefusalReasonSchema }),
    z.object({
      status: z.literal('not_hub'),
      epoch: z.int().min(0),
      hubDeviceId: idSchema.nullable(),
    }),
  ])
  .meta({ id: 'HubCommandAnswer' });

export type HubCommandAnswer = z.infer<typeof hubCommandAnswerSchema>;

// The live snapshot (rule 32).

/** One `sync.network_check` as the hub recorded it. */
export const networkCheckRecordSchema = z
  .object({
    commandId: idSchema,
    run: idSchema,
    sequence: z.int().min(1),
    originDeviceId: idSchema,
    sentAt: instantSchema,
    receivedAt: instantSchema,
    /** Null when the standby did not answer (`mirrored: false`). */
    mirroredAt: instantSchema.nullable(),
    committedAt: instantSchema,
  })
  .meta({ id: 'NetworkCheckRecord' });

export type NetworkCheckRecord = z.infer<typeof networkCheckRecordSchema>;

/** `GET /hub/live`: a full snapshot over server-sent events on every change. S09 and S11 add theirs. */
export const hubLiveSnapshotSchema = z
  .object({
    hub: z.object({
      deviceId: idSchema,
      role: liveRoleSchema,
      epoch: z.int().min(0),
      standby: z.enum(['in_sync', 'not_in_sync', 'none']),
      connectivity: connectivityStateSchema,
    }),
    clients: z.array(hubPairingSchema),
    networkChecks: z.array(networkCheckRecordSchema),
  })
  .meta({ id: 'HubLiveSnapshot' });

export type HubLiveSnapshot = z.infer<typeof hubLiveSnapshotSchema>;
