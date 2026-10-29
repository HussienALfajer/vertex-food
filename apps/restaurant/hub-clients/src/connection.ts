import {
  type HubCommand,
  type HubLiveSnapshot,
  type HubRefusalReason,
  hubLiveSnapshotSchema,
  hubPolicy,
} from '@vertex-food/contracts';
import { type CurrentHub, HubClient, type OutboxItem } from '@vertex-food/sync';
import { type HubCredentials, type HubTransport, hubOrigin, hubTransport } from './hub-api';
import { indexedDbOutbox } from './storage';

// The page's connection to the branch (spec S04 rules 30–32): `HubClient` of `@vertex-food/sync`
// finds the hub among both hub-capable PCs and keeps the outbox in IndexedDB; this adds the live
// stream (`GET /hub/live`, server-sent events read with `fetch`, since an `EventSource` sends no
// header) and a tick that re-asks every PC after 3 s without the stream, sends what waits and
// counts it. While no PC answers as the hub the page says "reconnecting", never "failed".

const TICK_MS = 500;
/** One discovery round's answers: every `hello` of a round answers within the mirror timeout. */
const ROUND_MS = 2000;
/** The hub records a session's input at most this often (`SESSION_TOUCH_MS` in `packages/sync`). */
const TOUCH_MS = 15_000;

export type Refusal = { command: HubCommand; reason: HubRefusalReason };

export type ConnectionState = {
  /** The PC answering as the hub, or null while the page looks for one. */
  hub: CurrentHub | null;
  live: HubLiveSnapshot | null;
  /** Unanswered commands: «قيد الإرسال 3». */
  sending: number;
  outbox: readonly OutboxItem[];
  /** The page's own time when each command of this page load was answered `ok` or `duplicate`. */
  answeredAt: ReadonlyMap<string, number>;
  refusals: readonly Refusal[];
};

export class HubConnection {
  private readonly client: HubClient;
  private readonly transport: HubTransport;
  private state: ConnectionState = {
    hub: null,
    live: null,
    sending: 0,
    outbox: [],
    answeredAt: new Map(),
    refusals: [],
  };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private running: Promise<void> | null = null;
  private live: { hub: CurrentHub; abort: AbortController } | null = null;
  /** The hub the last snapshot came from: it stays shown while the stream is opened again. */
  private liveFrom: CurrentHub | null = null;

  constructor(
    peers: readonly string[],
    private readonly credentials: HubCredentials,
    private readonly events: {
      member: () => string | null;
      /** The hub answered 401: the pairing was revoked or expired. */
      onUnpaired: () => void;
      onRefused: (refusal: Refusal) => void;
    },
  ) {
    const transport = hubTransport(credentials, () => events.onUnpaired());
    this.transport = transport;
    this.client = new HubClient({
      peers,
      store: indexedDbOutbox,
      now: () => new Date(),
      member: events.member,
      transport: {
        hello: transport.hello,
        command: async (address, command, timeoutMs) => {
          // `HubClient` picks a pass's commands by member when the pass starts; a member who
          // signed out or was locked since then must not send another's command with no session
          // or theirs, which the hub would refuse and the outbox drop. It waits, unsent, for its
          // maker (rule 35); the next pass leaves it out.
          const maker = command.actor?.kind === 'member' ? command.actor.membershipId : null;
          if (maker && !command.resent && maker !== events.member()) {
            throw new Error('Waits for its member');
          }
          const answer = await transport.command(address, command, timeoutMs);
          if (answer.status === 'ok' || answer.status === 'duplicate') {
            const answeredAt = new Map(this.state.answeredAt);
            answeredAt.set(command.id, Date.now());
            this.update({ answeredAt });
          }
          return answer;
        },
      },
      onRefused: (command, reason) => {
        const refusal = { command, reason };
        this.update({ refusals: [...this.state.refusals, refusal] });
        events.onRefused(refusal);
      },
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ConnectionState => this.state;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closeLive();
  }

  /**
   * Keeps the command in the outbox, then sends it with whatever else waits. It resolves once the
   * command is saved on the phone, and rejects when it could not be (storage full, a private
   * window): the page says so instead of counting it as sent (ADR 0008).
   */
  async send(command: HubCommand): Promise<void> {
    await indexedDbOutbox.put({ state: 'pending', command, queuedAt: new Date().toISOString() });
    void this.client
      .flush()
      .catch(() => undefined)
      .then(() => this.refresh());
    await this.refresh();
  }

  /** Runs a tick now: the member's session started, so their commands may go. */
  kick(): void {
    if (!this.stopped) this.schedule(0);
  }

  private update(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running ??= this.tick().finally(() => {
        this.running = null;
        if (!this.stopped && !this.timer) this.schedule(TICK_MS);
      });
    }, ms);
  }

