import {
  addDays,
  businessDateOf,
  type CommandEnvelope,
  correctedTime,
  DomainError,
  HUB_PROTOCOL,
  type HubCommand,
  type HubCommandAnswer,
  type HubHello,
  type HubLiveSnapshot,
  type HubRole,
  hubPolicy,
  type LiveRole,
  type NetworkCheckRecord,
  negotiateHubProtocol,
  SYNC_PROTOCOL,
} from '@vertex-food/contracts';
import { canonicalJson } from '../canonical.js';
import type { LocalEvent } from '../commands/audit.js';
import { networkCheckPayloadSchema, networkCheckResolvedSchema } from '../commands/sync.js';
import { checkEnvelope, type SignMessage, signEnvelope } from '../envelope.js';
import type { CommandDefinition, CommandRegistry } from '../registry.js';
import { type AccessDecision, type CommandSource, checkLocalAccess } from './access.js';
import {
  type CommandBody,
  type EntryRef,
  entryHash,
  type JournalBody,
  type JournalEntry,
  refOf,
  sameRef,
  toWire,
  type WireEntry,
} from './journal.js';
import { WriterLock } from './lock.js';
import { type HubResolveContext, inBlock, prepareNumbering } from './numbering.js';
import { PairingDesk } from './pairing.js';
import type {
  ForwardAnswer,
  ForwardRequest,
  HeartbeatAnswer,
  HeartbeatRequest,
  JournalAnswer,
  JournalRequest,
  MirrorAnswer,
  MirrorRequest,
  PeerHandlers,
  PeerStateAnswer,
  PeerStateRequest,
  PeerStatus,
  PeerTransport,
} from './peer.js';
import { outranks } from './peer.js';
import type {
  BranchData,
  HubClock,
  HubRandom,
  HubState,
  HubStore,
  HubTransaction,
  MemberDirectory,
  PairingRecord,
} from './ports.js';

// The branch hub (spec S04 rules 5, 6, 18–29, ADR 0022, 0035), adapted from Spike A's tested PC
// (`spikes/restaurant-hub/pc/pc.mjs`). One instance runs on each hub-capable PC. The active hub
// runs every command of the branch one at a time under its writer lock: validate, check access
// locally, resolve, journal, mirror to the standby first, then commit and answer. The standby
// applies the same entries in the same order after checking the previous one, and promotes itself
// when the hub falls silent and it holds everything the hub reported. Epochs settle every
// disagreement; a PC that meets a higher epoch demotes itself, catches up and forwards what it
// took alone. Timers belong to the runtime: it calls `tick()` every `hubPolicy.heartbeatMs`.

/** How long a catch-up or a forward may take on the LAN. */
const CATCH_UP_TIMEOUT_MS = 5000;
const FORWARD_BATCH = 500;
const NETWORK_CHECKS_SHOWN = 20;
const RETENTION_BUSINESS_DAYS = hubPolicy.journalRetentionBusinessDays;

/** A command-specific re-check of a re-sent or forwarded version (rule 26), by command name. */
export type ResolvedCheck = (envelope: CommandEnvelope, context: RecheckContext) => boolean;

export interface RecheckContext {
  now: Date;
  /** Whether a number lies in that PC's block of the date (rule 26). */
  numberInBlock(deviceId: string, businessDate: string, number: number): boolean;
}

export type BranchHubConfig = {
  deviceId: string;
  /** Chosen online (rule 38); decides the first start only. */
  configuredRole: HubRole;
  /** The other hub-capable PC of the branch (at most one in V1). */
  peerDeviceIds: readonly string[];
  /** The LAN addresses of both hub-capable PCs, for hub clients (rule 30). */
  peerAddresses: readonly string[];
  appVersion: string;
  /** This PC's LAN protocol; a test sets another to check a mismatch (edge case 11). */
  protocol?: number;
};

export type BranchHubPorts = {
  store: HubStore;
  clock: HubClock;
  random: HubRandom;
  members: MemberDirectory;
  branch: BranchData;
  peers: PeerTransport;
  /** Signs with this PC's device key (rule 4). */
  sign: SignMessage;
  registry: CommandRegistry;
  /** Checks of later specs' commands (prices in force, the lines of an order). */
  rechecks?: Readonly<Record<string, ResolvedCheck>>;
};

/** What a PC knows of a peer from its last answer. */
type PeerView = {
  reachable: boolean;
  /** Its LAN protocol is within one version of this PC's. */
  compatible: boolean;
  status: PeerStatus | null;
  /** It held every entry of this hub at its last answer. */
  inSync: boolean;
};

export type HubStatus = {
  role: LiveRole;
  epoch: number;
  appliedSeq: number;
  hubDeviceId: string | null;
  rejoining: boolean;
  notice: HubState['notice'];
  standby: 'in_sync' | 'not_in_sync' | 'none';
  /** Entries the hub reported that this PC lacks: named by the manual promotion's warning. */
  missing: number;
};

class NotHub extends Error {
  constructor(readonly status: PeerStatus | null) {
    super('not the hub');
  }
}

function timing(envelope: CommandEnvelope) {
  return {
    deviceTime: envelope.deviceTime,
    clockOffsetMs: envelope.clockOffsetMs,
    highestSeenTime: envelope.highestSeenTime,
    afterOfflineWindow: envelope.afterOfflineWindow,
  };
}

type Timing = ReturnType<typeof timing>;

/** The source a forwarded or re-checked envelope came from, for the local access check. */
function sourceOf(envelope: CommandEnvelope): CommandSource {
  if (envelope.actor.kind === 'station') {
    return { kind: 'station', pairingId: envelope.actor.pairingId };
  }
  if (envelope.originKind === 'hub_client') {
    return {
      kind: 'personal',
      pairingId: envelope.originDeviceId,
      membershipId: envelope.actor.kind === 'member' ? envelope.actor.membershipId : null,
    };
  }
  return { kind: 'pc', deviceId: envelope.originDeviceId };
}

export class BranchHub implements PeerHandlers {
  readonly pairing: PairingDesk;
  private state: HubState;
  private readonly lock = new WriterLock();
  private readonly views = new Map<string, PeerView>();
  private readonly listeners = new Set<() => void>();
  private readonly protocol: number;
  private lastHeartbeatMs = 0;
  private liveClients = 0;
  private started = false;
  private rejoinInFlight = false;
  private rejoinFailures = 0;

