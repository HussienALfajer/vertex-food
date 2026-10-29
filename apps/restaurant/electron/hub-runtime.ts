import { randomBytes, randomInt } from 'node:crypto';
import type { PowerSyncDatabase } from '@powersync/node';
import {
  type ConnectivityState,
  caDownloadUrl,
  commandEnvelopeSchema,
  type DeviceMember,
  DomainError,
  HUB_CA_HTTP_PORT,
  HUB_HTTPS_PORT,
  type HubCommand,
  type HubRefusalReason,
  hubCommandSchema,
  hubPolicy,
  type LiveRole,
  type OpenPairing,
  pairingQrUrl,
  type TimeOfDay,
  timeOfDaySchema,
} from '@vertex-food/contracts';
import {
  BranchHub,
  type BranchHubPorts,
  type CommandRegistry,
  commandRegistry,
  HubClient,
  MAX_LOCAL_EVENTS_PER_COMMAND,
  type OutboxItem,
  type OutboxStore,
  type ResolvedCheck,
} from '@vertex-food/sync';
import { ed25519Signer, ed25519Verifier } from '@vertex-food/sync/node';
import type { BranchNetworkView, BranchPc, HubView, OpenedPairing } from './bridge.js';
import type { Registration } from './device-store.js';
import {
  HUB_PC_PORT,
  HubLanServer,
  type HubServerAddress,
  type HubTls,
  lanHubClient,
  lanPeers,
} from './hub-lan.js';
import { LocalHubStore } from './hub-store.js';
import type { OpenedDatabase } from './local-db.js';
import type { PcCertificate } from './pc-certificate.js';
import { uuidv7 } from './uuid.js';

// The branch hub in the main process (spec S04 rules 5, 17, 21–39, ADR 0022, 0035): the role
// machine of the PC from its synced device row, the `BranchHub` of `packages/sync` on the ports of
// this PC (the encrypted local database, the device key and clock, the member list, the LAN), its
// HTTPS server, and the PC's own client of the hub: every command this PC makes (a network check
// from its screen, its offline audit events) goes through its outbox to whichever PC is the hub,
// itself included, so a standby and a client PC follow a failover as a phone does.

type BranchSnapshot = {
  pcs: BranchPc[];
  businessDayEndsAt: TimeOfDay;
  idleLockMinutes: number;
  /** This PC's own blocks, `series:date` → range (rule 26). */
  blocks: Map<string, { first: number; last: number }>;
};

const emptySnapshot: BranchSnapshot = {
  pcs: [],
  businessDayEndsAt: '04:00',
  idleLockMinutes: 5,
  blocks: new Map(),
};

/** How often the synced configuration is read again. */
const CONFIG_REFRESH_MS = 5000;
/** How often offline audit events go out, and the journal is pruned. */
const LOCAL_EVENTS_MS = 30_000;
const PRUNE_MS = 10 * 60_000;

export type HubRuntimeDeps = {
  registration: Pick<Registration, 'deviceId' | 'branchId' | 'privateKey'>;
  local: OpenedDatabase;
  /** The PC's identity (`DeviceService`): its members, clock, PIN check and session. */
  device: {
    members(): readonly DeviceMember[];
    clock(): { offsetMs: number | null; highestSeenTime: Date } | null;
    checkPin(membershipId: string, pin: string): Promise<'ok' | 'invalid' | 'disabled'>;
    sessionMember(): string | null;
    afterOfflineWindow(): boolean;
  };
  /** Argon2id, as the PC's own PIN check (`hash-wasm`). */
  verifyPin: (pin: string, verifier: string) => Promise<boolean>;
  certificate: () => PcCertificate | null;
  /** The branch's state from the last heartbeat (`SyncService`), null before one. */
  connectivity: () => ConnectivityState | null;
  /** This PC answered by the API recently: a standby too far behind may rejoin (rule 29). */
  online: () => boolean;
  appVersion: string;
  /** Where the hub client pages' build is, or null. */
  pagesDirectory: string | null;
  /** The LAN server's address; tests bind loopback addresses and another port. */
  listen?: HubServerAddress;
  now?: () => Date;
  /** The live role or anything a screen shows changed. */
  onChange: () => void;
  /** Rule 17: blocks are asked for again after a role change (`SyncService.roleChanged`). */
  onRoleChange: () => void;
  /** Later specs' commands; the tests add their order-like family. */
  registry?: CommandRegistry;
  rechecks?: Readonly<Record<string, ResolvedCheck>>;
};

