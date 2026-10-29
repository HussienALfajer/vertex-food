import type { PowerSyncBackendConnector, PowerSyncDatabase } from '@powersync/node';
import {
  type CommandEnvelope,
  type CommandResult,
  connectivityPolicy,
  isBelowMinimumAppVersion,
  type LiveRole,
  MAX_COMMANDS_PER_UPLOAD,
  measureClockOffset,
  numberBlockDates,
  SYNC_PROTOCOL,
  timeOfDaySchema,
  type UploadedCommand,
  uploadedCommandSchema,
} from '@vertex-food/contracts';
import type { SyncState, SyncView } from './bridge.js';
import { API_BODY_BYTES, DeviceApiError, type SyncApi } from './device-client.js';
import type { Registration } from './device-store.js';
import type { OpenedDatabase } from './local-db.js';
import {
  type CertificateStore,
  certificateExpiry,
  certificateRequest,
  needsCertificate,
} from './pc-certificate.js';
import { pendingCounts } from './pending-work.js';

/** What a PC reports of its live role: the hub's (`HubRuntime.live`), the configured role without. */
export type LiveState = { liveRole: LiveRole; hubEpoch: number; standbyInSync: boolean | null };

export type SyncServiceDeps = {
  registration: Registration;
  local: OpenedDatabase;
  client: SyncApi;
  /** A call with a device token (`DeviceService.deviceCall`): a revoked PC starts its wipe. */
  deviceCall: <T>(call: (token: string) => Promise<T>) => Promise<T>;
  /** Keeps the measured offset and raises the highest time seen (`DeviceService`). */
  recordServerTime: (serverTime: Date, offsetMs: number) => void;
  clockOffsetMs: () => number | null;
  now: () => Date;
  /** Milliseconds on a monotonic clock: the round trip. */
  elapsed: () => number;
  appVersion: string;
  lanAddresses: () => string[];
  certificates: Pick<CertificateStore, 'read' | 'write'>;
  live?: () => Promise<LiveState>;
  onChange: () => void;
};

export const HEARTBEAT_MS = connectivityPolicy.heartbeatSeconds * 1000;

/** `{ "envelope": …, "mirrored": false }` and its comma around each envelope's JSON. */
const UPLOAD_ITEM_OVERHEAD = 40;

function codeOf(error: unknown): string | null {
  return error instanceof DeviceApiError ? error.code : null;
}

type ResultRow = { id: string; envelope: CommandEnvelope | null };

/**
 * The PC's sync client in the main process (spec S04 rules 7–11, 14, 17, 39, 43, 45): the
 * PowerSync connection with tokens from `GET /api/sync/token`, the upload connector to
 * `POST /api/sync/commands`, the heartbeat every 15 s with the clock offset, the PC's number blocks
 * and its LAN certificate. Uploads run one at a time, whether PowerSync or the heartbeat asks.
 */
export class SyncService {
  private state: SyncState = {
    connectivity: null,
    lastHeartbeatAt: null,
    updateRequired: false,
    protocolRefused: false,
  };
  private lastRoundTripMs: number | null = null;
  private uploading: Promise<unknown> = Promise.resolve();
  private connected = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Between `start` and `stop`: only then is PowerSync connected. */
  private running = false;
  private unlisten: (() => void) | null = null;

  constructor(private readonly deps: SyncServiceDeps) {}

  private get db(): PowerSyncDatabase | null {
    return this.deps.local.db;
  }

  status(): SyncState {
    return { ...this.state };
  }

  async view(): Promise<SyncView> {
    const counts = await pendingCounts(this.deps.local.reads).catch(() => null);
    const status = this.db?.currentStatus;
    return {
      ...this.state,
      pendingUploads: counts?.uploads ?? null,
      lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? null,
      connected: status?.connected ?? false,
    };
  }

  private update(change: Partial<SyncState>): void {
    const next = { ...this.state, ...change };
    const changed = (Object.keys(change) as (keyof SyncState)[]).some(
      (key) => next[key] !== this.state[key],
    );
    this.state = next;
    if (changed) this.deps.onChange();
  }