  constructor(
    private readonly config: BranchHubConfig,
    private readonly ports: BranchHubPorts,
  ) {
    this.protocol = config.protocol ?? HUB_PROTOCOL;
    this.state = {
      role: config.configuredRole,
      epoch: config.configuredRole === 'hub' ? 1 : 0,
      appliedSeq: 0,
      hubDeviceId: config.configuredRole === 'hub' ? config.deviceId : null,
      rejoining: false,
      hubSeq: 0,
      lastHeartbeatAt: null,
      notice: null,
    };
    this.pairing = new PairingDesk({
      store: ports.store,
      clock: ports.clock,
      random: ports.random,
      members: ports.members,
      branch: ports.branch,
      peerAddresses: () => config.peerAddresses,
      isHub: () => this.isServing(),
      appendLocal: (body) => this.appendLocal(body),
      changed: () => this.changed(),
    });
  }

  // --- Start and timers ------------------------------------------------------------------------

  /**
   * Loads the saved state, or takes the configured role on the first start, then asks the peers
   * before serving (rule 23): a higher epoch demotes this PC, and a restarted hub takes back the
   * entries its standby holds that it never committed.
   */
  async start(): Promise<void> {
    const saved = await this.ports.store.loadState();
    if (saved) this.state = saved;
    else await this.ports.store.transaction((tx) => tx.saveState(this.state));
    // The silence before an automatic promotion counts from the start.
    this.lastHeartbeatMs = this.nowMs();
    for (const peerId of this.config.peerDeviceIds) {
      let status: PeerStatus;
      try {
        const answer = await this.ports
          .peers(peerId)
          .state(this.request(), hubPolicy.mirrorTimeoutMs);
        if (answer.result !== 'ok') {
          this.views.set(peerId, {
            reachable: true,
            compatible: false,
            status: null,
            inSync: false,
          });
          continue;
        }
        status = answer.status;
      } catch {
        continue;
      }
      this.see(peerId, status);
      if (status.role === 'hub' && (this.state.role !== 'hub' || outranks(status, this.me()))) {
        await this.demote(status).catch(() => undefined);
      } else if (
        this.state.role === 'hub' &&
        status.role === 'standby' &&
        status.epoch === this.state.epoch &&
        status.appliedSeq > this.state.appliedSeq
      ) {
        await this.lock.run(() => this.recoverFromStandby(peerId)).catch(() => undefined);
      }
    }
    this.started = true;
    if (this.state.rejoining && this.state.hubDeviceId) this.resumeRejoin(this.state.hubDeviceId);
    this.changed();
  }

  /** Called by the runtime every `hubPolicy.heartbeatMs`: heartbeats on the hub, the watchdog on the standby. */
  async tick(): Promise<void> {
    if (!this.started) return;
    if (this.state.role === 'hub') await this.sendHeartbeats();
    else if (this.state.role === 'standby') await this.watchdog();
  }

  // --- Reading ---------------------------------------------------------------------------------

  liveRole(): LiveRole {
    if (this.state.role === 'none') return 'client';
    return this.state.rejoining ? 'rejoining' : this.state.role;
  }

  status(): HubStatus {
    return {
      role: this.liveRole(),
      epoch: this.state.epoch,
      appliedSeq: this.state.appliedSeq,
      hubDeviceId: this.state.hubDeviceId,
      rejoining: this.state.rejoining,
      notice: this.state.notice,
      standby: this.standbyState(),
      missing: Math.max(0, this.state.hubSeq - this.state.appliedSeq),
    };
  }

  /** `GET /hub/hello` (rule 30). */
  hello(): HubHello {
    return {
      deviceId: this.config.deviceId,
      role: this.liveRole(),
      epoch: this.state.epoch,
      protocol: this.protocol,
      appVersion: this.config.appVersion,
    };
  }

  /** `GET /hub/live` (rule 32): the full snapshot, sent again on every change. */
  async liveSnapshot(): Promise<HubLiveSnapshot> {
    const checks = await this.ports.store.recentCommands(
      'sync.network_check',
      NETWORK_CHECKS_SHOWN,
    );
    const networkChecks: NetworkCheckRecord[] = [];
    for (const entry of checks) {
      if (entry.body.kind !== 'command') continue;
      const { envelope } = entry.body;
      const payload = networkCheckPayloadSchema.safeParse(envelope.payload);
      const resolved = networkCheckResolvedSchema.safeParse(envelope.resolved);
      if (!payload.success || !resolved.success) continue;
      networkChecks.push({
        commandId: envelope.id,
        run: payload.data.run,
        sequence: payload.data.sequence,
        originDeviceId: envelope.originDeviceId,
        sentAt: payload.data.sentAt,
        receivedAt: resolved.data.receivedAt,
        mirroredAt: entry.mirroredAt,
        committedAt: entry.committedAt,
      });
    }
    return {
      hub: {
        deviceId: this.config.deviceId,
        role: this.liveRole(),
        epoch: this.state.epoch,
        standby: this.standbyState(),
        connectivity: this.ports.branch.connectivity(),
      },
      clients: await this.pairing.list(),
      networkChecks,
    };
  }

  /** Called after every change a live snapshot shows; answers the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hub clients on the live stream: the equal-epoch tie-break counts them (rule 28). */
  setLiveClients(count: number): void {
    this.liveClients = count;
  }

  // --- Commands (rules 5, 6, 26, 31) -------------------------------------------------------------

  /** The source of a hub client's command: its pairing and the member of its PIN session. */
  async sourceOfPairing(
    pairing: PairingRecord,
    sessionToken: string | null,
  ): Promise<CommandSource> {
    if (pairing.kind === 'station') return { kind: 'station', pairingId: pairing.id };
    const session = sessionToken ? await this.pairing.session(pairing, sessionToken) : null;
    return { kind: 'personal', pairingId: pairing.id, membershipId: session?.membershipId ?? null };
  }