/** What the heartbeat reports of this PC (`SyncService`'s `LiveState`). */
export type HubLiveState = {
  liveRole: LiveRole;
  hubEpoch: number;
  standbyInSync: boolean | null;
};

type Json = Record<string, unknown>;

function parseJson(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** PowerSync gives a PostgreSQL array as JSON text; an array literal `{a,b}` is read too. */
function addressList(text: string | null): string[] {
  const value = parseJson(text);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return (text ?? '')
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/\/32$/, ''))
    .filter((part) => part.length > 0);
}

async function readSnapshot(
  reads: OpenedDatabase['reads'],
  registration: HubRuntimeDeps['registration'],
  now: Date,
): Promise<BranchSnapshot> {
  const devices = await reads.getAll<{
    id: string;
    name: string | null;
    status: string | null;
    hub_role: string | null;
    public_key: string | null;
  }>('SELECT id, name, status, hub_role, public_key FROM devices');
  const certificates = await reads.getAll<{
    device_id: string;
    lan_addresses: string | null;
    expires_at: string | null;
  }>('SELECT device_id, lan_addresses, expires_at FROM device_certificates ORDER BY expires_at');
  const branch = await reads.getOptional<{
    business_day_ends_at: string | null;
    idle_lock_minutes: number | null;
  }>('SELECT business_day_ends_at, idle_lock_minutes FROM branches WHERE id = ?', [
    registration.branchId,
  ]);
  const blocks = await reads.getAll<{
    id: string;
    first_number: number;
    last_number: number;
  }>('SELECT id, first_number, last_number FROM number_blocks_local');
  const addresses = new Map<string, string[]>();
  for (const row of certificates) {
    // Ordered by expiry: the newest unexpired certificate's addresses win.
    if (row.expires_at && Date.parse(row.expires_at) > now.getTime()) {
      addresses.set(row.device_id, addressList(row.lan_addresses));
    }
  }
  const endsAt = timeOfDaySchema.safeParse(branch?.business_day_ends_at?.slice(0, 5));
  return {
    pcs: devices.map((row) => ({
      deviceId: row.id,
      name: row.name ?? '',
      active: row.status === 'active',
      hubRole: row.hub_role === 'hub' || row.hub_role === 'standby' ? row.hub_role : null,
      publicKey: row.public_key,
      addresses: addresses.get(row.id) ?? [],
    })),
    businessDayEndsAt: endsAt.success ? endsAt.data : emptySnapshot.businessDayEndsAt,
    idleLockMinutes: branch?.idle_lock_minutes ?? emptySnapshot.idleLockMinutes,
    blocks: new Map(blocks.map((b) => [b.id, { first: b.first_number, last: b.last_number }])),
  };
}

/** This PC's outbox (`local_outbox`, rule 31): its own commands until a hub answers them. */
export class LocalOutbox implements OutboxStore {
  constructor(private readonly db: PowerSyncDatabase) {}

  async list(): Promise<OutboxItem[]> {
    const rows = await this.db.getAll<{
      command: string;
      state: string;
      answer: string | null;
      created_at: string;
    }>('SELECT command, state, answer, created_at FROM local_outbox ORDER BY created_at, id');
    const items: OutboxItem[] = [];
    for (const row of rows) {
      const command = hubCommandSchema.safeParse(parseJson(row.command));
      if (!command.success) continue;
      const answer = parseJson(row.answer) as { envelope?: unknown; answeredBy?: unknown } | null;
      const envelope = commandEnvelopeSchema.safeParse(answer?.envelope);
      if (
        row.state === 'unmirrored' &&
        envelope.success &&
        typeof answer?.answeredBy === 'string'
      ) {
        items.push({
          state: 'unmirrored',
          command: command.data,
          queuedAt: row.created_at,
          envelope: envelope.data,
          answeredBy: answer.answeredBy,
        });
      } else {
        items.push({ state: 'pending', command: command.data, queuedAt: row.created_at });
      }
    }
    return items;
  }

