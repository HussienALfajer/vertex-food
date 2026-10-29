import {
  type HubCommand,
  type HubLiveSnapshot,
  type HubRefusalReason,
  hubLiveSnapshotSchema,
} from '@vertex-food/contracts';
import { type CurrentHub, HubClient, type OutboxItem } from '@vertex-food/sync';
import { type HubCredentials, hubOrigin, hubTransport } from './hub-api';
import { indexedDbOutbox } from './storage';

// The page's connection to the branch (spec S04 rules 30–32): `HubClient` of `@vertex-food/sync`
// finds the hub among both hub-capable PCs and keeps the outbox in IndexedDB; this adds the live
// stream (`GET /hub/live`, server-sent events read with `fetch`, since an `EventSource` sends no
// header) and a tick that re-asks every PC after 3 s without the stream, sends what waits and
// counts it. While no PC answers as the hub the page says "reconnecting", never "failed".

const TICK_MS = 500;

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
    this.client = new HubClient({
      peers,
      store: indexedDbOutbox,
      now: () => new Date(),
      member: events.member,
      transport: {
        hello: transport.hello,
        command: async (address, command, timeoutMs) => {
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

  /** Keeps the command in the outbox and sends it with whatever else waits. */
  async send(command: HubCommand): Promise<void> {
    await this.client.send(command);
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
      live: hub && this.live && sameHub(this.live.hub, hub) ? this.state.live : null,
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
    if (parsed.success) this.update({ live: parsed.data });
  }
}

function sameHub(a: CurrentHub, b: CurrentHub): boolean {
  return a.address === b.address && a.deviceId === b.deviceId && a.epoch === b.epoch;
}