  /**
   * `POST /hub/commands`: one command, under the writer lock. A command already in the journal is
   * answered `duplicate` with its stored answer; one the hub cannot run is `refused` before
   * anything is written.
   */
  submit(command: HubCommand, source: CommandSource): Promise<HubCommandAnswer> {
    return this.lock.run(async () => {
      if (!this.isServing()) return this.notHubAnswer();
      const existing = await this.ports.store.entry(command.id);
      if (existing) return this.duplicateAnswer(existing);
      const lookup = this.ports.registry.lookup(command.name, command.version);
      if (!lookup.ok) return { status: 'refused', reason: lookup.reason };
      const { definition } = lookup;
      const payload = definition.payload.safeParse(command.payload);
      if (!payload.success) return { status: 'refused', reason: 'payload_invalid' };
      const decision = checkLocalAccess({
        access: definition.access,
        source,
        command,
        member: (id) => this.ports.members.member(id),
      });
      if (!decision.ok) return { status: 'refused', reason: decision.reason };
      try {
        // A version another hub resolved and answered `mirrored: false`, re-sent after a
        // failover: applied as it is when every check passes, never resolved again (rule 31).
        if (command.resent && this.resentMatches(command.resent, command, payload.data, decision)) {
          if (this.recheck(command.resent, definition)) {
            const entry = await this.commitNew(
              { kind: 'command', envelope: command.resent, numberUsed: null },
              command.id,
            );
            return this.okAnswer(entry);
          }
        }
        const now = this.ports.clock.now();
        const entry = await this.resolveAndCommit(definition, command.id, payload.data, decision, {
          deviceTime: now.toISOString(),
          clockOffsetMs: this.ports.clock.offsetMs(),
          highestSeenTime: this.ports.clock.highestSeenTime().toISOString(),
          afterOfflineWindow:
            source.kind === 'pc'
              ? (command.afterOfflineWindow ?? this.ports.branch.afterOfflineWindow())
              : this.ports.branch.afterOfflineWindow(),
        });
        if (!entry) return { status: 'refused', reason: 'payload_invalid' };
        return this.okAnswer(entry);
      } catch (error) {
        if (error instanceof NotHub) return this.notHubAnswer(error.status);
        throw error;
      }
    });
  }

  private resentMatches(
    resent: CommandEnvelope,
    command: HubCommand,
    payload: unknown,
    decision: Extract<AccessDecision, { ok: true }>,
  ): boolean {
    try {
      return (
        resent.id === command.id &&
        resent.name === command.name &&
        resent.version === command.version &&
        canonicalJson(resent.payload) === canonicalJson(payload) &&
        canonicalJson(resent.actor) === canonicalJson(decision.actor) &&
        resent.originKind === decision.originKind &&
        resent.originDeviceId === decision.originDeviceId &&
        (resent.approvedByMembershipId ?? null) === decision.approvedByMembershipId
      );
    } catch {
      return false;
    }
  }

  /**
   * Rule 26: a version made elsewhere is applied only with the signature of a hub-capable PC of
   * the branch, a resolved version of the command's shape, and the command's own checks of it
   * against this hub's data.
   */
  private recheck(envelope: CommandEnvelope, definition: CommandDefinition): boolean {
    const executor = envelope.executedByDeviceId;
    if (executor !== this.config.deviceId && !this.config.peerDeviceIds.includes(executor)) {
      return false;
    }
    const verify = this.ports.branch.verifierOf(executor);
    if (!verify || !checkEnvelope(envelope, verify).ok) return false;
    if (!definition.resolved.safeParse(envelope.resolved).success) return false;
    const check = this.ports.rechecks?.[envelope.name];
    if (!check) return true;
    return check(envelope, {
      now: this.ports.clock.now(),
      numberInBlock: (deviceId, businessDate, number) =>
        inBlock(this.ports.branch.numberBlockOf(deviceId, 'order', businessDate), number),
    });
  }

  /** Resolves a command on this hub and commits it; null when its resolved version cannot be signed. */
  private async resolveAndCommit(
    definition: CommandDefinition,
    id: string,
    payload: unknown,
    decision: Extract<AccessDecision, { ok: true }>,
    time: Timing,
    except?: string,
  ): Promise<JournalEntry | null> {
    const now = this.ports.clock.now();
    const businessDate = businessDateOf(
      correctedTime(new Date(time.deviceTime), time.clockOffsetMs),
      this.ports.branch.businessDayEndsAt(),
    );
    const numbering = prepareNumbering({
      commandId: id,
      businessDate,
      block: await this.ports.store.localBlock('order', businessDate),
    });
    const context: HubResolveContext = {
      now,
      executedByDeviceId: this.config.deviceId,
      businessDate,
      takeNumber: numbering.take,
    };
    const resolved = definition.resolved.safeParse(definition.resolve(payload, context));
    if (!resolved.success) return null;
    let envelope: CommandEnvelope;
    try {
      envelope = signEnvelope(
        {
          id,
          name: definition.name,
          version: definition.version,
          protocol: SYNC_PROTOCOL,
          originKind: decision.originKind,
          originDeviceId: decision.originDeviceId,
          executedByDeviceId: this.config.deviceId,
          actor: decision.actor,
          ...(decision.approvedByMembershipId
            ? { approvedByMembershipId: decision.approvedByMembershipId }
            : {}),
          ...time,
          hubEpoch: this.state.epoch,
          hubSeq: this.state.appliedSeq + 1,
          payload: payload as Record<string, unknown>,
          resolved: resolved.data as Record<string, unknown>,
        },
        this.ports.sign,
      );
    } catch {
      // A payload the canonical form cannot hold (a fraction, a lone surrogate) is refused.
      return null;
    }
    return this.commitNew({ kind: 'command', envelope, numberUsed: numbering.used() }, id, except);
  }

  /** Journals a local entry (a pairing, a session, a lockout) like a command. */
  private appendLocal(body: JournalBody): Promise<void> {
    return this.lock.run(async () => {
      if (!this.isServing()) throw new DomainError('NOT_HUB', 'This PC is not the hub');
      try {
        await this.commitNew(body, this.ports.random.id());
      } catch (error) {
        if (error instanceof NotHub) throw new DomainError('NOT_HUB', 'This PC is not the hub');
        throw error;
      }
    });
  }

  /**
   * Mirror first, then commit (rules 5, 21): the entry goes to the standby, which has 0.8 s to
   * answer; then the optimistic rows, the journal row, the upload-queue row and the result row are
   * written in one local transaction. Runs under the writer lock.
   */
  private async commitNew(body: JournalBody, id: string, except?: string): Promise<JournalEntry> {
    const wire: WireEntry = { id, seq: this.state.appliedSeq + 1, epoch: this.state.epoch, body };
    const mirrored = await this.mirror(wire, except);
    const at = this.ports.clock.now().toISOString();
    const entry: JournalEntry = {
      ...wire,
      mirrored: mirrored || except !== undefined,
      mirroredAt: mirrored ? at : null,
      committedAt: at,
      ownLineage: false,
      forwardedAt: null,
    };
    const next = { ...this.state, appliedSeq: wire.seq };
    await this.ports.store.transaction(async (tx) => {
      await tx.appendEntry(entry);
      await tx.saveState(next);
    });
    this.state = next;
    this.changed();
    return entry;
  }