  async put(item: OutboxItem): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO local_outbox (id, command, state, answer, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        item.command.id,
        JSON.stringify(item.command),
        item.state,
        item.state === 'unmirrored'
          ? JSON.stringify({ envelope: item.envelope, answeredBy: item.answeredBy })
          : null,
        item.queuedAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM local_outbox WHERE id = ?', [id]);
  }
}

/**
 * The PC's role machine (rules 17, 38, 42 and "Hub roles"): a PC whose synced row names it the
 * hub or the standby runs a `BranchHub` and its LAN server; one removed from its role while not
 * the live hub retires; any other active PC is a client PC. Timers live here, never in
 * `packages/sync`: the hub ticks every 0.5 s.
 */
export class HubRuntime {
  private hub: BranchHub | null = null;
  private hubKey: string | null = null;
  private client: HubClient | null = null;
  private clientKey: string | null = null;
  private snapshot: BranchSnapshot = emptySnapshot;
  private server: HubLanServer | null = null;
  private serverCertificate: string | null = null;
  private lastRole: LiveRole | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private ticking = false;
  private stopped = false;
  private serial: Promise<unknown> = Promise.resolve();
  private readonly signer: ReturnType<typeof ed25519Signer>;

  constructor(private readonly deps: HubRuntimeDeps) {
    this.signer = ed25519Signer(deps.registration.privateKey);
  }

  private get db(): PowerSyncDatabase | null {
    return this.deps.local.db;
  }

  private get deviceId(): string {
    return this.deps.registration.deviceId;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Reads the configuration, starts the hub it names, and the timers. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.refresh();
    this.timers = [
      setInterval(() => void this.tick(), hubPolicy.heartbeatMs),
      setInterval(() => void this.refresh(), CONFIG_REFRESH_MS),
      setInterval(() => void this.sendLocalEvents(), LOCAL_EVENTS_MS),
      setInterval(() => void this.hub?.pruneJournal().catch(() => undefined), PRUNE_MS),
    ];
  }

  /** Stops the timers and the LAN server (a revoked PC before its wipe, the app quitting). */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.run(async () => {
      await this.hub?.stop();
      await this.server?.stop();
      this.server = null;
      this.serverCertificate = null;
      this.hub = null;
      this.hubKey = null;
      this.client = null;
      this.clientKey = null;
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.serial.then(task, task);
    this.serial = next.catch(() => undefined);
    return next;
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.hub?.tick();
      await this.flushOutbox();
    } catch {
      // A tick that failed (a peer that went away mid-call) runs again in 0.5 s.
    } finally {
      this.ticking = false;
    }
    this.noticeRole();
  }

  /** The live role changed: the blocks are asked for again and the screens read it. */
  private noticeRole(): void {
    const role = this.hub?.liveRole() ?? null;
    if (role === this.lastRole) return;
    this.lastRole = role;
    this.deps.onRoleChange();
    this.deps.onChange();
  }

  /** Reads the synced configuration and follows it (rules 38, 42). */
  refresh(): Promise<void> {
    return this.run(async () => {
      if (this.stopped) return;
      this.snapshot = await readSnapshot(this.deps.local.reads, this.deps.registration, this.now());
      await this.follow();
      // A pairing or PC revoked since its live stream opened loses it (rules 34, 42).
      await this.server?.recheckLive().catch(() => undefined);
      if (this.deps.online()) await this.hub?.rejoinAfterServerSync().catch(() => undefined);
      this.noticeRole();
    });
  }

  private self(): BranchPc | null {
    return this.snapshot.pcs.find((pc) => pc.deviceId === this.deviceId) ?? null;
  }

  private hubPcs(): BranchPc[] {
    return this.snapshot.pcs.filter((pc) => pc.active && pc.hubRole !== null);
  }

