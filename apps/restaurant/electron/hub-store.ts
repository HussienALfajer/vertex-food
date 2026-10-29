import type { PowerSyncDatabase } from '@powersync/node';
import type { LocalDate, NumberSeries } from '@vertex-food/contracts';
import {
  entryHash,
  type HubState,
  type HubStore,
  type HubTransaction,
  type JournalBody,
  type JournalEntry,
  journalBodySchema,
  type LocalEvent,
  type LocalNumberBlock,
  type NumberUse,
  type PairingRecord,
  type SessionRecord,
} from '@vertex-food/sync';
import { uuidv7 } from './uuid.js';

// The hub's storage port on the PC's encrypted local database (spec S04 rules 5, 18, 21–29,
// ADR 0022): the local-only tables of `local-db.ts`. A transaction is one PowerSync write
// transaction, so its journal row, upload-queue row, result row and counter are written together
// or not at all, with `synchronous=FULL`, as the memory store of `packages/sync` models a power cut.

/** Reads and writes inside or outside a transaction (PowerSync's database and its transactions). */
type Sql = {
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>;
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>;
  execute(sql: string, parameters?: unknown[]): Promise<unknown>;
};

const STATE_ID = 'hub';

type JournalRow = {
  id: string;
  seq: number;
  epoch: number;
  body: string;
  mirrored: number | null;
  mirrored_at: string | null;
  committed_at: string;
  own_lineage: number | null;
  forwarded_at: string | null;
};

const JOURNAL_COLUMNS =
  'id, seq, epoch, body, mirrored, mirrored_at, committed_at, own_lineage, forwarded_at';

function entryOf(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    seq: row.seq,
    epoch: row.epoch,
    // Written by this store from a checked body: a row that does not parse is a damaged file,
    // which the integrity check at start opens read-only.
    body: journalBodySchema.parse(JSON.parse(row.body)),
    mirrored: row.mirrored === 1,
    mirroredAt: row.mirrored_at,
    committedAt: row.committed_at,
    ownLineage: row.own_lineage === 1,
    forwardedAt: row.forwarded_at,
  };
}

function numberKey(use: NumberUse): string {
  return `${use.series}/${use.businessDate}/${use.number}`;
}

function nameOf(body: JournalBody): string | null {
  return body.kind === 'command' ? body.envelope.name : null;
}

class Reads {
  constructor(protected readonly sql: Sql) {}

  async loadState(): Promise<HubState | null> {
    const row = await this.sql.getOptional<{
      role: string;
      epoch: number;
      applied_seq: number;
      hub_device_id: string | null;
      rejoining: number;
      hub_seq: number;
      last_heartbeat_at: string | null;
      notice: string | null;
    }>('SELECT * FROM hub_state WHERE id = ?', [STATE_ID]);
    if (!row) return null;
    return {
      role: row.role === 'hub' || row.role === 'standby' ? row.role : 'none',
      epoch: row.epoch,
      appliedSeq: row.applied_seq,
      hubDeviceId: row.hub_device_id,
      rejoining: row.rejoining === 1,
      hubSeq: row.hub_seq,
      lastHeartbeatAt: row.last_heartbeat_at,
      notice:
        row.notice === 'too_far_behind' || row.notice === 'needs_other_pc' ? row.notice : null,
    };
  }