  private okAnswer(entry: JournalEntry): HubCommandAnswer {
    const body = entry.body as CommandBody;
    return { status: 'ok', mirrored: entry.mirrored, envelope: body.envelope };
  }

  private duplicateAnswer(entry: JournalEntry): HubCommandAnswer {
    if (entry.body.kind !== 'command') return { status: 'refused', reason: 'payload_invalid' };
    return { status: 'duplicate', mirrored: entry.mirrored, envelope: entry.body.envelope };
  }

  private notHubAnswer(status: PeerStatus | null = null): HubCommandAnswer {
    if (status && status.role === 'hub') {
      return { status: 'not_hub', epoch: status.epoch, hubDeviceId: status.deviceId };
    }
    return {
      status: 'not_hub',
      epoch: this.state.epoch,
      hubDeviceId: this.state.hubDeviceId === this.config.deviceId ? null : this.state.hubDeviceId,
    };
  }

  // --- Mirroring (rule 21) ---------------------------------------------------------------------

  private async mirror(entry: WireEntry, except?: string): Promise<boolean> {
    let mirrored = false;
    for (const peerId of this.config.peerDeviceIds) {
      if (peerId === except) continue;
      const view = this.views.get(peerId);
      if (!view?.reachable || !view.compatible || view.status?.role !== 'standby') continue;
      if (view.status.rejoining) continue;
      try {
        mirrored = (await this.pushEntries(peerId, [entry])) || mirrored;
      } catch (error) {
        if (error instanceof NotHub) throw error;
        view.reachable = false;
        view.inSync = false;
      }
    }
    return mirrored;
  }

  private async refAt(seq: number): Promise<EntryRef | null> {
    if (seq < 1) return null;
    const entry = await this.ports.store.entryAt(seq);
    return entry ? refOf(entry) : null;
  }

  /** Sends entries to a standby; true when it holds them. Throws `NotHub` on a higher epoch. */
  private async pushEntries(peerId: string, entries: WireEntry[], depth = 0): Promise<boolean> {
    const first = entries[0];
    if (!first) return true;
    const answer = await this.ports
      .peers(peerId)
      .mirror(
        { ...this.request(), prev: await this.refAt(first.seq - 1), entries: entries.map(toWire) },
        hubPolicy.mirrorTimeoutMs,
      );
    const view = this.view(peerId);
    switch (answer.result) {
      case 'ok':
        view.reachable = true;
        if (view.status) view.status = { ...view.status, appliedSeq: answer.appliedSeq };
        view.inSync = answer.appliedSeq >= this.state.appliedSeq;
        return true;
      case 'stale':
        this.see(peerId, answer.status);
        if (outranks(answer.status, this.me())) {
          void this.demote(answer.status).catch(() => undefined);
          throw new NotHub(answer.status);
        }
        return false;
      case 'need_from': {
        if (depth > 0) return false;
        const missing = await this.ports.store.entriesAfter(answer.from - 1);
        // An entry the standby lacks that retention dropped: it cannot catch up from here (rule 29).
        if (missing[0]?.seq !== answer.from) {
          view.inSync = false;
          return false;
        }
        const ids = new Set(missing.map((e) => e.id));
        return this.pushEntries(
          peerId,
          [...missing.map(toWire), ...entries.filter((e) => !ids.has(e.id))],
          depth + 1,
        );
      }
      case 'protocol_mismatch':
        view.compatible = false;
        view.inSync = false;
        return false;
      case 'rejoining':
      case 'diverged':
        view.inSync = false;
        if (view.status) view.status = { ...view.status, rejoining: true };
        return false;
    }
  }

  // --- Heartbeats, watchdog and recovery (rules 22, 23) ----------------------------------------

  private async sendHeartbeats(): Promise<void> {
    for (const peerId of this.config.peerDeviceIds) {
      if (this.state.role !== 'hub') return;
      let answer: HeartbeatAnswer;
      try {
        answer = await this.ports.peers(peerId).heartbeat(
          {
            ...this.request(),
            liveClients: this.liveClients,
            seq: this.state.appliedSeq,
            last: await this.refAt(this.state.appliedSeq),
            oldest: await this.ports.store.oldestSeq(),
            activity: await this.pairing.activity(),
          },
          hubPolicy.mirrorTimeoutMs,
        );
      } catch {
        const view = this.view(peerId);
        view.reachable = false;
        view.inSync = false;
        continue;
      }
      if (answer.result === 'protocol_mismatch') {
        Object.assign(this.view(peerId), { reachable: true, compatible: false, inSync: false });
        continue;
      }
      this.see(peerId, answer.status);
      if (answer.result === 'stale' || answer.status.role === 'hub') {
        if (outranks(answer.status, this.me())) {
          await this.demote(answer.status).catch(() => undefined);
          return;
        }
        continue;
      }
      await this.pairing.mergeActivity(answer.activity);
      const { status } = answer;
      if (status.role !== 'standby' || status.rejoining) continue;
      if (status.epoch === this.state.epoch && status.appliedSeq > this.state.appliedSeq) {
        // The standby holds entries this hub copied and never committed (it lost power).
        await this.lock.run(() => this.recoverFromStandby(peerId)).catch(() => undefined);
      } else if (status.appliedSeq < this.state.appliedSeq) {
        await this.lock
          .run(async () => {
            const missing = await this.ports.store.entriesAfter(status.appliedSeq);
            if (missing.length > 0) await this.pushEntries(peerId, missing.map(toWire));
          })
          .catch(() => {
            this.view(peerId).inSync = false;
          });
      }
    }
  }

  /** The standby promotes itself after 3 s of silence when it holds every reported entry. */
  private async watchdog(): Promise<void> {
    if (this.state.rejoining || !this.state.hubDeviceId) return;
    if (this.nowMs() - this.lastHeartbeatMs < hubPolicy.promoteAfterSilenceMs) return;
    if (this.state.appliedSeq < this.state.hubSeq) return;
    await this.promote('auto');
  }

