import type { HubCommand, HubCommandAnswer, HubHello } from '@vertex-food/contracts';
import { hubCommandAnswerSchema, hubCommandSchema, hubHelloSchema } from '@vertex-food/contracts';
import type { z } from 'zod';
import type { HubClientTransport } from '../client/outbox.js';
import type { CommandSource } from '../hub/access.js';
import type { BranchHub } from '../hub/hub.js';
import {
  forwardAnswerSchema,
  forwardRequestSchema,
  heartbeatAnswerSchema,
  heartbeatRequestSchema,
  journalAnswerSchema,
  journalRequestSchema,
  mirrorAnswerSchema,
  mirrorRequestSchema,
  type PeerLink,
  type PeerTransport,
  peerStateAnswerSchema,
  peerStateRequestSchema,
} from '../hub/peer.js';

// The branch LAN in memory: every request and answer goes through JSON and its schema, as over
// HTTPS, and a PC that is off or cut away answers nothing. A call that hangs (a deadlock would be
// a bug) still ends at its timeout, so a test fails instead of waiting forever.

export class Unreachable extends Error {
  constructor(what: string) {
    super(`${what} is unreachable`);
  }
}

type Method = 'state' | 'heartbeat' | 'mirror' | 'journal' | 'forward';

function wire<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Unreachable(`${what} (timeout)`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class MemoryLan {
  private readonly nodes = new Map<string, BranchHub>();
  private readonly addresses = new Map<string, string>();
  private readonly cuts = new Set<string>();
  /** Calls to fail, as `from>to:method`, with how many times. */
  private readonly failures = new Map<string, number>();

  attach(deviceId: string, address: string, hub: BranchHub): void {
    this.nodes.set(deviceId, hub);
    this.addresses.set(address, deviceId);
  }

  /** The PC lost power or its process ended. */
  detach(deviceId: string): void {
    this.nodes.delete(deviceId);
  }

  private key(a: string, b: string): string {
    return [a, b].sort().join('|');
  }

  cut(a: string, b: string): void {
    this.cuts.add(this.key(a, b));
  }

  heal(a: string, b: string): void {
    this.cuts.delete(this.key(a, b));
  }

  /** The next `times` calls of `method` from `from` to `to` find no answer. */
  fail(from: string, to: string, method: Method, times = 1): void {
    this.failures.set(`${from}>${to}:${method}`, times);
  }

  private failing(key: string): boolean {
    const left = this.failures.get(key) ?? 0;
    if (left <= 0) return false;
    this.failures.set(key, left - 1);
    return true;
  }

  private reach(from: string, to: string): BranchHub {
    const node = this.nodes.get(to);
    if (!node || !this.nodes.has(from) || this.cuts.has(this.key(from, to))) {
      throw new Unreachable(to);
    }
    return node;
  }

  peers(from: string): PeerTransport {
    return (to) => {
      const call = async <Req, Ans>(
        method: Method,
        requestSchema: z.ZodType<Req>,
        answerSchema: z.ZodType<Ans>,
        request: Req,
        timeoutMs: number,
        handle: (node: BranchHub, request: Req) => Promise<unknown>,
      ): Promise<Ans> => {
        if (this.failing(`${from}>${to}:${method}`)) throw new Unreachable(to);
        const node = this.reach(from, to);
        const answer = await withTimeout(
          handle(node, wire(requestSchema, request)),
          Math.max(timeoutMs, 2000),
          `${to} ${method}`,
        );
        // The answer comes back over the same link, which may have been cut meanwhile.
        this.reach(to, from);
        return wire(answerSchema, answer);
      };
      const link: PeerLink = {
        state: (r, t) =>
          call('state', peerStateRequestSchema, peerStateAnswerSchema, r, t, (n, q) =>
            n.peerState(q),
          ),
        heartbeat: (r, t) =>
          call('heartbeat', heartbeatRequestSchema, heartbeatAnswerSchema, r, t, (n, q) =>
            n.peerHeartbeat(q),
          ),
        mirror: (r, t) =>
          call('mirror', mirrorRequestSchema, mirrorAnswerSchema, r, t, (n, q) => n.peerMirror(q)),
        journal: (r, t) =>
          call('journal', journalRequestSchema, journalAnswerSchema, r, t, (n, q) =>
            n.peerJournal(q),
          ),
        forward: (r, t) =>
          call('forward', forwardRequestSchema, forwardAnswerSchema, r, t, (n, q) =>
            n.peerForward(q),
          ),
      };
      return link;
    };
  }

  /**
   * A client's view of the LAN: it reaches a PC by address, and `source` says who it is on that
   * hub (its pairing and PIN session, or a client PC by mutual TLS).
   */
  client(
    clientId: string,
    source: (hub: BranchHub) => Promise<CommandSource>,
  ): HubClientTransport & { offline: boolean } {
    const lan = this;
    return {
      offline: false,
      async hello(address: string): Promise<HubHello> {
        const node = lan.clientReach(this.offline, clientId, address);
        return wire(hubHelloSchema, node.hello());
      },
      async command(address: string, command: HubCommand): Promise<HubCommandAnswer> {
        const node = lan.clientReach(this.offline, clientId, address);
        const answer = await node.submit(wire(hubCommandSchema, command), await source(node));
        lan.clientReach(this.offline, clientId, address);
        return wire(hubCommandAnswerSchema, answer);
      },
    };
  }

  private clientReach(offline: boolean, clientId: string, address: string): BranchHub {
    const deviceId = this.addresses.get(address);
    const node = deviceId ? this.nodes.get(deviceId) : undefined;
    if (offline || !deviceId || !node || this.cuts.has(this.key(clientId, deviceId))) {
      throw new Unreachable(address);
    }
    return node;
  }
}
