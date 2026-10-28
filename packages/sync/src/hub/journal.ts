import {
  commandEnvelopeSchema,
  idSchema,
  instantSchema,
  localDateSchema,
  numberSeriesSchema,
  pairingKindSchema,
  sha256HexSchema,
} from '@vertex-food/contracts';
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical.js';

// The hub journal (spec S04 rules 5, 21–29, ADR 0022): one sequenced entry per command the branch's
// hub ran, plus the local-only entries the hub copies to its standby the same way (pairings, PIN
// sessions, PIN lockouts, rule 33 and 35). A copy is checked, not counted: two PCs hold the same
// entry at a number only when the id and the hash match.

/** A number the hub took from its own block while it resolved a command (rule 18). */
export const numberUseSchema = z.object({
  series: numberSeriesSchema,
  businessDate: localDateSchema,
  number: z.int().min(1),
});

export type NumberUse = z.infer<typeof numberUseSchema>;

export const journalBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'),
    /** Signed by the PC that executed it; never changed when the entry is re-sequenced. */
    envelope: commandEnvelopeSchema,
    /** Set by the executing hub, so a hub that takes the entry back keeps its counter (rule 23). */
    numberUsed: numberUseSchema.nullable(),
  }),
  z.object({
    kind: z.literal('hub.pairing'),
    pairingId: idSchema,
    pairingKind: pairingKindSchema,
    name: z.string().min(1).max(50),
    tokenHash: sha256HexSchema,
    createdAt: instantSchema,
  }),
  z.object({
    kind: z.literal('hub.session'),
    sessionId: idSchema,
    pairingId: idSchema,
    membershipId: idSchema,
    tokenHash: sha256HexSchema,
    startedAt: instantSchema,
  }),
  z.object({ kind: z.literal('hub.pin_disabled'), membershipId: idSchema, at: instantSchema }),
]);

export type JournalBody = z.infer<typeof journalBodySchema>;

export type CommandBody = Extract<JournalBody, { kind: 'command' }>;

/** An entry as it travels between the hub-capable PCs (`/peer/*`). */
export const wireEntrySchema = z.object({
  /** The command id, or the id of a local entry. */
  id: idSchema,
  seq: z.int().min(1),
  epoch: z.int().min(0),
  body: journalBodySchema,
});

export type WireEntry = z.infer<typeof wireEntrySchema>;

/** An entry as a PC stores it: the wire entry and what only this PC knows about it. */
export type JournalEntry = WireEntry & {
  /** Whether the standby held it when this PC committed it; true on the PC that received it. */
  mirrored: boolean;
  mirroredAt: string | null;
  committedAt: string;
  /**
   * Taken by this PC alone, outside the hub's lineage (rule 24): forwarded at rejoin, numbered
   * again by the hub, and back in the lineage when the hub's copy arrives with its new number.
   */
  ownLineage: boolean;
  forwardedAt: string | null;
};

/** What a mirror and a heartbeat compare: the entry at a number, by id and hash (rule 21). */
export type EntryRef = { seq: number; id: string; hash: string };

export const entryRefSchema = z.object({
  seq: z.int().min(1),
  id: idSchema,
  hash: sha256HexSchema,
});

/** A command's payload hash; for a local entry, the hash of its canonical body. */
export function entryHash(body: JournalBody): string {
  return body.kind === 'command' ? body.envelope.payloadHash : sha256Hex(canonicalJson(body));
}

export function refOf(entry: WireEntry): EntryRef {
  return { seq: entry.seq, id: entry.id, hash: entryHash(entry.body) };
}

export function sameRef(a: EntryRef | null, b: EntryRef | null): boolean {
  return a !== null && b !== null && a.id === b.id && a.hash === b.hash;
}

export function toWire(entry: WireEntry): WireEntry {
  return { id: entry.id, seq: entry.seq, epoch: entry.epoch, body: entry.body };
}