  /**
   * Rule 23: takes back the entries the standby holds after this hub's last one, when they
   * continue this hub's lineage; anything else is a divergence the standby settles by rejoining.
   * Runs under the writer lock.
   */
  private async recoverFromStandby(peerId: string): Promise<number> {
    const answer = await this.ports
      .peers(peerId)
      .journal(
        { ...this.request(), after: Math.max(this.state.appliedSeq - 1, 0) },
        CATCH_UP_TIMEOUT_MS,
      );
    if (answer.result !== 'ok') return 0;
    let entries = answer.entries;
    if (this.state.appliedSeq > 0) {
      const [first, ...rest] = entries;
      if (!first || !sameRef(refOf(first), await this.refAt(this.state.appliedSeq))) return 0;
      entries = rest;
    }
    let taken = 0;
    for (const entry of entries) {
      if (entry.seq !== this.state.appliedSeq + 1) break;
      const next = { ...this.state, appliedSeq: entry.seq };
      await this.ports.store.transaction(async (tx) => {
        await this.applyFromHub(tx, entry);
        await tx.saveState(next);
      });
      this.state = next;
      taken += 1;
    }
    if (taken > 0) this.changed();
    return taken;
  }

  // --- Promotion and demotion (rules 22, 24, 27, 28) ---------------------------------------------

  /** The manual promotion's warning: how many entries the hub reported that this PC lacks. */
  promotionPreview(): { missing: number; rejoining: boolean } {
    return { missing: this.status().missing, rejoining: this.state.rejoining };
  }

  /**
   * Manual promotion (rule 27): a member with `hub.manage` types their PIN on the standby; it
   * promotes itself with epoch + 1 even without every entry, once the warning naming how many it
   * lacks was acknowledged. During a pending rejoin its own entries join the new lineage.
   */
  async promoteManually(input: {
    membershipId: string;
    pin: string;
    acknowledgedMissing: number;
  }): Promise<void> {
    const member = this.ports.members.member(input.membershipId);
    if (
      !member ||
      member.pinDisabled ||
      member.pinVerifier === null ||
      (await this.ports.store.pinDisabled(member.membershipId)) ||
      !(await this.ports.members.verifyPin(member.pinVerifier, input.pin))
    ) {
      throw new DomainError('INVALID_PIN', 'Wrong PIN');
    }
    if (!member.permissions.includes('hub.manage')) {
      throw new DomainError('FORBIDDEN', 'Promotion needs hub.manage');
    }
    if (this.state.role !== 'standby') throw new DomainError('CONFLICT', 'Only a standby promotes');
    if (input.acknowledgedMissing < this.status().missing) {
      throw new DomainError('CONFLICT', 'The warning names more missing entries', {
        missing: this.status().missing,
      });
    }
    await this.promote('manual', member.membershipId);
  }

  private async promote(kind: 'auto' | 'manual', membershipId?: string): Promise<void> {
    await this.lock.run(async () => {
      if (this.state.role !== 'standby') return;
      if (kind === 'auto') {
        // Re-checked under the writer lock: a heartbeat or a demotion may have come meanwhile.
        if (this.state.rejoining || !this.state.hubDeviceId) return;
        if (this.nowMs() - this.lastHeartbeatMs < hubPolicy.promoteAfterSilenceMs) return;
        if (this.state.appliedSeq < this.state.hubSeq) return;
      }
      const fromEpoch = this.state.epoch;
      const own = this.state.rejoining ? await this.ports.store.ownLineage() : [];
      const next: HubState = {
        ...this.state,
        role: 'hub',
        epoch: fromEpoch + 1,
        hubDeviceId: this.config.deviceId,
        rejoining: false,
        notice: null,
        appliedSeq: this.state.appliedSeq + own.length,
      };
      await this.ports.store.transaction(async (tx) => {
        // What it took alone and never had back joins its new lineage, after what it holds.
        for (const [i, entry] of own.entries()) {
          await tx.moveEntry(entry.id, this.state.appliedSeq + i + 1, next.epoch);
        }
        await tx.saveState(next);
        await tx.recordLocalEvent(
          this.localEvent('hub.promoted', membershipId, {
            fromEpoch,
            toEpoch: next.epoch,
            manual: kind === 'manual',
            readded: own.length,
          }),
        );
      });
      this.state = next;
      this.rejoinFailures = 0;
      for (const view of this.views.values()) view.inSync = false;
      this.changed();
    });
  }

  /**
   * A PC that meets a higher epoch, or loses the equal-epoch tie-break, demotes itself: it saves
   * `rejoining` with its new role, then catches up and forwards its own lineage (rule 24).
   */
  private demote(status: PeerStatus): Promise<void> {
    return this.lock.run(async () => {
      if (!this.config.peerDeviceIds.includes(status.deviceId) || status.role !== 'hub') return;
      if (this.state.role === 'none') return;
      if (
        this.state.role === 'hub' ? !outranks(status, this.me()) : status.epoch < this.state.epoch
      ) {
        return;
      }
      const following =
        this.state.role === 'standby' &&
        this.state.hubDeviceId === status.deviceId &&
        this.state.epoch === status.epoch;
      if (following && !this.state.rejoining) return;
      const wasHub = this.state.role === 'hub';
      const next: HubState = {
        ...this.state,
        role: 'standby',
        epoch: status.epoch,
        hubDeviceId: status.deviceId,
        rejoining: true,
      };
      // A demotion resets the heartbeat clock (rule 22).
      this.lastHeartbeatMs = this.nowMs();
      await this.ports.store.transaction(async (tx) => {
        await tx.saveState(next);
        if (wasHub) {
          await tx.recordLocalEvent(
            this.localEvent('hub.demoted', undefined, { toEpoch: status.epoch }),
          );
        }
      });
      this.state = next;
      this.changed();
      await this.rejoinLocked(status.deviceId);
    });
  }

  /** A client or a peer named a higher epoch: checked with that PC before demoting. */
  async hint(deviceId: string, epoch: number): Promise<void> {
    if (epoch <= this.state.epoch || !this.config.peerDeviceIds.includes(deviceId)) return;
    const answer = await this.ports
      .peers(deviceId)
      .state(this.request(), hubPolicy.mirrorTimeoutMs);
    if (answer.result === 'ok') {
      this.see(deviceId, answer.status);
      await this.demote(answer.status);
    }
  }

  /** The PC was revoked, or lost its hub role online while not the live hub (rule 38). */
  async retire(): Promise<void> {
    await this.lock.run(async () => {
      const next: HubState = { ...this.state, role: 'none', rejoining: false };
      await this.ports.store.transaction((tx) => tx.saveState(next));
      this.state = next;
      this.changed();
    });
  }

  // --- Rejoin (rules 24, 25, 27, 29) -------------------------------------------------------------

