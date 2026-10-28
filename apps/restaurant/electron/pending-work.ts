import { type CommandEnvelope, commandEnvelopeSchema } from '@vertex-food/contracts';
import type { LocalReads } from './local-db.js';

// What a PC still owes the server (spec S04 rules 40, 46): the commands in PowerSync's upload queue
// (`ps_crud`, rows of the insert-only `commands` table) and the command entries of its journal that
// have no server outcome yet, neither in the synced `command_log` nor in this PC's own
// `command_results`. Both read through `LocalReads`, so a read-only database answers too.

/** Journal command entries without an outcome; their body is the journal body as JSON. */
const unsettledJournal = `
  FROM hub_journal j
  WHERE j.kind = 'command'
    AND NOT EXISTS (SELECT 1 FROM command_log c WHERE c.id = j.id)
    AND NOT EXISTS (SELECT 1 FROM command_results r WHERE r.id = j.id AND r.outcome IS NOT NULL)`;

export type PendingCounts = { uploads: number; unsettled: number };

export async function pendingCounts(reads: LocalReads): Promise<PendingCounts> {
  const uploads = await reads.getOptional<{ n: number }>('SELECT count(*) AS n FROM ps_crud');
  const unsettled = await reads.getOptional<{ n: number }>(
    `SELECT count(*) AS n ${unsettledJournal}`,
  );
  return { uploads: uploads?.n ?? 0, unsettled: unsettled?.n ?? 0 };
}

function parseEnvelope(json: unknown): CommandEnvelope | null {
  const parsed = commandEnvelopeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Every pending signed envelope, once per id, in journal order `(hubEpoch, hubSeq)` (rule 12).
 * A row that does not parse is left out: it could never be accepted, and the server's audit of
 * the batch holds what arrived.
 */
export async function pendingEnvelopes(reads: LocalReads): Promise<CommandEnvelope[]> {
  const byId = new Map<string, CommandEnvelope>();
  const queued = await reads.getAll<{ data: string }>('SELECT data FROM ps_crud ORDER BY id');
  for (const row of queued) {
    const op = parseJson(row.data) as { type?: unknown; data?: { envelope?: unknown } } | null;
    if (op?.type !== 'commands' || typeof op.data?.envelope !== 'string') continue;
    const envelope = parseEnvelope(parseJson(op.data.envelope));
    if (envelope) byId.set(envelope.id, envelope);
  }
  const journal = await reads.getAll<{ body: string }>(`SELECT j.body AS body ${unsettledJournal}`);
  for (const row of journal) {
    const body = parseJson(row.body) as { envelope?: unknown } | null;
    const envelope = parseEnvelope(body?.envelope);
    if (envelope && !byId.has(envelope.id)) byId.set(envelope.id, envelope);
  }
  return [...byId.values()].sort((a, b) => a.hubEpoch - b.hubEpoch || a.hubSeq - b.hubSeq);
}
