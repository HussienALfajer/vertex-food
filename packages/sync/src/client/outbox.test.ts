import type {
  CommandEnvelope,
  HubCommand,
  HubCommandAnswer,
  HubHello,
} from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryOutbox } from '../test-support/branch.js';
import { chooseHub } from './discovery.js';
import { HubClient, type HubClientTransport } from './outbox.js';

// The client outbox and hub discovery (spec S04 rules 30, 31), against a scripted LAN.

const pc1 = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a01';
const pc2 = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a02';
const A = '192.168.1.10';
const B = '192.168.1.11';

let counter = 0;
function command(): HubCommand {
  counter += 1;
  return {
    id: `019a2b3c-4d5e-7f60-8a1b-${counter.toString(16).padStart(12, '0')}`,
    name: 'sync.network_check',
    version: 1,
    payload: { sequence: counter },
    deviceTime: '2026-10-28T10:00:00.000Z',
  };
}

function envelopeFor(c: HubCommand, executedBy: string): CommandEnvelope {
  return {
    id: c.id,
    name: c.name,
    version: c.version,
    protocol: 1,
    originKind: 'hub_client',
    originDeviceId: pc1,
    executedByDeviceId: executedBy,
    actor: { kind: 'device' },
    deviceTime: c.deviceTime,
    clockOffsetMs: 0,
    highestSeenTime: c.deviceTime,
    afterOfflineWindow: false,
    hubEpoch: 1,
    hubSeq: 1,
    payload: c.payload,
    resolved: {},
    payloadHash: 'a'.repeat(64),
    signature: 'c2ln',
  };
}

type Hub = { hello: HubHello; answer: (c: HubCommand) => HubCommandAnswer | 'drop' };

/** A scripted LAN: each address answers as its hub says, or not at all. */
function lan(hubs: Record<string, Hub | null>) {
  const sent: { address: string; command: HubCommand }[] = [];
  const transport: HubClientTransport = {
    async hello(address) {
      const hub = hubs[address];
      if (!hub) throw new Error('refused');
      return hub.hello;
    },
    async command(address, c) {
      const hub = hubs[address];
      if (!hub) throw new Error('refused');
      sent.push({ address, command: c });
      const answer = hub.answer(c);
      if (answer === 'drop') throw new Error('timeout');
      return answer;
    },
  };
  return { transport, sent };
}

const hello = (deviceId: string, role: HubHello['role'], epoch: number): HubHello => ({
  deviceId,
  role,
  epoch,
  protocol: 1,
  appVersion: '1.0.0',
});

let now = Date.parse('2026-10-28T10:00:00.000Z');
const clock = () => new Date(now);

function client(transport: HubClientTransport, store = new MemoryOutbox()) {
  const refused: string[] = [];
  const c = new HubClient({
    peers: [A, B],
    transport,
    store,
    now: clock,
    onRefused: (cmd, reason) => refused.push(`${cmd.id}:${reason}`),
  });
  return { c, store, refused };
}

describe('discovery (rule 30)', () => {
  it('follows the PC that says it is the hub with the highest epoch', () => {
    expect(
      chooseHub([
        { address: A, hello: hello(pc1, 'hub', 1) },
        { address: B, hello: hello(pc2, 'hub', 2) },
      ])?.address,
    ).toBe(B);
    expect(chooseHub([{ address: A, hello: hello(pc1, 'standby', 3) }])).toBeNull();
    expect(chooseHub([{ address: A, hello: hello(pc1, 'rejoining', 3) }])).toBeNull();
  });

  it('asks again after 3 s without the live stream', async () => {
    const { transport } = lan({
      [A]: { hello: hello(pc1, 'hub', 1), answer: () => 'drop' },
      [B]: null,
    });
    const { c } = client(transport);
    await c.discover();
    expect(c.hub()?.deviceId).toBe(pc1);
    now += 2000;
    c.checkLive();
    expect(c.hub()).not.toBeNull();
    c.liveReceived();
    now += 3000;
    c.checkLive();
    expect(c.hub()).toBeNull();
  });
});