  private resumeRejoin(hubDeviceId: string): void {
    if (this.rejoinInFlight || !this.config.peerDeviceIds.includes(hubDeviceId)) return;
    this.rejoinInFlight = true;
    void this.lock
      .run(async () => {
        if (!this.state.rejoining) {
          const next = { ...this.state, rejoining: true };
          await this.ports.store.transaction((tx) => tx.saveState(next));
          this.state = next;
          this.changed();
        }
        await this.rejoinLocked(hubDeviceId);
      })
      .catch(() => undefined)
      .finally(() => {
        this.rejoinInFlight = false;
      });
  }

  /**
   * After a connection to the internet brought this PC's data up to date, a PC too far behind
   * rejoins from the hub's oldest kept entry (rule 29).
   */
  rejoinAfterServerSync(): Promise<void> {
    const hubId = this.state.hubDeviceId;
    if (!hubId || this.state.notice !== 'too_far_behind') return Promise.resolve();
    return this.lock.run(() => this.rejoinLocked(hubId, true));
  }

  /** Catches up from the hub and forwards this PC's own lineage. Runs under the writer lock. */
  private async rejoinLocked(hubDeviceId: string, acceptGap = false): Promise<void> {
    try {
      await this.rejoin(hubDeviceId, acceptGap);
      this.rejoinFailures = 0;
    } catch (error) {
      this.rejoinFailures += 1;
      // Bounded retries (rule 27): after 3 the screen says the other PC is needed.
      if (this.rejoinFailures >= hubPolicy.rejoinCatchUpTries && this.state.notice === null) {
        const next: HubState = { ...this.state, notice: 'needs_other_pc' };
        await this.ports.store.transaction((tx) => tx.saveState(next));
        this.state = next;
        this.changed();
      }
      throw error;
    }
  }

  private async rejoin(hubDeviceId: string, acceptGap: boolean): Promise<void> {
    const link = this.ports.peers(hubDeviceId);
    const answer: JournalAnswer = await link.journal(
      { ...this.request(), after: 0 },
      CATCH_UP_TIMEOUT_MS,
    );
    if (answer.result !== 'ok') throw new Error('The hub speaks another protocol');
    if (answer.status.role !== 'hub' || answer.status.epoch < this.state.epoch) {
      throw new Error('That PC is no longer the hub');
    }
    const theirs = [...answer.entries].sort((a, b) => a.seq - b.seq);
    const oldest = answer.oldestSeq ?? 1;
    const theirIds = new Set(theirs.map((e) => e.id));
    const theirBySeq = new Map(theirs.map((e) => [e.seq, e]));
    const mine = await this.ports.store.entriesAfter(0);
    const lineageEnd = mine.at(-1)?.seq ?? 0;
    const tooFarBehind = theirs.length > 0 && lineageEnd < oldest - 1;

    // The common prefix: entries below the hub's oldest kept one are taken as shared.
    let prefixEnd = 0;
    for (const entry of mine) {
      if (entry.seq < oldest) {
        prefixEnd = entry.seq;
        continue;
      }
      if (theirBySeq.get(entry.seq)?.id !== entry.id) break;
      prefixEnd = entry.seq;
    }
    const beyond = mine.filter((e) => e.seq > prefixEnd).map((e) => e.id);
    const at = this.ports.clock.now().toISOString();

    if (tooFarBehind && !acceptGap) {
      // It cannot catch up offline; it still forwards what it took alone (rule 29).
      await this.ports.store.transaction((tx) => tx.markOwnLineage(beyond));
      await this.forwardOwnLineage(hubDeviceId, theirIds, at);
      const next: HubState = { ...this.state, notice: 'too_far_behind' };
      await this.ports.store.transaction((tx) => tx.saveState(next));
      this.state = next;
      this.changed();
      return;
    }

    // Everything after the prefix leaves the lineage; what the hub holds comes back with the
    // hub's number, and the rest is forwarded. Done again in full if the rejoin is cut short.
    const caughtUp: HubState = {
      ...this.state,
      appliedSeq: theirs.at(-1)?.seq ?? prefixEnd,
      hubSeq: Math.max(this.state.hubSeq, theirs.at(-1)?.seq ?? 0),
    };
    await this.ports.store.transaction(async (tx) => {
      await tx.markOwnLineage(beyond);
      for (const entry of theirs) await this.applyFromHub(tx, entry);
      await tx.saveState(caughtUp);
    });
    this.state = caughtUp;
    const forwarded = await this.forwardOwnLineage(hubDeviceId, theirIds, at);
    const done: HubState = {
      ...this.state,
      rejoining: false,
      notice: null,
      hubSeq: Math.max(this.state.hubSeq, this.state.appliedSeq),
    };
    await this.ports.store.transaction(async (tx) => {
      await tx.saveState(done);
      await tx.recordLocalEvent(
        this.localEvent('hub.rejoined', undefined, { epoch: done.epoch, forwarded }),
      );
    });
    this.state = done;
    this.lastHeartbeatMs = this.nowMs();
    this.changed();
  }

  /** Sends the hub every own-lineage entry it lacks and has not had yet; answers how many. */
  private async forwardOwnLineage(
    hubDeviceId: string,
    theirIds: ReadonlySet<string>,
    at: string,
  ): Promise<number> {
    const pending = (await this.ports.store.ownLineage()).filter(
      (e) => e.forwardedAt === null && !theirIds.has(e.id),
    );
    for (let start = 0; start < pending.length; start += FORWARD_BATCH) {
      const batch = pending.slice(start, start + FORWARD_BATCH);
      const answer: ForwardAnswer = await this.ports
        .peers(hubDeviceId)
        .forward({ ...this.request(), entries: batch.map(toWire) }, CATCH_UP_TIMEOUT_MS);
      if (answer.result !== 'ok') throw new Error('The hub did not take the forwarded entries');
      const answered = answer.entries.map((e) => e.id);
      await this.ports.store.transaction((tx) => tx.markForwarded(answered, at));
    }
    return pending.length;
  }

  /**
   * Applies an entry of the hub's lineage at its number (on the standby, at rejoin, or when a
   * restarted hub takes entries back). An entry this PC holds moves to that number; one it holds
   * with another hash is replaced by the hub's version (rule 25).
   */
  private async applyFromHub(tx: HubTransaction, entry: WireEntry): Promise<void> {
    const existing = await tx.entry(entry.id);
    const at = this.ports.clock.now().toISOString();
    const stored: JournalEntry = {
      ...toWire(entry),
      mirrored: true,
      mirroredAt: at,
      committedAt: at,
      ownLineage: false,
      forwardedAt: null,
    };
    if (!existing) {
      await tx.appendEntry(stored);
      return;
    }
    if (entryHash(existing.body) !== entryHash(entry.body)) {
      await tx.replaceEntry({
        ...stored,
        mirrored: existing.mirrored,
        committedAt: existing.committedAt,
      });
      await tx.recordLocalEvent(
        this.localEvent('hub.divergence_adopted', undefined, { entryId: entry.id }),
      );
    }
    await tx.moveEntry(entry.id, entry.seq, entry.epoch);
  }

