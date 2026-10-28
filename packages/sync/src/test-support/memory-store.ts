import type { LocalDate, NumberSeries, UploadedCommand } from '@vertex-food/contracts';
import type { LocalEvent } from '../commands/audit.js';
import type { JournalEntry, NumberUse } from '../hub/journal.js';
import type {
  HubState,
  HubStore,
  HubTransaction,
  LocalNumberBlock,
  PairingRecord,
  SessionRecord,
} from '../hub/ports.js';

// The hub's storage port in memory, for the tests: a transaction works on a copy and replaces the
// committed data only when it finishes, so a "power cut" (`crashOnNextCommit`) leaves exactly what
// was committed before, as the encrypted SQLite database with `synchronous=FULL` does.

export type StoreData = {
  state: HubState | null;
  journal: Map<string, JournalEntry>;
  blocks: Map<string, LocalNumberBlock>;
  pairings: Map<string, PairingRecord>;
  sessions: Map<string, SessionRecord>;
  pinDisabled: Set<string>;
  events: LocalEvent[];
  /** The upload queue: one row per command id. */
  uploads: Map<string, UploadedCommand>;
  /** The optimistic rows of each command, by command id. */
  rows: Map<string, { name: string; payload: unknown; resolved: unknown }>;
  /** Uploaded with an outcome back (`command_log`). */
  settled: Set<string>;
};

const blockKey = (series: NumberSeries, date: LocalDate) => `${series}/${date}`;

class View implements HubTransaction {
  constructor(
    protected readonly d: StoreData,
    private readonly deviceId: string,
  ) {}

  async loadState() {
    return this.d.state ? { ...this.d.state } : null;
  }
  async entry(id: string) {
    return this.d.journal.get(id) ?? null;
  }
  private lineage(): JournalEntry[] {
    return [...this.d.journal.values()].filter((e) => !e.ownLineage).sort((a, b) => a.seq - b.seq);
  }
  async entryAt(seq: number) {
    return this.lineage().find((e) => e.seq === seq) ?? null;
  }
  async entriesAfter(seq: number, limit?: number) {
    return this.lineage()
      .filter((e) => e.seq > seq)
      .slice(0, limit);
  }
  async ownLineage() {
    return [...this.d.journal.values()].filter((e) => e.ownLineage).sort((a, b) => a.seq - b.seq);
  }
  async oldestSeq() {
    return this.lineage()[0]?.seq ?? null;
  }
  async recentCommands(name: string, limit: number) {
    return this.lineage()
      .filter((e) => e.body.kind === 'command' && e.body.envelope.name === name)
      .reverse()
      .slice(0, limit);
  }
  async localBlock(series: NumberSeries, businessDate: LocalDate) {
    const block = this.d.blocks.get(blockKey(series, businessDate));
    return block ? { ...block } : null;
  }
  async pairings() {
    return [...this.d.pairings.values()].map((p) => ({ ...p }));
  }
  async sessions() {
    return [...this.d.sessions.values()].map((s) => ({ ...s }));
  }
  async numberTaken(use: NumberUse, exceptId: string) {
    return [...this.d.journal.values()].some(
      (e) =>
        e.id !== exceptId &&
        e.body.kind === 'command' &&
        e.body.numberUsed?.series === use.series &&
        e.body.numberUsed.businessDate === use.businessDate &&
        e.body.numberUsed.number === use.number,
    );
  }
  async pinDisabled(membershipId: string) {
    return this.d.pinDisabled.has(membershipId);
  }
  async isSettled(id: string) {
    const entry = this.d.journal.get(id);
    return entry?.body.kind !== 'command' || this.d.settled.has(id);
  }