  /** PowerSync's side: credentials and uploads. */
  readonly connector: PowerSyncBackendConnector = {
    fetchCredentials: async () => {
      try {
        const token = await this.deps.deviceCall((deviceToken) =>
          this.deps.client.syncToken(deviceToken),
        );
        return { endpoint: token.endpoint, token: token.token };
      } catch (error) {
        // Rule 45: below the minimum version the PC stops downloading and keeps uploading.
        if (codeOf(error) === 'UPDATE_REQUIRED') {
          this.update({ updateRequired: true });
          queueMicrotask(() => void this.disconnect());
        }
        throw error;
      }
    },
    // A failure throws, so PowerSync keeps the batch and tries again after its delay.
    uploadData: async () => {
      await this.serial(() => this.uploadBatch());
    },
  };

  /** Starts the connection, the blocks and certificate, and the heartbeat every 15 s. */
  start(): void {
    this.stopped = false;
    this.running = true;
    // A checkpoint or an upload changes what the sync status shows.
    this.unlisten =
      this.db?.registerListener({ statusChanged: () => this.deps.onChange() }) ?? null;
    this.connect();
    void this.ensureBlocks(true).catch(() => undefined);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.unlisten?.();
    this.unlisten = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.disconnect();
  }

  private connect(): void {
    const db = this.db;
    if (!db || this.connected || !this.running || this.state.updateRequired) return;
    this.connected = true;
    void db.connect(this.connector, { retryDelayMs: 5000, crudUploadThrottleMs: 50 }).catch(() => {
      this.connected = false;
    });
  }