  // --- Retention (rule 29) -----------------------------------------------------------------------

  /**
   * Drops, oldest first, the entries of at least 7 business days ago that this PC uploaded and
   * whose outcome arrived; the latest entry stays, since heartbeats name it. A standby whose last
   * entry is older than what is left cannot catch up offline (rule 29). Called by the runtime now
   * and then.
   */
  async pruneJournal(): Promise<number> {
    return this.lock.run(async () => {
      const now = this.ports.clock.now();
      const endsAt = this.ports.branch.businessDayEndsAt();
      const cutoff = addDays(businessDateOf(now, endsAt), -RETENTION_BUSINESS_DAYS);
      const ids: string[] = [];
      for (const entry of await this.ports.store.entriesAfter(0)) {
        if (entry.seq >= this.state.appliedSeq) break;
        if (businessDateOf(entry.committedAt, endsAt) > cutoff) break;
        if (!(await this.ports.store.isSettled(entry.id))) break;
        ids.push(entry.id);
      }
      for (const entry of await this.ports.store.ownLineage()) {
        if (
          entry.forwardedAt !== null &&
          businessDateOf(entry.committedAt, endsAt) <= cutoff &&
          (await this.ports.store.isSettled(entry.id))
        ) {
          ids.push(entry.id);
        }
      }
      if (ids.length > 0) await this.ports.store.transaction((tx) => tx.deleteEntries(ids));
      return ids.length;
    });
  }

  // --- Peer handlers (`/peer/*`) -------------------------------------------------------------------

  async peerState(request: PeerStateRequest): Promise<PeerStateAnswer> {
    if (!this.compatible(request.protocol)) return this.mismatch();
    return { result: 'ok', status: this.peerStatus() };
  }

  async peerHeartbeat(request: HeartbeatRequest): Promise<HeartbeatAnswer> {
    if (!this.compatible(request.protocol)) {
      // A hub is alive even if it speaks another protocol: no promotion while it beats.
      if (this.state.role === 'standby') this.lastHeartbeatMs = this.nowMs();
      return this.mismatch();
    }
    const them = { epoch: request.epoch, liveClients: request.liveClients, deviceId: request.from };
    if (request.epoch < this.state.epoch || this.state.role === 'none') {
      return { result: 'stale', status: this.peerStatus() };
    }
    if (this.state.role === 'hub') {
      if (!outranks(them, this.me())) return { result: 'stale', status: this.peerStatus() };
      void this.demote(this.hubStatusOf(request.from, request.epoch, request.liveClients)).catch(
        () => undefined,
      );
      return { result: 'ok', status: this.peerStatus(), activity: await this.pairing.activity() };
    }
    this.lastHeartbeatMs = this.nowMs();
    if (
      request.epoch !== this.state.epoch ||
      request.from !== this.state.hubDeviceId ||
      request.seq !== this.state.hubSeq
    ) {
      const next: HubState = {
        ...this.state,
        epoch: request.epoch,
        hubDeviceId: request.from,
        hubSeq: request.seq,
        lastHeartbeatAt: this.ports.clock.now().toISOString(),
      };
      await this.ports.store.transaction((tx) => tx.saveState(next));
      this.state = next;
    }
    await this.pairing.mergeActivity(request.activity);
    if (this.state.rejoining) {
      // A rejoin cut short resumes at the next heartbeat (rule 24); too far behind waits for
      // the internet (rule 29).
      if (this.state.notice !== 'too_far_behind') this.resumeRejoin(request.from);
    } else if (
      (request.last &&
        this.state.appliedSeq >= request.last.seq &&
        !sameRef(request.last, await this.refAt(request.last.seq))) ||
      (request.oldest !== null && this.state.appliedSeq < request.oldest - 1)
    ) {
      // Its copy differs from the hub's, or it lacks entries the hub no longer keeps.
      this.resumeRejoin(request.from);
    }
    return { result: 'ok', status: this.peerStatus(), activity: await this.pairing.activity() };
  }

  async peerMirror(request: MirrorRequest): Promise<MirrorAnswer> {
    if (!this.compatible(request.protocol)) return this.mismatch();
    if (request.epoch < this.state.epoch) return { result: 'stale', status: this.peerStatus() };
    if (this.state.role === 'hub') {
      // At equal epochs the sender decides with both counts of hub clients (rule 28).
      if (request.epoch === this.state.epoch) return { result: 'stale', status: this.peerStatus() };
      void this.demote(this.hubStatusOf(request.from, request.epoch, 0)).catch(() => undefined);
      return { result: 'rejoining' };
    }
    if (this.state.role === 'none' || this.state.rejoining) return { result: 'rejoining' };
    return this.lock.run(async () => {
      if (this.state.role !== 'standby' || this.state.rejoining) return { result: 'rejoining' };
      this.lastHeartbeatMs = this.nowMs();
      if (request.epoch !== this.state.epoch || request.from !== this.state.hubDeviceId) {
        const next = { ...this.state, epoch: request.epoch, hubDeviceId: request.from };
        await this.ports.store.transaction((tx) => tx.saveState(next));
        this.state = next;
      }
      const diverged = (): MirrorAnswer => {
        this.resumeRejoinAfter(request.from);
        return { result: 'diverged', appliedSeq: this.state.appliedSeq };
      };
      const entries = [...request.entries].sort((a, b) => a.seq - b.seq);
      for (const [i, entry] of entries.entries()) {
        // Never skip by number alone: the entry held there must be the same command (rule 21).
        if (entry.seq <= this.state.appliedSeq) {
          if (!sameRef(refOf(entry), await this.refAt(entry.seq))) return diverged();
          continue;
        }
        if (entry.seq !== this.state.appliedSeq + 1) {
          return { result: 'need_from', from: this.state.appliedSeq + 1 };
        }
        const previous = entries[i - 1];
        const before = previous ? refOf(previous) : request.prev;
        if (
          this.state.appliedSeq > 0 &&
          !sameRef(before, await this.refAt(this.state.appliedSeq))
        ) {
          return diverged();
        }
        const next: HubState = {
          ...this.state,
          appliedSeq: entry.seq,
          hubSeq: Math.max(this.state.hubSeq, entry.seq),
        };
        await this.ports.store.transaction(async (tx) => {
          await this.applyFromHub(tx, entry);
          await tx.saveState(next);
        });
        this.state = next;
      }
      this.changed();
      return { result: 'ok', appliedSeq: this.state.appliedSeq };
    });
  }