  private tls(): HubTls | null {
    const certificate = this.deps.certificate();
    if (!certificate || certificate.deviceId !== this.deviceId) return null;
    return {
      key: certificate.privateKey,
      cert: certificate.certificate,
      ca: certificate.caCertificate,
    };
  }

  private async follow(): Promise<void> {
    const self = this.self();
    const db = this.db;
    // Before the first sync, on a revoked PC (its wipe follows), or read-only: no hub here.
    if (!self?.active || !db) {
      await this.dropHub(false);
      return;
    }
    if (self.hubRole) await this.ensureHub(db, self.hubRole);
    else await this.dropHub(true);
    await this.ensureServer();
    this.ensureClient(db);
  }

  /** The hub-capable PCs' addresses, in a stable order, read when a phone pairs (rule 30). */
  private peerAddresses(): string[] {
    return this.hubPcs()
      .flatMap((pc) => pc.addresses)
      .sort();
  }

  /**
   * Runs the hub of this PC's role and peer. A change of either builds a new instance, only after
   * the old one stopped (`BranchHub.stop`): two instances on one journal would be two writers.
   * An address change rebuilds nothing; the hub reads them as it needs them.
   */
  private async ensureHub(db: PowerSyncDatabase, role: 'hub' | 'standby'): Promise<void> {
    const peers = this.hubPcs().filter((pc) => pc.deviceId !== this.deviceId);
    const config = {
      deviceId: this.deviceId,
      configuredRole: role,
      peerDeviceIds: peers.map((pc) => pc.deviceId).sort(),
      appVersion: this.deps.appVersion,
    };
    const key = JSON.stringify(config);
    if (this.hub && key === this.hubKey) return;
    const old = this.hub;
    this.hub = null;
    this.hubKey = null;
    this.server?.closeLiveStreams();
    await old?.stop();
    const store = new LocalHubStore(db, this.deviceId);
    // A PC given a role again after it retired (rule 38) follows the hub as a standby.
    const saved = await store.loadState();
    if (saved?.role === 'none') {
      await store.transaction((tx) =>
        tx.saveState({
          ...saved,
          role: 'standby',
          hubDeviceId: null,
          rejoining: false,
          notice: null,
        }),
      );
    }
    const hub = new BranchHub(
      { ...config, peerAddresses: () => this.peerAddresses() },
      this.ports(store),
    );
    await hub.start();
    hub.onChange(() => this.deps.onChange());
    this.hub = hub;
    this.hubKey = key;
    this.deps.onChange();
  }

  /**
   * The PC lost its role online (rule 38) or was revoked: it retires unless it is the live hub,
   * which the server refuses to remove until the standby is promoted (`HUB_ROLE_ACTIVE`).
   */
  private async dropHub(retire: boolean): Promise<void> {
    const hub = this.hub;
    if (!hub) return;
    if (retire && hub.liveRole() === 'hub') return;
    if (retire) await hub.retire().catch(() => undefined);
    await hub.stop();
    this.hub = null;
    this.hubKey = null;
    await this.server?.stop();
    this.server = null;
    this.serverCertificate = null;
    this.deps.onChange();
  }

  /** The LAN server runs on a hub-capable PC with a certificate; a new one replaces the old. */
  private async ensureServer(): Promise<void> {
    const tls = this.tls();
    if (!this.hub || !tls) return;
    if (this.server) {
      if (this.serverCertificate !== tls.cert) {
        this.server.updateTls(tls);
        this.serverCertificate = tls.cert;
      }
      return;
    }
    const server = new HubLanServer({
      hub: () => this.hub,
      isActivePc: (deviceId) =>
        this.snapshot.pcs.some((pc) => pc.deviceId === deviceId && pc.active),
      isPeer: (deviceId) =>
        deviceId !== this.deviceId && this.hubPcs().some((pc) => pc.deviceId === deviceId),
      peerOrigins: () => this.hubPcs().flatMap((pc) => pc.addresses.map((a) => this.origin(a))),
      caCertificate: () => this.deps.certificate()?.caCertificate ?? null,
      pagesDirectory: this.deps.pagesDirectory,
    });
    try {
      await server.start(tls, this.listenAddress());
    } catch {
      // The port is taken (another copy of the app, a firewall): tried again at the next refresh.
      return;
    }
    this.server = server;
    this.serverCertificate = tls.cert;
  }

