import {
  type CommandEnvelope,
  type HubCommand,
  type HubCommandAnswer,
  type HubHello,
  type HubRefusalReason,
  hubPolicy,
} from '@vertex-food/contracts';
import { chooseHub } from './discovery.js';

// A hub client's outbox (spec S04 rules 30, 31, ADR 0022): hub client pages (IndexedDB) and client
// PCs (`local_outbox`) keep every command until a hub answers it, and re-send it with the same id;
// a waiter never sees "failed", so never taps an order twice. A command answered `mirrored: false`
// stays with the version the hub resolved until a later command of this client is answered
// `mirrored: true`, and that version is re-sent to the next hub after a failover. A `refused`
// answer removes the command and the page shows the reason.

export type OutboxItem =
  | { state: 'pending'; command: HubCommand; queuedAt: string }
  | {
      state: 'unmirrored';
      command: HubCommand;
      queuedAt: string;
      /** The signed version the hub answered, re-sent as `resent` to another hub. */
      envelope: CommandEnvelope;
      answeredBy: string;
    };

/** Where the outbox lives; it survives a page reload or an app restart. */
export interface OutboxStore {
  /** Every item, oldest first. */
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The hub's LAN API as a client calls it; a call rejects on a refused connection or a timeout. */
export interface HubClientTransport {
  hello(address: string, timeoutMs: number): Promise<HubHello>;
  command(address: string, command: HubCommand, timeoutMs: number): Promise<HubCommandAnswer>;
}

export type CurrentHub = { address: string; deviceId: string; epoch: number };

export type HubClientOptions = {
  /** The addresses of both hub-capable PCs, from the pairing (rule 30). */
  peers: readonly string[];
  transport: HubClientTransport;
  store: OutboxStore;
  now: () => Date;
  /** A refused command left the outbox: the page shows why. */
  onRefused?: (command: HubCommand, reason: HubRefusalReason) => void;
};

export class HubClient {
  private current: CurrentHub | null = null;
  private lastLiveMs: number | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly options: HubClientOptions) {}

  hub(): CurrentHub | null {
    return this.current;
  }

  /** Asks every hub-capable PC and takes the highest epoch (rule 30). */
  async discover(): Promise<CurrentHub | null> {
    const answers = await Promise.all(
      this.options.peers.map(async (address) => {
        try {
          const hello = await this.options.transport.hello(address, hubPolicy.mirrorTimeoutMs);
          return { address, hello };
        } catch {
          return null;
        }
      }),
    );
    const found = chooseHub(answers.filter((a) => a !== null));
    this.current = found
      ? { address: found.address, deviceId: found.hello.deviceId, epoch: found.hello.epoch }
      : null;
    this.lastLiveMs = found ? this.options.now().getTime() : null;
    return this.current;
  }

  /** A live snapshot arrived from the current hub. */
  liveReceived(): void {
    this.lastLiveMs = this.options.now().getTime();
  }

  /** 3 s without the live stream: the next send asks every PC again (rule 30). */
  checkLive(): void {
    if (
      this.current &&
      this.lastLiveMs !== null &&
      this.options.now().getTime() - this.lastLiveMs >= hubPolicy.clientRediscoverMs
    ) {
      this.current = null;
    }
  }

  /** Keeps the command, then tries to send everything waiting. */
  async send(command: HubCommand): Promise<void> {
    await this.options.store.put({
      state: 'pending',
      command,
      queuedAt: this.options.now().toISOString(),
    });
    await this.flush();
  }

  /** What the page shows: «قيد الإرسال 3» counts the unanswered commands. */
  async counts(): Promise<{ sending: number; unmirrored: number }> {
    const items = await this.options.store.list();
    return {
      sending: items.filter((i) => i.state === 'pending').length,
      unmirrored: items.filter((i) => i.state === 'unmirrored').length,
    };
  }

  /** One pass over the outbox, one at a time; a pass already running is joined. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.flushOnce().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    // A refused connection or a `not_hub` answer: ask every PC again at once, then try once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      const hub = attempt === 0 && this.current ? this.current : await this.discover();
      if (!hub || (await this.pass(hub))) return;
    }
  }

  /** Sends what waits to one hub; false when it stopped answering as the hub. */
  private async pass(hub: CurrentHub): Promise<boolean> {
    const items = await this.options.store.list();
    // Versions another hub answered without a standby copy go first: the new hub applies them
    // instead of resolving them again (rule 31).
    const resend = items.filter((i) => i.state === 'unmirrored' && i.answeredBy !== hub.deviceId);
    const pending = items.filter((i) => i.state === 'pending');
    for (const item of [...resend, ...pending]) {
      const command: HubCommand =
        item.state === 'unmirrored' ? { ...item.command, resent: item.envelope } : item.command;
      let answer: HubCommandAnswer;
      try {
        answer = await this.options.transport.command(
          hub.address,
          command,
          hubPolicy.clientRediscoverMs,
        );
      } catch {
        // No answer: the command stays "sending" while the client looks for the hub again.
        this.current = null;
        return false;
      }
      if (answer.status === 'not_hub') {
        this.current = null;
        return false;
      }
      if (answer.status === 'refused') {
        await this.options.store.delete(item.command.id);
        this.options.onRefused?.(item.command, answer.reason);
        continue;
      }
      if (answer.mirrored) {
        // Mirroring is in order: the standby now holds every earlier command of this hub.
        await this.options.store.delete(item.command.id);
        for (const other of await this.options.store.list()) {
          if (other.state === 'unmirrored' && other.answeredBy === hub.deviceId) {
            await this.options.store.delete(other.command.id);
          }
        }
        continue;
      }
      const { resent: _resent, ...original } = item.command;
      await this.options.store.put({
        state: 'unmirrored',
        command: original,
        queuedAt: item.queuedAt,
        envelope: answer.envelope,
        answeredBy: hub.deviceId,
      });
    }
    return true;
  }
}