  async saveState(state: HubState) {
    this.d.state = { ...state };
  }
  private effects(entry: JournalEntry) {
    const { body } = entry;
    switch (body.kind) {
      case 'command': {
        const { envelope, numberUsed } = body;
        this.d.rows.set(envelope.id, {
          name: envelope.name,
          payload: envelope.payload,
          resolved: envelope.resolved,
        });
        this.d.uploads.set(envelope.id, { envelope, mirrored: entry.mirrored });
        if (numberUsed && envelope.executedByDeviceId === this.deviceId) {
          const key = blockKey(numberUsed.series, numberUsed.businessDate);
          const block = this.d.blocks.get(key);
          if (block) {
            block.lastUsed = Math.max(block.lastUsed ?? 0, numberUsed.number);
          }
        }
        return;
      }
      case 'hub.pairing':
        if (!this.d.pairings.has(body.pairingId)) {
          this.d.pairings.set(body.pairingId, {
            id: body.pairingId,
            kind: body.pairingKind,
            name: body.name,
            tokenHash: body.tokenHash,
            createdAt: body.createdAt,
            lastUsedAt: body.createdAt,
            revokedAt: null,
          });
        }
        return;
      case 'hub.session':
        if (!this.d.sessions.has(body.sessionId)) {
          this.d.sessions.set(body.sessionId, {
            id: body.sessionId,
            pairingId: body.pairingId,
            membershipId: body.membershipId,
            tokenHash: body.tokenHash,
            startedAt: body.startedAt,
            lastInputAt: body.startedAt,
            endedAt: null,
          });
        }
        return;
      case 'hub.pin_disabled':
        this.d.pinDisabled.add(body.membershipId);
        return;
    }
  }
  async appendEntry(entry: JournalEntry) {
    if (this.d.journal.has(entry.id)) throw new Error(`entry ${entry.id} exists`);
    this.d.journal.set(entry.id, { ...entry });
    this.effects(entry);
  }
  async moveEntry(id: string, seq: number, epoch: number) {
    const entry = this.d.journal.get(id);
    if (!entry) throw new Error(`no entry ${id}`);
    this.d.journal.set(id, { ...entry, seq, epoch, ownLineage: false });
  }
  async replaceEntry(entry: JournalEntry) {
    this.d.rows.delete(entry.id);
    this.d.uploads.delete(entry.id);
    this.d.journal.set(entry.id, { ...entry });
    this.effects(entry);
  }
  async markOwnLineage(ids: readonly string[]) {
    for (const id of ids) {
      const entry = this.d.journal.get(id);
      if (entry) this.d.journal.set(id, { ...entry, ownLineage: true });
    }
  }
  async markForwarded(ids: readonly string[], at: string) {
    for (const id of ids) {
      const entry = this.d.journal.get(id);
      if (entry?.ownLineage) this.d.journal.set(id, { ...entry, forwardedAt: at });
    }
  }
  async deleteEntries(ids: readonly string[]) {
    for (const id of ids) this.d.journal.delete(id);
  }
  async touchPairing(id: string, at: string) {
    const pairing = this.d.pairings.get(id);
    if (pairing && at > pairing.lastUsedAt) pairing.lastUsedAt = at;
  }
  async revokePairing(id: string, at: string) {
    const pairing = this.d.pairings.get(id);
    if (pairing && pairing.revokedAt === null) pairing.revokedAt = at;
  }
  async touchSession(id: string, at: string) {
    const session = this.d.sessions.get(id);
    if (session && at > session.lastInputAt) session.lastInputAt = at;
  }
  async endSession(id: string, at: string) {
    const session = this.d.sessions.get(id);
    if (session && session.endedAt === null) session.endedAt = at;
  }
  async recordLocalEvent(event: LocalEvent) {
    this.d.events.push(event);
  }
}

function emptyData(): StoreData {
  return {
    state: null,
    journal: new Map(),
    blocks: new Map(),
    pairings: new Map(),
    sessions: new Map(),
    pinDisabled: new Set(),
    events: [],
    uploads: new Map(),
    rows: new Map(),
    settled: new Set(),
  };
}

export class MemoryHubStore extends View implements HubStore {
  /** The next transaction is lost, as if the power went just before it committed. */
  crashOnNextCommit = false;

  constructor(
    private readonly owner: string,
    private committed: StoreData = emptyData(),
  ) {
    super(committed, owner);
  }

  /** The committed data, for the tests' checks. */
  get data(): StoreData {
    return this.committed;
  }

  /** One writer at a time, as SQLite: a transaction waits for the one before it. */
  private tail: Promise<unknown> = Promise.resolve();

  transaction<T>(work: (tx: HubTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(
      () => this.run(work),
      () => this.run(work),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async run<T>(work: (tx: HubTransaction) => Promise<T>): Promise<T> {
    const copy = structuredClone(this.committed);
    const result = await work(new View(copy, this.owner));
    if (this.crashOnNextCommit) {
      this.crashOnNextCommit = false;
      throw new PowerCut();
    }
    // Replace in place: views made over the committed data keep reading it.
    Object.assign(this.committed, copy);
    return result;
  }

  addBlock(block: LocalNumberBlock): void {
    this.committed.blocks.set(blockKey(block.series, block.businessDate), { ...block });
  }

  /** Command entries of the lineage, in order: what a test compares between two PCs. */
  lineageIds(): string[] {
    return [...this.committed.journal.values()]
      .filter((e) => !e.ownLineage)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.id);
  }
}

export class PowerCut extends Error {
  constructor() {
    super('power cut before the commit');
  }
}