  private listenAddress(): HubServerAddress {
    return (
      this.deps.listen ?? {
        host: '0.0.0.0',
        port: HUB_HTTPS_PORT,
        pcPort: HUB_PC_PORT,
        caPort: HUB_CA_HTTP_PORT,
      }
    );
  }

  private origin(address: string): string {
    return `https://${address}:${this.listenAddress().port}`;
  }

  /** The PC's own client of the hub, at the addresses of the branch's hub-capable PCs (rule 30). */
  private ensureClient(db: PowerSyncDatabase): void {
    const peers = this.hubPcs().flatMap((pc) => pc.addresses);
    const key = JSON.stringify(peers);
    if (this.client && key === this.clientKey) return;
    const transport = lanHubClient({
      tls: () => this.tls(),
      port: this.listenAddress().pcPort,
      deviceId: this.deviceId,
      ownAddresses: () => this.self()?.addresses ?? [],
      ownHub: () => this.hub,
      isHubPc: (deviceId) => this.hubPcs().some((pc) => pc.deviceId === deviceId),
    });
    this.client = new HubClient({
      peers,
      transport,
      store: new LocalOutbox(db),
      now: () => this.now(),
      onRefused: (command, reason) => this.recordRefusal(db, command, reason),
    });
    this.clientKey = key;
  }

  private ports(store: LocalHubStore): BranchHubPorts {
    const { device } = this.deps;
    const members = () => device.members();
    return {
      store,
      clock: {
        now: () => this.now(),
        offsetMs: () => device.clock()?.offsetMs ?? 0,
        highestSeenTime: () => device.clock()?.highestSeenTime ?? this.now(),
      },
      random: {
        id: () => uuidv7(),
        token: () => randomBytes(32).toString('base64url'),
        pairingCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
      },
      members: {
        members,
        member: (id) => members().find((m) => m.membershipId === id) ?? null,
        verifyPin: (verifier, pin) => this.deps.verifyPin(pin, verifier),
        checkPcPin: (id, pin) => device.checkPin(id, pin),
      },
      branch: {
        businessDayEndsAt: () => this.snapshot.businessDayEndsAt,
        idleLockMinutes: () => this.snapshot.idleLockMinutes,
        connectivity: () => this.deps.connectivity() ?? 'offline',
        afterOfflineWindow: () => device.afterOfflineWindow(),
        // Only this PC's own blocks are on it; another PC's number is resolved again (rule 26).
        numberBlockOf: (deviceId, series, businessDate) =>
          deviceId === this.deviceId
            ? (this.snapshot.blocks.get(`${series}:${businessDate}`) ?? null)
            : null,
        verifierOf: (deviceId) => {
          const pc = this.hubPcs().find((p) => p.deviceId === deviceId);
          return pc?.publicKey ? ed25519Verifier(pc.publicKey) : null;
        },
        caFingerprint: () => this.deps.certificate()?.caFingerprint ?? '',
        // Spec S05 rule 24: the local `branch_entitlements` row arrives with S05's PR 3. Until then
        // no command of this release has a feature, and one that had would be refused.
        featureEntitled: () => false,
      },
      peers: lanPeers({
        tls: () => this.tls(),
        port: this.listenAddress().pcPort,
        addressesOf: (deviceId) =>
          this.snapshot.pcs.find((pc) => pc.deviceId === deviceId)?.addresses ?? [],
      }),
      sign: this.signer,
      registry: this.deps.registry ?? commandRegistry,
      ...(this.deps.rechecks ? { rechecks: this.deps.rechecks } : {}),
    };
  }

  // --- The PC's own commands ---------------------------------------------------------------------