  private async tick(): Promise<void> {
    try {
      // 3 s without the live stream: ask every PC again (rule 30). The stream's keepalive comes
      // only every 15 s, so an idle page asks every 3 s, which also finds a PC that just promoted.
      this.client.checkLive();
      if (!this.client.hub()) await this.client.discover();
      const hub = this.client.hub();
      if (!hub) this.closeLive();
      else if (!this.live || !sameHub(this.live.hub, hub)) this.openLive(hub);
      await this.client.flush();
      // No PC accepts the pairing and one refused it: revoked, or 30 days unused (rule 34).
      if (!this.client.hub() && this.transport.pairingRefused(ROUND_MS)) {
        this.events.onUnpaired();
        return;
      }
      // While the live stream is busy the page asks no PC again, so the member's input goes to
      // the hub on a `hello` of its own (rule 35).
      const current = this.client.hub();
      if (
        current &&
        this.credentials.touch() &&
        Date.now() - this.transport.touchedAt() >= TOUCH_MS
      ) {
        await this.transport.hello(current.address, hubPolicy.mirrorTimeoutMs).catch(() => null);
      }
    } catch {
      // A refused connection or a timeout: the commands stay "sending" for the next tick.
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const outbox = await indexedDbOutbox.list().catch(() => this.state.outbox);
    const hub = this.client.hub();
    this.update({
      hub,
      // A snapshot from a PC that is no longer the hub says nothing of the branch now.
      live: hub && this.liveFrom && sameHub(this.liveFrom, hub) ? this.state.live : null,
      outbox,
      sending: outbox.filter((item) => item.state === 'pending').length,
    });
  }

  private closeLive(): void {
    this.live?.abort.abort();
    this.live = null;
  }

  private openLive(hub: CurrentHub): void {
    this.closeLive();
    const abort = new AbortController();
    this.live = { hub, abort };
    void this.readLive(hub, abort.signal).finally(() => {
      // The stream ended (the hub stopped, a revoked pairing): look for the hub again.
      if (this.live?.abort.signal === abort.signal) {
        this.live = null;
        void this.client.discover().catch(() => null);
      }
    });
  }

  private async readLive(hub: CurrentHub, signal: AbortSignal): Promise<void> {
    const headers = new Headers({ accept: 'text/event-stream' });
    const token = this.credentials.token();
    const session = this.credentials.session();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (session) headers.set('x-hub-session', session);
    let response: Response;
    try {
      response = await fetch(`${hubOrigin(hub.address)}/hub/live`, {
        headers,
        signal,
        cache: 'no-store',
      });
    } catch {
      return;
    }
    if (response.status === 401) {
      this.events.onUnpaired();
      return;
    }
    if (!response.ok || !response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          this.liveEvent(hub, buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted, or the connection dropped.
    }
  }

  /** One server-sent event: a full snapshot, or the keepalive comment. Both say the hub is there. */
  private liveEvent(hub: CurrentHub, block: string): void {
    if (!this.live || !sameHub(this.live.hub, hub)) return;
    this.client.liveReceived();
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = hubLiveSnapshotSchema.safeParse(json);
    if (parsed.success) {
      this.liveFrom = hub;
      this.update({ live: parsed.data });
    }
  }
}

function sameHub(a: CurrentHub, b: CurrentHub): boolean {
  return a.address === b.address && a.deviceId === b.deviceId && a.epoch === b.epoch;
}