  /** The rejoin a divergence starts runs after the mirror that found it has answered. */
  private resumeRejoinAfter(hubDeviceId: string): void {
    queueMicrotask(() => this.resumeRejoin(hubDeviceId));
  }

  async peerJournal(request: JournalRequest): Promise<JournalAnswer> {
    if (!this.compatible(request.protocol)) return this.mismatch();
    return {
      result: 'ok',
      status: this.peerStatus(),
      oldestSeq: await this.ports.store.oldestSeq(),
      entries: (await this.ports.store.entriesAfter(request.after)).map(toWire),
    };
  }

  /**
   * `/peer/forward` (rules 24, 26): the hub takes the entries a rejoining PC took alone, checks
   * each like a new command and gives it the next numbers of its lineage.
   */
  async peerForward(request: ForwardRequest): Promise<ForwardAnswer> {
    if (!this.compatible(request.protocol)) return this.mismatch();
    return this.lock.run(async () => {
      if (!this.isServing()) return { result: 'not_hub', status: this.peerStatus() };
      const results: { id: string; status: 'applied' | 'resolved' | 'duplicate' | 'refused' }[] =
        [];
      for (const entry of request.entries) {
        try {
          results.push({ id: entry.id, status: await this.takeForwarded(entry, request.from) });
        } catch (error) {
          if (error instanceof NotHub) return { result: 'not_hub', status: this.peerStatus() };
          throw error;
        }
      }
      return { result: 'ok', entries: results };
    });
  }

  private async takeForwarded(
    entry: WireEntry,
    from: string,
  ): Promise<'applied' | 'resolved' | 'duplicate' | 'refused'> {
    const existing = await this.ports.store.entry(entry.id);
    if (existing) {
      if (!existing.ownLineage) return 'duplicate';
      // This hub took it alone earlier and never had it back: it rejoins this lineage.
      const seq = this.state.appliedSeq + 1;
      await this.mirror({ ...toWire(existing), seq, epoch: this.state.epoch }, from);
      const next = { ...this.state, appliedSeq: seq };
      await this.ports.store.transaction(async (tx) => {
        await tx.moveEntry(existing.id, seq, this.state.epoch);
        await tx.saveState(next);
      });
      this.state = next;
      this.changed();
      return 'applied';
    }
    if (entry.body.kind !== 'command') {
      await this.commitNew(entry.body, entry.id, from);
      return 'applied';
    }
    const { envelope } = entry.body;
    const lookup = this.ports.registry.lookup(envelope.name, envelope.version);
    if (!lookup.ok) return 'refused';
    const { definition } = lookup;
    const payload = definition.payload.safeParse(envelope.payload);
    if (!payload.success) return 'refused';
    const decision = checkLocalAccess({
      access: definition.access,
      source: sourceOf(envelope),
      command: {
        actor: envelope.actor,
        ...(envelope.approvedByMembershipId
          ? { approvedByMembershipId: envelope.approvedByMembershipId }
          : {}),
      },
      member: (id) => this.ports.members.member(id),
    });
    if (!decision.ok) return 'refused';
    // A command that repeats an effect already applied (lines already sent to the kitchen).
    if (definition.alreadyApplied?.(envelope)) return 'duplicate';
    if (this.recheck(envelope, definition)) {
      await this.commitNew({ kind: 'command', envelope, numberUsed: null }, entry.id, from);
      return 'applied';
    }
    // A check failed: this hub resolves the command itself (rule 26).
    const resolved = await this.resolveAndCommit(
      definition,
      envelope.id,
      payload.data,
      decision,
      timing(envelope),
    );
    return resolved ? 'resolved' : 'refused';
  }

  // --- Helpers -----------------------------------------------------------------------------------

  private isServing(): boolean {
    return this.started && this.state.role === 'hub';
  }

  private nowMs(): number {
    return this.ports.clock.now().getTime();
  }

  private me(): { epoch: number; liveClients: number; deviceId: string } {
    return {
      epoch: this.state.epoch,
      liveClients: this.liveClients,
      deviceId: this.config.deviceId,
    };
  }

  private request(): { protocol: number; from: string; epoch: number } {
    return { protocol: this.protocol, from: this.config.deviceId, epoch: this.state.epoch };
  }

  private peerStatus(): PeerStatus {
    return {
      deviceId: this.config.deviceId,
      role: this.state.role,
      epoch: this.state.epoch,
      appliedSeq: this.state.appliedSeq,
      rejoining: this.state.rejoining,
      liveClients: this.liveClients,
    };
  }

  /** A peer that told this PC it is the hub at `epoch`. */
  private hubStatusOf(deviceId: string, epoch: number, liveClients: number): PeerStatus {
    return { deviceId, role: 'hub', epoch, appliedSeq: 0, rejoining: false, liveClients };
  }

  private compatible(protocol: number): boolean {
    return negotiateHubProtocol(this.protocol, protocol) !== null;
  }

  private mismatch(): { result: 'protocol_mismatch'; protocol: number } {
    return { result: 'protocol_mismatch', protocol: this.protocol };
  }

  private view(peerId: string): PeerView {
    let view = this.views.get(peerId);
    if (!view) {
      view = { reachable: false, compatible: true, status: null, inSync: false };
      this.views.set(peerId, view);
    }
    return view;
  }

  private see(peerId: string, status: PeerStatus): void {
    const view = this.view(peerId);
    view.reachable = true;
    view.compatible = true;
    view.status = status;
    view.inSync =
      status.role === 'standby' &&
      !status.rejoining &&
      status.epoch === this.state.epoch &&
      status.appliedSeq >= this.state.appliedSeq;
  }

  private standbyState(): 'in_sync' | 'not_in_sync' | 'none' {
    if (this.config.peerDeviceIds.length === 0) return 'none';
    return this.config.peerDeviceIds.some((id) => this.views.get(id)?.inSync)
      ? 'in_sync'
      : 'not_in_sync';
  }

  private localEvent(
    action: LocalEvent['action'],
    membershipId: string | undefined,
    details: LocalEvent['details'],
  ): LocalEvent {
    return {
      action,
      at: this.ports.clock.now().toISOString(),
      ...(membershipId ? { membershipId } : {}),
      details,
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