  private async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.db?.disconnect().catch(() => undefined);
  }

  /** One heartbeat: uploads, the heartbeat itself, missing blocks, the certificate. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    await this.drain().catch(() => undefined);
    if (await this.hubCapable().catch(() => false)) {
      await this.heartbeat().catch(() => undefined);
      await this.ensureBlocks(false).catch(() => undefined);
    }
    await this.ensureCertificate().catch(() => undefined);
  }

  /** Rule 17: after a role change the blocks are asked for again. */
  roleChanged(): Promise<void> {
    return this.ensureBlocks(true);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.uploading.then(task, task);
    this.uploading = next.catch(() => undefined);
    return next;
  }

  /** Uploads until the queue is empty or an upload fails. */
  drain(): Promise<void> {
    return this.serial(async () => {
      while (await this.uploadBatch()) {
        // Next batch.
      }
    });
  }

  /**
   * Rules 7–10: the next queued commands, each `{ envelope, mirrored }`: up to 100, and only as
   * many as fit the API's body limit, so a large command never holds the queue. Every answer is
   * final (`accepted`, `adjusted`, `rejected`, `quarantined`): it is kept in `command_results` and
   * the batch leaves the queue. A missing answer keeps the whole batch for the next try; the server
   * answers a known id with its stored outcome. Returns whether more is queued.
   */
  private async uploadBatch(): Promise<boolean> {
    const db = this.db;
    if (!db || this.state.protocolRefused) {
      if (this.state.protocolRefused) throw new DeviceApiError('PROTOCOL_UNSUPPORTED');
      return false;
    }
    const first = await db.getCrudBatch(MAX_COMMANDS_PER_UPLOAD);
    if (!first) return false;
    const sizes = first.crud.map(
      (op) => Buffer.byteLength(String(op.opData?.envelope ?? '')) + UPLOAD_ITEM_OVERHEAD,
    );
    let count = 0;
    let total = 0;
    while (count < sizes.length && (count === 0 || total + (sizes[count] ?? 0) <= API_BODY_BYTES)) {
      total += sizes[count] ?? 0;
      count += 1;
    }
    const batch = count < first.crud.length ? await db.getCrudBatch(count) : first;
    if (!batch) return false;
    const commands: UploadedCommand[] = [];
    const unreadable: ResultRow[] = [];
    for (const op of batch.crud) {
      if (op.table !== 'commands') continue;
      const parsed = uploadedCommandSchema.safeParse({
        envelope: parseJson(op.opData?.envelope),
        mirrored: op.opData?.mirrored === 1,
      });
      // One command larger than the API takes on its own could never upload either.
      if (parsed.success && total <= API_BODY_BYTES) commands.push(parsed.data);
      else unreadable.push({ id: op.id, envelope: parsed.success ? parsed.data.envelope : null });
    }
    let results: CommandResult[] = [];
    if (commands.length > 0) {
      try {
        ({ results } = await this.deps.deviceCall((token) =>
          this.deps.client.uploadCommands(token, { protocol: SYNC_PROTOCOL, commands }),
        ));
      } catch (error) {
        if (codeOf(error) === 'PROTOCOL_UNSUPPORTED') this.update({ protocolRefused: true });
        throw error;
      }
      const answered = new Set(results.map((result) => result.id));
      if (commands.some(({ envelope }) => !answered.has(envelope.id))) {
        throw new Error('The upload answer misses a command');
      }
    }
    await this.recordResults(db, results, commands, unreadable);
    await batch.complete();
    return batch.haveMore;
  }

  /**
   * Each command's outcome in `command_results` (rule 11). A queued row that does not parse, or one
   * command larger than the API's body limit, could never be accepted: it is recorded as rejected
   * `payload_invalid` here, for needs attention, never dropped unseen.
   */
  private async recordResults(
    db: PowerSyncDatabase,
    results: readonly CommandResult[],
    commands: readonly UploadedCommand[],
    unreadable: readonly ResultRow[],
  ): Promise<void> {
    const answeredAt = this.deps.now().toISOString();
    const envelopes = new Map(commands.map(({ envelope }) => [envelope.id, envelope]));
    const rows = [
      ...results.map((result) => ({
        id: result.id,
        envelope: envelopes.get(result.id) ?? null,
        outcome: result.outcome,
        reason: result.reason ?? null,
        details: result.details ? JSON.stringify(result.details) : null,
      })),
      ...unreadable.map((row) => ({
        ...row,
        outcome: 'rejected',
        reason: 'payload_invalid',
        details: null,
      })),
    ];
    if (rows.length === 0) return;
    await db.writeTransaction(async (tx) => {
      for (const row of rows) {
        const known = await tx.getOptional('SELECT id FROM command_results WHERE id = ?', [row.id]);
        if (known) {
          await tx.execute(
            'UPDATE command_results SET outcome = ?, reason = ?, details = ?, answered_at = ? WHERE id = ?',
            [row.outcome, row.reason, row.details, answeredAt, row.id],
          );
          continue;
        }
        const { envelope } = row;
        const actor = envelope?.actor;
        await tx.execute(
          `INSERT INTO command_results (id, name, membership_id, payload, resolved, outcome, reason,
             details, made_at, answered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            envelope?.name ?? null,
            actor?.kind === 'member' ? actor.membershipId : null,
            envelope ? JSON.stringify(envelope.payload) : null,
            envelope ? JSON.stringify(envelope.resolved) : null,
            row.outcome,
            row.reason,
            row.details,
            envelope?.deviceTime ?? null,
            answeredAt,
          ],
        );
      }
    });
  }

  /** Only the branch's hub and standby send heartbeats and hold blocks (rules 17, 38, 43). */
  private async hubCapable(): Promise<boolean> {
    const row = await this.deps.local.reads.getOptional<{ hub_role: string | null }>(
      'SELECT hub_role FROM devices WHERE id = ?',
      [this.deps.registration.deviceId],
    );
    // Before the first sync the PC does not know its role: it asks, and the server decides.
    return !row || row.hub_role !== null;
  }

  private async liveState(): Promise<LiveState> {
    if (this.deps.live) return this.deps.live();
    const row = await this.deps.local.reads.getOptional<{ hub_role: string | null }>(
      'SELECT hub_role FROM devices WHERE id = ?',
      [this.deps.registration.deviceId],
    );
    const role = row?.hub_role;
    return {
      liveRole: role === 'hub' || role === 'standby' ? role : 'client',
      hubEpoch: 0,
      standbyInSync: null,
    };
  }

  /**
   * Rules 14, 43, 45: the heartbeat with the last round trip, the pending uploads and the PC's
   * state; its answer's `serverTime` gives the clock offset (half the round trip added to the
   * send time), the branch's connectivity, the minimum app version and the protocols.
   */
  private async heartbeat(): Promise<void> {
    const live = await this.liveState();
    const { uploads } = await pendingCounts(this.deps.local.reads);
    const body = {
      lastRoundTripMs: this.lastRoundTripMs,
      pendingUploads: uploads,
      ...live,
      appVersion: this.deps.appVersion,
      protocol: SYNC_PROTOCOL,
      lanAddresses: this.deps.lanAddresses(),
      clockOffsetMs: this.deps.clockOffsetMs(),
    };
    const sentAt = this.deps.now();
    const started = this.deps.elapsed();
    const answer = await this.deps.deviceCall((token) => this.deps.client.heartbeat(token, body));
    // The round trip on the monotonic clock, so a clock changed meanwhile measures nothing wrong.
    const roundTrip = Math.max(0, Math.round(this.deps.elapsed() - started));
    this.lastRoundTripMs = Math.min(roundTrip, 600_000);
    const serverTime = new Date(answer.serverTime);
    const offset = measureClockOffset({
      sentAt,
      receivedAt: new Date(sentAt.getTime() + roundTrip),
      serverTime,
    });
    this.deps.recordServerTime(serverTime, offset);
    const updateRequired = isBelowMinimumAppVersion(this.deps.appVersion, answer.minimumAppVersion);
    this.update({
      protocolRefused: !answer.protocols.includes(SYNC_PROTOCOL),
      connectivity: answer.connectivity,
      lastHeartbeatAt: this.deps.now().toISOString(),
      updateRequired,
    });
    if (updateRequired) await this.disconnect();
    else this.connect();
  }

  /**
   * Rule 17: the blocks of the current and the next 6 business days, asked for at start, after a
   * role change, and when a heartbeat finds a day without one. A block held keeps its last number:
   * an answer never replaces it.
   */
  private async ensureBlocks(force: boolean): Promise<void> {
    const db = this.db;
    if (!db || this.state.updateRequired || !(await this.hubCapable())) return;
    if (!force && !(await this.missesADay())) return;
    const { series, blocks } = await this.deps.deviceCall((token) =>
      this.deps.client.numberBlocks(token, 'order'),
    );
    await db.writeTransaction(async (tx) => {
      for (const block of blocks) {
        const id = `${series}:${block.businessDate}`;
        if (await tx.getOptional('SELECT id FROM number_blocks_local WHERE id = ?', [id])) continue;
        await tx.execute(
          `INSERT INTO number_blocks_local (id, series, business_date, first_number, last_number,
             last_used) VALUES (?, ?, ?, ?, ?, NULL)`,
          [id, series, block.businessDate, block.first, block.last],
        );
      }
    });
  }

  private async missesADay(): Promise<boolean> {
    const branch = await this.deps.local.reads.getOptional<{ business_day_ends_at: string | null }>(
      'SELECT business_day_ends_at FROM branches WHERE id = ?',
      [this.deps.registration.branchId],
    );
    const endsAt = timeOfDaySchema.safeParse(branch?.business_day_ends_at?.slice(0, 5));
    // The branch's day is not synced yet: the server knows it.
    if (!endsAt.success) return true;
    const now = new Date(this.deps.now().getTime() + (this.deps.clockOffsetMs() ?? 0));
    const held = await this.deps.local.reads.getAll<{ business_date: string }>(
      "SELECT business_date FROM number_blocks_local WHERE series = 'order'",
    );
    const dates = new Set(held.map((row) => row.business_date));
    return numberBlockDates(now, endsAt.data).some((date) => !dates.has(date));
  }

  /** Rule 39: a certificate at registration, when the PC's addresses change, and before it ends. */
  private async ensureCertificate(): Promise<void> {
    const addresses = this.deps.lanAddresses();
    const { deviceId } = this.deps.registration;
    const current = this.deps.certificates.read();
    if (!needsCertificate(current, deviceId, addresses, this.deps.now())) return;
    const { csr, privateKey } = await certificateRequest(deviceId, addresses);
    const issued = await this.deps.deviceCall((token) =>
      this.deps.client.certificate(token, { csr, lanAddresses: addresses }),
    );
    this.deps.certificates.write({
      deviceId,
      privateKey,
      certificate: issued.certificate,
      caCertificate: issued.caCertificate,
      caFingerprint: issued.fingerprint,
      lanAddresses: addresses,
      expiresAt: certificateExpiry(issued.certificate).toISOString(),
    });
    this.deps.onChange();
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