describe('the outbox (rule 31)', () => {
  it('keeps an unanswered command as sending and re-sends it with the same id', async () => {
    let up = false;
    const { transport, sent } = lan({
      [A]: {
        hello: hello(pc1, 'hub', 1),
        answer: (c) =>
          up ? { status: 'ok', mirrored: true, envelope: envelopeFor(c, pc1) } : 'drop',
      },
      [B]: null,
    });
    const { c } = client(transport);
    const first = command();
    await c.send(first);
    expect(await c.counts()).toEqual({ sending: 1, unmirrored: 0 });
    up = true;
    await c.flush();
    expect(await c.counts()).toEqual({ sending: 0, unmirrored: 0 });
    expect(sent.map((s) => s.command.id)).toEqual([first.id, first.id, first.id]);
  });

  it('removes a refused command and says why', async () => {
    const { transport } = lan({
      [A]: {
        hello: hello(pc1, 'hub', 1),
        answer: () => ({ status: 'refused', reason: 'permission_missing' }),
      },
      [B]: null,
    });
    const { c, refused } = client(transport);
    const cmd = command();
    await c.send(cmd);
    expect(await c.counts()).toEqual({ sending: 0, unmirrored: 0 });
    expect(refused).toEqual([`${cmd.id}:permission_missing`]);
  });

  it('keeps unmirrored versions until a later command is mirrored, and re-sends them after a failover', async () => {
    const hubs: Record<string, Hub | null> = {
      [A]: {
        hello: hello(pc1, 'hub', 1),
        answer: (c) => ({ status: 'ok', mirrored: false, envelope: envelopeFor(c, pc1) }),
      },
      [B]: {
        hello: hello(pc2, 'standby', 1),
        answer: () => ({ status: 'not_hub', epoch: 1, hubDeviceId: pc1 }),
      },
    };
    const { transport, sent } = lan(hubs);
    const { c } = client(transport);
    const first = command();
    const second = command();
    await c.send(first);
    await c.send(second);
    expect(await c.counts()).toEqual({ sending: 0, unmirrored: 2 });

    // The hub dies; the standby becomes the hub at epoch 2.
    hubs[A] = null;
    hubs[B] = {
      hello: hello(pc2, 'hub', 2),
      answer: (cmd) => ({
        status: 'ok',
        mirrored: false,
        envelope: cmd.resent ?? envelopeFor(cmd, pc2),
      }),
    };
    const third = command();
    await c.send(third);
    // The kept versions went first, as `resent`, to the new hub.
    const toB = sent.filter((s) => s.address === B && s.command.id !== third.id);
    expect(toB.map((s) => s.command.id)).toEqual([first.id, second.id]);
    expect(toB.every((s) => s.command.resent?.executedByDeviceId === pc1)).toBe(true);
    expect(await c.counts()).toEqual({ sending: 0, unmirrored: 3 });

    // A later command answered mirrored: everything that hub answered is held by its standby.
    hubs[B] = {
      hello: hello(pc2, 'hub', 2),
      answer: (cmd) => ({ status: 'ok', mirrored: true, envelope: envelopeFor(cmd, pc2) }),
    };
    await c.send(command());
    expect(await c.counts()).toEqual({ sending: 0, unmirrored: 0 });
  });

  it('asks every PC again on not_hub and goes on with the hub it finds', async () => {
    const hubs: Record<string, Hub | null> = {
      [A]: {
        hello: hello(pc1, 'hub', 1),
        answer: () => ({ status: 'not_hub', epoch: 2, hubDeviceId: pc2 }),
      },
      // It knew only the old hub.
      [B]: { hello: hello(pc2, 'standby', 1), answer: () => 'drop' },
    };
    const { transport, sent } = lan(hubs);
    const { c, store } = client(transport);
    await c.discover();
    hubs[B] = {
      hello: hello(pc2, 'hub', 2),
      answer: (cmd) => ({ status: 'duplicate', mirrored: true, envelope: envelopeFor(cmd, pc2) }),
    };
    await c.send(command());
    expect(sent.map((s) => s.address)).toEqual([A, B]);
    expect(c.hub()?.deviceId).toBe(pc2);
    expect(store.items.size).toBe(0);
  });

  it('survives a restart: the outbox is its store', async () => {
    const store = new MemoryOutbox();
    const { transport } = lan({ [A]: null, [B]: null });
    const first = client(transport, store);
    await first.c.send(command());
    const again = client(transport, store);
    expect(await again.c.counts()).toEqual({ sending: 1, unmirrored: 0 });
  });
});
