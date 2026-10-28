import { idSchema, instantSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import { entryRefSchema, wireEntrySchema } from './journal.js';

// The protocol between the branch's hub-capable PCs (`/peer/*`, mutual TLS, spec S04 rules 21–29).
// Internal to this package: PR 5's LAN server parses each request with these schemas and calls
// the matching handler of `BranchHub`; its client implements `PeerLink`. Every request carries the
// sender's LAN protocol; peers one version apart talk in the older one (edge case 11).

const protocolSchema = z.int().min(1).max(1000);

/** What a PC tells a peer about itself. */
export const peerStatusSchema = z.object({
  deviceId: idSchema,
  role: z.enum(['hub', 'standby', 'none']),
  epoch: z.int().min(0),
  appliedSeq: z.int().min(0),
  rejoining: z.boolean(),
  /** Hub clients on its live stream: the equal-epoch tie-break (rule 28). */
  liveClients: z.int().min(0),
});

export type PeerStatus = z.infer<typeof peerStatusSchema>;

/** Pairing and session use each PC saw, merged both ways at every heartbeat (rules 34, 35). */
export const peerActivitySchema = z.object({
  pairings: z
    .array(
      z.object({ id: idSchema, lastUsedAt: instantSchema, revokedAt: instantSchema.nullable() }),
    )
    .max(500),
  sessions: z
    .array(
      z.object({ id: idSchema, lastInputAt: instantSchema, endedAt: instantSchema.nullable() }),
    )
    .max(2000),
});

export type PeerActivity = z.infer<typeof peerActivitySchema>;

const fromPeer = { protocol: protocolSchema, from: idSchema, epoch: z.int().min(0) };

const mismatch = z.object({ result: z.literal('protocol_mismatch'), protocol: protocolSchema });

export const peerStateRequestSchema = z.object(fromPeer);

export const peerStateAnswerSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('ok'), status: peerStatusSchema }),
  mismatch,
]);

export const heartbeatRequestSchema = z.object({
  ...fromPeer,
  liveClients: z.int().min(0),
  /** The hub's latest sequence and its entry there (rule 22). */
  seq: z.int().min(0),
  last: entryRefSchema.nullable(),
  /** The lowest sequence it still keeps: a standby below it cannot catch up offline (rule 29). */
  oldest: z.int().min(1).nullable(),
  activity: peerActivitySchema,
});

export const heartbeatAnswerSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('ok'), status: peerStatusSchema, activity: peerActivitySchema }),
  /** The receiver holds a higher epoch, or wins the tie-break: the sender demotes itself. */
  z.object({ result: z.literal('stale'), status: peerStatusSchema }),
  mismatch,
]);

export const mirrorRequestSchema = z.object({
  ...fromPeer,
  /** The hub's entry just before the first one sent (rule 21). */
  prev: entryRefSchema.nullable(),
  entries: z.array(wireEntrySchema).min(1).max(500),
});

export const mirrorAnswerSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('ok'), appliedSeq: z.int().min(0) }),
  /** Its journal does not match at the previous number: it rejoins. */
  z.object({ result: z.literal('diverged'), appliedSeq: z.int().min(0) }),
  /** It misses entries before these: send from `from`. */
  z.object({ result: z.literal('need_from'), from: z.int().min(1) }),
  z.object({ result: z.literal('rejoining') }),
  z.object({ result: z.literal('stale'), status: peerStatusSchema }),
  mismatch,
]);

export const journalRequestSchema = z.object({ ...fromPeer, after: z.int().min(0) });

export const journalAnswerSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    status: peerStatusSchema,
    /** The lowest sequence it still keeps (rule 29), null when its journal is empty. */
    oldestSeq: z.int().min(1).nullable(),
    entries: z.array(wireEntrySchema),
  }),
  mismatch,
]);

export const forwardRequestSchema = z.object({
  ...fromPeer,
  entries: z.array(wireEntrySchema).min(1).max(500),
});

export const forwardAnswerSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    /**
     * Per entry: `applied` as forwarded, `resolved` again by the hub because a check failed,
     * `duplicate` (already in its journal, or `alreadyApplied`), `refused` by its access check.
     */
    entries: z.array(
      z.object({ id: idSchema, status: z.enum(['applied', 'resolved', 'duplicate', 'refused']) }),
    ),
  }),
  z.object({ result: z.literal('not_hub'), status: peerStatusSchema }),
  mismatch,
]);

export type PeerStateRequest = z.infer<typeof peerStateRequestSchema>;
export type PeerStateAnswer = z.infer<typeof peerStateAnswerSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type HeartbeatAnswer = z.infer<typeof heartbeatAnswerSchema>;
export type MirrorRequest = z.infer<typeof mirrorRequestSchema>;
export type MirrorAnswer = z.infer<typeof mirrorAnswerSchema>;
export type JournalRequest = z.infer<typeof journalRequestSchema>;
export type JournalAnswer = z.infer<typeof journalAnswerSchema>;
export type ForwardRequest = z.infer<typeof forwardRequestSchema>;
export type ForwardAnswer = z.infer<typeof forwardAnswerSchema>;

/**
 * One peer as this PC reaches it. A call rejects when the peer cannot be reached or does not
 * answer within `timeoutMs` (the mirror's 0.8 s, `hubPolicy`).
 */
export interface PeerLink {
  state(request: PeerStateRequest, timeoutMs: number): Promise<PeerStateAnswer>;
  heartbeat(request: HeartbeatRequest, timeoutMs: number): Promise<HeartbeatAnswer>;
  mirror(request: MirrorRequest, timeoutMs: number): Promise<MirrorAnswer>;
  journal(request: JournalRequest, timeoutMs: number): Promise<JournalAnswer>;
  forward(request: ForwardRequest, timeoutMs: number): Promise<ForwardAnswer>;
}

/** What a PC serves to its peers; `BranchHub` implements it. */
export interface PeerHandlers {
  peerState(request: PeerStateRequest): Promise<PeerStateAnswer>;
  peerHeartbeat(request: HeartbeatRequest): Promise<HeartbeatAnswer>;
  peerMirror(request: MirrorRequest): Promise<MirrorAnswer>;
  peerJournal(request: JournalRequest): Promise<JournalAnswer>;
  peerForward(request: ForwardRequest): Promise<ForwardAnswer>;
}

export type PeerTransport = (deviceId: string) => PeerLink;

/**
 * Whether peer `a` is the hub when two meet (rule 28): the higher epoch; at equal epochs (two
 * manual promotions) the one with more connected hub clients, then the lower device id.
 */
export function outranks(
  a: { epoch: number; liveClients: number; deviceId: string },
  b: { epoch: number; liveClients: number; deviceId: string },
): boolean {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch;
  if (a.liveClients !== b.liveClients) return a.liveClients > b.liveClients;
  return a.deviceId < b.deviceId;
}