  async entry(id: string): Promise<JournalEntry | null> {
    const row = await this.sql.getOptional<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM hub_journal WHERE id = ?`,
      [id],
    );
    return row ? entryOf(row) : null;
  }

  async entryAt(seq: number): Promise<JournalEntry | null> {
    const row = await this.sql.getOptional<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM hub_journal WHERE seq = ? AND own_lineage = 0`,
      [seq],
    );
    return row ? entryOf(row) : null;
  }

  async entriesAfter(seq: number, limit?: number): Promise<JournalEntry[]> {
    const rows = await this.sql.getAll<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM hub_journal WHERE own_lineage = 0 AND seq > ?
       ORDER BY seq LIMIT ?`,
      [seq, limit ?? -1],
    );
    return rows.map(entryOf);
  }

  async ownLineage(): Promise<JournalEntry[]> {
    const rows = await this.sql.getAll<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM hub_journal WHERE own_lineage = 1 ORDER BY seq`,
    );
    return rows.map(entryOf);
  }

  async oldestSeq(): Promise<number | null> {
    const row = await this.sql.getOptional<{ seq: number | null }>(
      'SELECT min(seq) AS seq FROM hub_journal WHERE own_lineage = 0',
    );
    return row?.seq ?? null;
  }

  async recentCommands(name: string, limit: number): Promise<JournalEntry[]> {
    const rows = await this.sql.getAll<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM hub_journal WHERE own_lineage = 0 AND name = ?
       ORDER BY seq DESC LIMIT ?`,
      [name, limit],
    );
    return rows.map(entryOf);
  }

  async localBlock(
    series: NumberSeries,
    businessDate: LocalDate,
  ): Promise<LocalNumberBlock | null> {
    const row = await this.sql.getOptional<{
      first_number: number;
      last_number: number;
      last_used: number | null;
    }>('SELECT first_number, last_number, last_used FROM number_blocks_local WHERE id = ?', [
      `${series}:${businessDate}`,
    ]);
    return row
      ? {
          series,
          businessDate,
          first: row.first_number,
          last: row.last_number,
          lastUsed: row.last_used,
        }
      : null;
  }

  async pairings(): Promise<PairingRecord[]> {
    const rows = await this.sql.getAll<{
      id: string;
      kind: string;
      name: string;
      token_hash: string;
      created_at: string;
      last_used_at: string;
      revoked_at: string | null;
    }>('SELECT * FROM hub_pairings ORDER BY created_at');
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind === 'station' ? 'station' : 'personal',
      name: row.name,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    }));
  }

  async sessions(): Promise<SessionRecord[]> {
    const rows = await this.sql.getAll<{
      id: string;
      pairing_id: string;
      membership_id: string;
      token_hash: string;
      started_at: string;
      last_input_at: string;
      ended_at: string | null;
    }>('SELECT * FROM hub_sessions ORDER BY started_at');
    return rows.map((row) => ({
      id: row.id,
      pairingId: row.pairing_id,
      membershipId: row.membership_id,
      tokenHash: row.token_hash,
      startedAt: row.started_at,
      lastInputAt: row.last_input_at,
      endedAt: row.ended_at,
    }));
  }

  async numberTaken(use: NumberUse, exceptId: string): Promise<boolean> {
    const row = await this.sql.getOptional<{ id: string }>(
      'SELECT id FROM hub_journal WHERE number_used = ? AND id != ? LIMIT 1',
      [numberKey(use), exceptId],
    );
    return row !== null;
  }

  async pinDisabled(membershipId: string): Promise<boolean> {
    const row = await this.sql.getOptional<{ id: string }>(
      'SELECT id FROM hub_pin_locks WHERE id = ?',
      [membershipId],
    );
    return row !== null;
  }

  /** A command is settled once the server's outcome arrived, synced or answered to this PC. */
  async isSettled(id: string): Promise<boolean> {
    const row = await this.sql.getOptional<{ kind: string; settled: number }>(
      `SELECT j.kind AS kind,
         (EXISTS (SELECT 1 FROM command_log c WHERE c.id = j.id)
           OR EXISTS (SELECT 1 FROM command_results r WHERE r.id = j.id AND r.outcome IS NOT NULL))
           AS settled
       FROM hub_journal j WHERE j.id = ?`,
      [id],
    );
    return row?.kind !== 'command' || row.settled === 1;
  }
}

class Transaction extends Reads implements HubTransaction {
  constructor(
    sql: Sql,
    private readonly deviceId: string,
  ) {
    super(sql);
  }

  async saveState(state: HubState): Promise<void> {
    await this.sql.execute(
      `INSERT OR REPLACE INTO hub_state (id, role, epoch, applied_seq, hub_device_id, rejoining,
         hub_seq, last_heartbeat_at, notice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        STATE_ID,
        state.role,
        state.epoch,
        state.appliedSeq,
        state.hubDeviceId,
        state.rejoining ? 1 : 0,
        state.hubSeq,
        state.lastHeartbeatAt,
        state.notice,
      ],
    );
  }

  /** What an entry writes besides its journal row (rules 5, 18, 33, 35). */
  private async effects(entry: JournalEntry): Promise<void> {
    const { body } = entry;
    switch (body.kind) {
      case 'command': {
        const { envelope, numberUsed } = body;
        // The upload queue: the server re-executes it, whichever PC uploads it first (rule 7).
        await this.sql.execute('INSERT INTO commands (id, envelope, mirrored) VALUES (?, ?, ?)', [
          envelope.id,
          JSON.stringify(envelope),
          entry.mirrored ? 1 : 0,
        ]);
        const actor = envelope.actor;
        const result = await this.sql.getOptional<{ id: string }>(
          'SELECT id FROM command_results WHERE id = ?',
          [envelope.id],
        );
        if (result) {
          await this.sql.execute(
            'UPDATE command_results SET payload = ?, resolved = ? WHERE id = ?',
            [JSON.stringify(envelope.payload), JSON.stringify(envelope.resolved), envelope.id],
          );
        } else {
          await this.sql.execute(
            `INSERT INTO command_results (id, name, membership_id, payload, resolved, made_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              envelope.id,
              envelope.name,
              actor.kind === 'member' ? actor.membershipId : null,
              JSON.stringify(envelope.payload),
              JSON.stringify(envelope.resolved),
              envelope.deviceTime,
            ],
          );
        }
        if (numberUsed && envelope.executedByDeviceId === this.deviceId) {
          await this.sql.execute(
            `UPDATE number_blocks_local SET last_used = max(coalesce(last_used, 0), ?)
             WHERE id = ?`,
            [numberUsed.number, `${numberUsed.series}:${numberUsed.businessDate}`],
          );
        }
        return;
      }
      case 'hub.pairing':
        await this.sql.execute(
          `INSERT OR IGNORE INTO hub_pairings (id, kind, name, token_hash, created_at,
             last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [
            body.pairingId,
            body.pairingKind,
            body.name,
            body.tokenHash,
            body.createdAt,
            body.createdAt,
          ],
        );
        return;
      case 'hub.session':
        await this.sql.execute(
          `INSERT OR IGNORE INTO hub_sessions (id, pairing_id, membership_id, token_hash,
             started_at, last_input_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [
            body.sessionId,
            body.pairingId,
            body.membershipId,
            body.tokenHash,
            body.startedAt,
            body.startedAt,
          ],
        );
        return;
      case 'hub.pin_disabled':
        await this.sql.execute('INSERT OR IGNORE INTO hub_pin_locks (id, at) VALUES (?, ?)', [
          body.membershipId,
          body.at,
        ]);
        return;
    }
  }

  private async writeRow(entry: JournalEntry, insert: boolean): Promise<void> {
    const values = [
      entry.seq,
      entry.epoch,
      entry.body.kind,
      nameOf(entry.body),
      JSON.stringify(entry.body),
      entryHash(entry.body),
      entry.body.kind === 'command' && entry.body.numberUsed
        ? numberKey(entry.body.numberUsed)
        : null,
      entry.mirrored ? 1 : 0,
      entry.mirroredAt,
      entry.committedAt,
      entry.ownLineage ? 1 : 0,
      entry.forwardedAt,
    ];
    if (insert) {
      await this.sql.execute(
        `INSERT INTO hub_journal (seq, epoch, kind, name, body, payload_hash, number_used,
           mirrored, mirrored_at, committed_at, own_lineage, forwarded_at, id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, entry.id],
      );
    } else {
      await this.sql.execute(
        `UPDATE hub_journal SET seq = ?, epoch = ?, kind = ?, name = ?, body = ?, payload_hash = ?,
           number_used = ?, mirrored = ?, mirrored_at = ?, committed_at = ?, own_lineage = ?,
           forwarded_at = ?
         WHERE id = ?`,
        [...values, entry.id],
      );
    }
  }

  async appendEntry(entry: JournalEntry): Promise<void> {
    if (await this.entry(entry.id)) throw new Error('The journal already holds this entry');
    await this.writeRow(entry, true);
    await this.effects(entry);
  }

  async moveEntry(id: string, seq: number, epoch: number): Promise<void> {
    await this.sql.execute(
      'UPDATE hub_journal SET seq = ?, epoch = ?, own_lineage = 0 WHERE id = ?',
      [seq, epoch, id],
    );
  }

  /**
   * Rule 25: the hub's version replaces this PC's. Its queued upload, if still queued, leaves the
   * queue (`ps_crud`) and the hub's version is queued instead; the server keeps the first version
   * it received and flags the other (rule 7).
   */
  async replaceEntry(entry: JournalEntry): Promise<void> {
    await this.sql.execute(
      `DELETE FROM ps_crud
       WHERE json_extract(data, '$.type') = 'commands' AND json_extract(data, '$.id') = ?`,
      [entry.id],
    );
    await this.writeRow(entry, false);
    await this.effects(entry);
  }

  async markOwnLineage(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.sql.execute('UPDATE hub_journal SET own_lineage = 1 WHERE id = ?', [id]);
    }
  }

  async markForwarded(ids: readonly string[], at: string): Promise<void> {
    for (const id of ids) {
      await this.sql.execute(
        'UPDATE hub_journal SET forwarded_at = ? WHERE id = ? AND own_lineage = 1',
        [at, id],
      );
    }
  }

  async deleteEntries(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.sql.execute('DELETE FROM hub_journal WHERE id = ?', [id]);
  }

  async touchPairing(id: string, at: string): Promise<void> {
    await this.sql.execute(
      'UPDATE hub_pairings SET last_used_at = ? WHERE id = ? AND last_used_at < ?',
      [at, id, at],
    );
  }

  async revokePairing(id: string, at: string): Promise<void> {
    await this.sql.execute(
      'UPDATE hub_pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [at, id],
    );
  }

  async touchSession(id: string, at: string): Promise<void> {
    await this.sql.execute(
      'UPDATE hub_sessions SET last_input_at = ? WHERE id = ? AND last_input_at < ?',
      [at, id, at],
    );
  }

  async endSession(id: string, at: string): Promise<void> {
    await this.sql.execute(
      'UPDATE hub_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL',
      [at, id],
    );
  }

  async recordLocalEvent(event: LocalEvent): Promise<void> {
    await this.sql.execute(
      `INSERT INTO local_events (id, action, at, membership_id, pairing_id, details, command_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        uuidv7(),
        event.action,
        event.at,
        event.membershipId ?? null,
        event.pairingId ?? null,
        JSON.stringify(event.details),
      ],
    );
  }
}

/** The hub's store on an opened, writable local database. */
export class LocalHubStore extends Reads implements HubStore {
  constructor(
    private readonly db: PowerSyncDatabase,
    private readonly deviceId: string,
  ) {
    super(db);
  }

  transaction<T>(work: (tx: HubTransaction) => Promise<T>): Promise<T> {
    return this.db.writeTransaction((tx) => work(new Transaction(tx, this.deviceId)));
  }
}