  /**
   * A hub refused one of this PC's commands before journaling it (rule 6): its `command_results`
   * row says so with the reason, for needs attention, and it leaves the outbox in the same
   * transaction (rule 31), so a cut never sends it again. The audit events a refused
   * `audit.record_local_events` carried wait for the next one.
   */
  private async recordRefusal(
    db: PowerSyncDatabase,
    command: HubCommand,
    reason: HubRefusalReason,
  ): Promise<void> {
    const now = this.now().toISOString();
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT OR REPLACE INTO command_results (id, name, membership_id, payload, resolved,
           outcome, reason, details, made_at, answered_at)
         VALUES (?, ?, ?, ?, NULL, 'refused', ?, NULL, ?, ?)`,
        [
          command.id,
          command.name,
          command.actor?.kind === 'member' ? command.actor.membershipId : null,
          JSON.stringify(command.payload),
          reason,
          command.deviceTime,
          now,
        ],
      );
      await tx.execute('UPDATE local_events SET command_id = NULL WHERE command_id = ?', [
        command.id,
      ]);
      await tx.execute('DELETE FROM local_outbox WHERE id = ?', [command.id]);
    });
    this.deps.onChange();
  }

  /**
   * Sends what waits in the outbox, at most once per tick. A version this PC answered itself
   * without a standby copy is in its own journal, which its rejoin forwards: it leaves the outbox.
   */
  private async flushOutbox(): Promise<void> {
    const client = this.client;
    const db = this.db;
    if (!client || !db) return;
    const counts = await client.counts();
    if (counts.sending === 0 && counts.unmirrored === 0) return;
    await client.flush();
    await db.execute(
      `DELETE FROM local_outbox WHERE state = 'unmirrored'
         AND json_extract(answer, '$.answeredBy') = ?`,
      [this.deviceId],
    );
  }

  /**
   * Offline audit events (spec S04 "Audit"): up to 200 at a time become one
   * `audit.record_local_events` command, made in the same transaction that marks them, and
   * re-sent with the same id until a hub answers; then they leave `local_events`.
   */
  async sendLocalEvents(): Promise<void> {
    const db = this.db;
    if (!db || !this.client) return;
    await db.writeTransaction(async (tx) => {
      const sent = await tx.getAll<{ command_id: string }>(
        `SELECT DISTINCT e.command_id FROM local_events e
         WHERE e.command_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM local_outbox o WHERE o.id = e.command_id AND o.state = 'pending')`,
      );
      for (const row of sent) {
        await tx.execute('DELETE FROM local_events WHERE command_id = ?', [row.command_id]);
      }
      const waiting = await tx.getOptional(
        'SELECT id FROM local_events WHERE command_id IS NOT NULL LIMIT 1',
      );
      if (waiting) return;
      const events = await tx.getAll<{
        id: string;
        action: string;
        at: string;
        membership_id: string | null;
        pairing_id: string | null;
        details: string | null;
      }>('SELECT * FROM local_events WHERE command_id IS NULL ORDER BY at, id LIMIT ?', [
        MAX_LOCAL_EVENTS_PER_COMMAND,
      ]);
      if (events.length === 0) return;
      const now = this.now().toISOString();
      const command: HubCommand = {
        id: uuidv7(),
        name: 'audit.record_local_events',
        version: 1,
        payload: {
          events: events.map((event) => ({
            action: event.action,
            at: event.at,
            ...(event.membership_id ? { membershipId: event.membership_id } : {}),
            ...(event.pairing_id ? { pairingId: event.pairing_id } : {}),
            details: (parseJson(event.details) as Json | null) ?? {},
          })),
        },
        deviceTime: now,
        actor: { kind: 'device' },
      };
      for (const event of events) {
        await tx.execute('UPDATE local_events SET command_id = ? WHERE id = ?', [
          command.id,
          event.id,
        ]);
      }
      await tx.execute(
        `INSERT INTO local_outbox (id, command, state, answer, created_at)
         VALUES (?, ?, 'pending', NULL, ?)`,
        [command.id, JSON.stringify(command), now],
      );
    });
    await this.client.flush();
  }

  // --- What the bridge asks ----------------------------------------------------------------------

  /** Rule 43: the live state the heartbeat reports. */
  live(): HubLiveState {
    const hub = this.hub;
    if (!hub) return { liveRole: 'client', hubEpoch: 0, standbyInSync: null };
    const status = hub.status();
    return {
      liveRole: status.role,
      hubEpoch: status.epoch,
      standbyInSync:
        status.role === 'hub' && status.standby !== 'none' ? status.standby === 'in_sync' : null,
    };
  }

  async view(currentAddresses: readonly string[]): Promise<HubView> {
    const certified = this.deps.certificate()?.lanAddresses ?? [];
    return {
      status: this.hub?.status() ?? null,
      configuredRole: this.self()?.hubRole ?? null,
      addressChanged: currentAddresses.some((address) => !certified.includes(address)),
      pairingOpen: this.hub?.pairing.isOpen() ?? false,
      outbox: (await this.client?.counts()) ?? { sending: 0, unmirrored: 0 },
    };
  }

  async network(): Promise<BranchNetworkView> {
    const snapshot = this.hub ? await this.hub.liveSnapshot() : null;
    return {
      pcs: this.snapshot.pcs.map((pc) => ({ ...pc, self: pc.deviceId === this.deviceId })),
      pairings: snapshot?.clients ?? [],
      networkChecks: snapshot?.networkChecks ?? [],
    };
  }

  private requireHub(): BranchHub {
    if (!this.hub) throw new DomainError('NOT_HUB', 'This PC is not hub-capable');
    return this.hub;
  }

  /** The member of this PC's PIN session, who must hold `hub.manage` (rules 33, 34, 36). */
  private manager(): string {
    const membershipId = this.deps.device.sessionMember();
    const member = this.deps.device.members().find((m) => m.membershipId === membershipId);
    if (!membershipId || !member?.permissions.includes('hub.manage')) {
      throw new DomainError('FORBIDDEN', 'Needs a PIN session with hub.manage');
    }
    return membershipId;
  }

  /** Rule 33: opens pairing on the active hub for 2 minutes, with the QR data of rule 37. */
  async openPairing(input: OpenPairing): Promise<OpenedPairing> {
    const hub = this.requireHub();
    const { code, closesAt } = await hub.pairing.open(input, this.manager());
    const address = this.self()?.addresses[0];
    const caFingerprint = this.deps.certificate()?.caFingerprint ?? '';
    if (!address) throw new DomainError('CERTIFICATE_ADDRESS_INVALID', 'No certified address');
    return {
      code,
      closesAt: closesAt.toISOString(),
      caFingerprint,
      pairingUrl: pairingQrUrl({
        hubAddress: address,
        peers: this.hubPcs().flatMap((pc) => pc.addresses),
        caFingerprint,
        code,
      }),
      caUrl: caDownloadUrl(address),
    };
  }

  closePairing(): void {
    this.hub?.pairing.close();
    this.deps.onChange();
  }

  /** Rule 34: on either hub-capable PC, offline too. */
  async revokePairing(pairingId: string): Promise<void> {
    await this.requireHub().pairing.revoke(pairingId, this.manager());
  }

  promotionPreview(): { missing: number; rejoining: boolean } {
    return this.requireHub().promotionPreview();
  }

  /** Rule 27: "make this PC the hub" on the standby, by a PIN of a member with `hub.manage`. */
  async promote(input: { membershipId: string; pin: string; acknowledgedMissing: number }) {
    await this.requireHub().promoteManually(input);
    this.noticeRole();
  }

  /** A network check from this PC's screen, as its session's member (rule 36). */
  async sendNetworkCheck(input: { run: string; sequence: number }): Promise<string> {
    const client = this.client;
    if (!client) throw new DomainError('NOT_HUB', 'No hub is known yet');
    const membershipId = this.manager();
    const now = this.now().toISOString();
    const command: HubCommand = {
      id: uuidv7(),
      name: 'sync.network_check',
      version: 1,
      payload: { sentAt: now, sequence: input.sequence, run: input.run },
      deviceTime: now,
      actor: { kind: 'member', membershipId, sessionKind: 'pc' },
      ...(this.deps.device.afterOfflineWindow() ? { afterOfflineWindow: true } : {}),
    };
    await client.send(command);
    this.deps.onChange();
    return command.id;
  }
}
