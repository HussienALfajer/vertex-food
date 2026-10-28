import {
  type ConnectivityState,
  type DeviceMember,
  type HubCommand,
  type HubRefusalReason,
  idSchema,
  numberBlockDates,
  numberBlockRange,
} from '@vertex-food/contracts';
import { z } from 'zod';
import { HubClient, type OutboxItem, type OutboxStore } from '../client/outbox.js';
import { commandRegistry } from '../commands/index.js';
import type { SignMessage, VerifyMessage } from '../envelope.js';
import type { CommandSource } from '../hub/access.js';
import { BranchHub, type ResolvedCheck } from '../hub/hub.js';
import type { HubResolveContext } from '../hub/numbering.js';
import type { BranchData, HubClock, HubRandom, MemberDirectory } from '../hub/ports.js';
import { createCommandRegistry, defineCommand } from '../registry.js';
import { MemoryLan, Unreachable } from './lan.js';
import { MemoryHubStore } from './memory-store.js';

// A test branch for the hub scenarios (Spike A's suite, spec S04 "Acceptance"): two hub-capable
// PCs, a shared manual clock, the LAN in memory, members, number blocks, and order-like test
// commands that number, price and write rows. The PCs' device keys come from the test, which may
// use Node's Ed25519 (`@vertex-food/sync/node`); nothing here imports a runtime.

const START = Date.parse('2026-10-28T09:00:00.000Z');

/** A UUIDv7 at `ms` with a counter in its random bits: unique and ordered in a test. */
export function testId(ms: number, counter: number): string {
  const time = ms.toString(16).padStart(12, '0');
  const rest = counter.toString(16).padStart(18, '0');
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${rest.slice(0, 3)}-8${rest.slice(3, 6)}-${rest.slice(6, 18)}`;
}

export class ManualClock implements HubClock {
  constructor(private ms: number = START) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
  offsetMs(): number {
    return 0;
  }
  highestSeenTime(): Date {
    return this.now();
  }
}

export class CountingRandom implements HubRandom {
  private counter = 0;
  /** The pairing codes the hub hands out, in order. */
  codes = ['482913', '771204', '306158', '995317'];
  constructor(
    private readonly clock: ManualClock,
    private readonly salt: number,
  ) {}
  id(): string {
    this.counter += 1;
    return testId(this.clock.now().getTime(), this.salt * 1_000_000 + this.counter);
  }
  token(): string {
    this.counter += 1;
    return `token-${this.salt}-${this.counter}-${'x'.repeat(32)}`;
  }
  pairingCode(): string {
    const code = this.codes.shift() ?? '123123';
    this.codes.push(code);
    return code;
  }
}

export const MEMBERS = {
  manager: testId(START, 9_000_001),
  waiter: testId(START, 9_000_002),
  owner: testId(START, 9_000_003),
};

/** PINs are `pin:<digits>` in the test member list. */
export class TestMembers implements MemberDirectory {
  readonly list: DeviceMember[] = [
    {
      membershipId: MEMBERS.manager,
      name: 'مدير الصالة',
      roles: ['manager'],
      permissions: ['hub.manage', 'sync.attention.resolve'],
      pinVerifier: 'pin:246810',
      pinDisabled: false,
    },
    {
      membershipId: MEMBERS.waiter,
      name: 'نادل',
      roles: ['waiter'],
      permissions: [],
      pinVerifier: 'pin:135790',
      pinDisabled: false,
    },
    {
      membershipId: MEMBERS.owner,
      name: 'المالك',
      roles: ['owner'],
      permissions: ['hub.manage', 'sync.attention.resolve', 'sync.quarantine.review'],
      pinVerifier: 'pin:975310',
      pinDisabled: false,
    },
  ];
  members(): readonly DeviceMember[] {
    return this.list;
  }
  member(membershipId: string): DeviceMember | null {
    return this.list.find((m) => m.membershipId === membershipId) ?? null;
  }
  async verifyPin(verifier: string, pin: string): Promise<boolean> {
    return verifier === `pin:${pin}`;
  }
}

// --- Order-like test commands (a test-only family that writes rows, spec S04 "Tests") ----------

export const menu = new Map<string, { priceId: string; unitMinor: number }>();

const openOrder = defineCommand({
  name: 'test.open_order',
  version: 1,
  payload: z.object({ orderId: idSchema, table: z.string() }),
  resolved: z.object({
    number: z.int().nullable(),
    label: z.string().nullable(),
    businessDate: z.string(),
  }),
  access: { actor: 'member', permission: 'hub.manage', station: false },
  resolve: (_payload, context: HubResolveContext) => {
    const taken = context.takeNumber('order');
    return { number: taken.number, label: taken.label, businessDate: context.businessDate };
  },
  describe: () => ({ key: 'commands.test.open_order', params: {} }),
});

const addLine = defineCommand({
  name: 'test.add_line',
  version: 1,
  payload: z.object({ orderId: idSchema, lineId: idSchema, itemId: z.string(), quantity: z.int() }),
  resolved: z.object({ priceId: z.string(), unitMinor: z.int() }),
  access: { actor: 'member', permission: 'hub.manage', station: false },
  resolve: (payload) => {
    const price = menu.get(payload.itemId);
    if (!price) throw new Error('no such item');
    return { priceId: price.priceId, unitMinor: price.unitMinor };
  },
  describe: () => ({ key: 'commands.test.add_line', params: {} }),
  // Lines already added by another lineage repeat their effect (rule 26).
  alreadyApplied: (envelope) => appliedLines.has(String(envelope.payload.lineId)),
});

/** Lines a test marks as already sent to the kitchen. */
export const appliedLines = new Set<string>();

const ticketReady = defineCommand({
  name: 'test.ticket_ready',
  version: 1,
  payload: z.object({ ticket: z.string() }),
  resolved: z.object({}),
  access: { actor: 'member', permission: 'hub.manage', station: true },
  resolve: () => ({}),
  describe: () => ({ key: 'commands.test.ticket_ready', params: {} }),
});

const approvedDiscount = defineCommand({
  name: 'test.approved_discount',
  version: 1,
  payload: z.object({ basisPoints: z.int() }),
  resolved: z.object({}),
  access: {
    actor: 'member',
    permission: 'hub.manage',
    approval: 'sync.quarantine.review',
    station: false,
  },
  resolve: () => ({}),
  describe: () => ({ key: 'commands.test.approved_discount', params: {} }),
});

export const testRegistry = createCommandRegistry([
  ...commandRegistry.definitions(),
  openOrder,
  addLine,
  ticketReady,
  approvedDiscount,
]);

/** The commands' own re-checks of a re-sent or forwarded version (rule 26). */
export const testRechecks: Record<string, ResolvedCheck> = {
  'test.open_order': (envelope, context) => {
    const { number, businessDate } = envelope.resolved as {
      number: number | null;
      businessDate: string;
    };
    return (
      number === null || context.numberInBlock(envelope.executedByDeviceId, businessDate, number)
    );
  },
  'test.add_line': (envelope) => {
    const price = menu.get(String(envelope.payload.itemId));
    const resolved = envelope.resolved as { priceId: string; unitMinor: number };
    return price?.priceId === resolved.priceId && price.unitMinor === resolved.unitMinor;
  },
};

// --- The branch ------------------------------------------------------------------------------

export type DeviceKeys = { sign: SignMessage; verify: VerifyMessage };

export class MemoryOutbox implements OutboxStore {
  readonly items = new Map<string, OutboxItem>();
  async list() {
    return [...this.items.values()];
  }
  async put(item: OutboxItem) {
    this.items.set(item.command.id, item);
  }
  async delete(id: string) {
    this.items.delete(id);
  }
}

export class TestPc {
  hub: BranchHub | null = null;
  readonly store: MemoryHubStore;
  readonly random: CountingRandom;
  protocol: number | undefined;

  constructor(
    private readonly branch: TestBranch,
    readonly name: string,
    readonly deviceId: string,
    readonly address: string,
    readonly role: 'hub' | 'standby',
    private readonly peer: () => TestPc,
  ) {
    this.store = new MemoryHubStore(deviceId);
    this.random = new CountingRandom(branch.clock, role === 'hub' ? 1 : 2);
  }

  /** The running hub; throws when this PC is off. */
  get running(): BranchHub {
    if (!this.hub) throw new Error(`${this.name} is off`);
    return this.hub;
  }

  async start(): Promise<void> {
    const branch = this.branch;
    this.hub = new BranchHub(
      {
        deviceId: this.deviceId,
        configuredRole: this.role,
        peerDeviceIds: [this.peer().deviceId],
        peerAddresses: [branch.pc1.address, branch.pc2.address],
        appVersion: '1.0.0',
        ...(this.protocol ? { protocol: this.protocol } : {}),
      },
      {
        store: this.store,
        clock: branch.clock,
        random: this.random,
        members: branch.members,
        branch: branch.data,
        peers: branch.lan.peers(this.deviceId),
        sign: branch.keys(this.deviceId).sign,
        registry: testRegistry,
        rechecks: testRechecks,
      },
    );
    branch.lan.attach(this.deviceId, this.address, this.hub);
    await this.hub.start();
    await branch.settle();
  }

  /** The power goes: whatever it did not commit is lost. */
  powerOff(): void {
    this.branch.lan.detach(this.deviceId);
    this.hub = null;
  }

  async restart(): Promise<void> {
    this.powerOff();
    await this.start();
  }
}

export type Phone = {
  pairingId: string;
  pairingToken: string;
  sessionToken: string | null;
  client: HubClient;
  outbox: MemoryOutbox;
  transport: ReturnType<MemoryLan['client']>;
  refused: { id: string; reason: HubRefusalReason }[];
};

export class TestBranch {
  readonly clock = new ManualClock();
  readonly lan = new MemoryLan();
  readonly members = new TestMembers();
  readonly pc1: TestPc;
  readonly pc2: TestPc;
  /** `number_blocks` as synced: device → date → block index. */
  readonly blocks = new Map<string, number>();
  connectivity: ConnectivityState = 'offline';
  private counter = 0;

  readonly data: BranchData;

  constructor(readonly keys: (deviceId: string) => DeviceKeys) {
    const pc1Id = testId(START, 1);
    const pc2Id = testId(START, 2);
    this.pc1 = new TestPc(this, 'pc1', pc1Id, '192.168.1.10', 'hub', () => this.pc2);
    this.pc2 = new TestPc(this, 'pc2', pc2Id, '192.168.1.11', 'standby', () => this.pc1);
    this.blocks.set(pc1Id, 1);
    this.blocks.set(pc2Id, 2);
    this.data = {
      businessDayEndsAt: () => '04:00',
      idleLockMinutes: () => 5,
      connectivity: () => this.connectivity,
      afterOfflineWindow: () => false,
      numberBlockOf: (deviceId) => {
        const index = this.blocks.get(deviceId);
        return index ? numberBlockRange(index) : null;
      },
      verifierOf: (deviceId) =>
        deviceId === pc1Id || deviceId === pc2Id ? this.keys(deviceId).verify : null,
      caFingerprint: () => 'f'.repeat(64),
    };
    for (const pc of [this.pc1, this.pc2]) {
      const range = numberBlockRange(this.blocks.get(pc.deviceId) ?? 1);
      for (const businessDate of numberBlockDates(this.clock.now(), '04:00')) {
        pc.store.addBlock({ series: 'order', businessDate, ...range, lastUsed: null });
      }
    }
  }

  id(): string {
    this.counter += 1;
    return testId(this.clock.now().getTime(), 5_000_000 + this.counter);
  }

  /** Lets every pending promise of the PCs run. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  /** Lets `ms` pass in heartbeat steps, ticking every running PC. */
  async run(ms: number): Promise<void> {
    for (let passed = 0; passed < ms; passed += 250) {
      this.clock.advance(250);
      for (const pc of [this.pc1, this.pc2]) await pc.hub?.tick();
      await this.settle();
    }
  }

  async startBoth(): Promise<void> {
    await this.pc1.start();
    await this.pc2.start();
    await this.run(1000);
  }

  /** The PC that is the live hub now, or null. */
  hubPc(): TestPc | null {
    const hubs = [this.pc1, this.pc2].filter((pc) => pc.hub?.liveRole() === 'hub');
    return hubs.length === 1 ? (hubs[0] ?? null) : null;
  }

  /** Pairs a phone with the current hub and signs a member in on it. */
  async pairPhone(
    options: { kind?: 'personal' | 'station'; member?: string; pin?: string; name?: string } = {},
  ): Promise<Phone> {
    const hub = this.hubPc();
    if (!hub) throw new Error('no hub');
    const kind = options.kind ?? 'personal';
    const { code } = await hub.running.pairing.open(
      { kind, name: options.name ?? 'هاتف الصالة' },
      MEMBERS.manager,
    );
    const paired = await hub.running.pairing.pair(code, '192.168.1.50');
    await this.settle();
    const phone: Phone = {
      pairingId: paired.pairingId,
      pairingToken: paired.token,
      sessionToken: null,
      outbox: new MemoryOutbox(),
      refused: [],
      client: null as unknown as HubClient,
      transport: null as unknown as Phone['transport'],
    };
    phone.transport = this.lan.client(`phone-${paired.pairingId}`, async (node) => {
      const pairing = await node.pairing.authenticate(phone.pairingToken);
      if (!pairing) throw new Unreachable('401');
      return node.sourceOfPairing(pairing, phone.sessionToken);
    });
    phone.client = new HubClient({
      peers: paired.peers,
      transport: phone.transport,
      store: phone.outbox,
      now: () => this.clock.now(),
      onRefused: (command, reason) => phone.refused.push({ id: command.id, reason }),
    });
    if (kind === 'personal') {
      const pairing = await hub.running.pairing.authenticate(paired.token);
      if (!pairing) throw new Error('pairing lost');
      const session = await hub.running.pairing.startSession(pairing, {
        membershipId: options.member ?? MEMBERS.manager,
        pin: options.pin ?? '246810',
      });
      phone.sessionToken = session.token;
      await this.settle();
    }
    return phone;
  }

  /** A client PC (a third cashier PC): it names its member and reaches the hub by mutual TLS. */
  clientPc(deviceId: string): {
    client: HubClient;
    outbox: MemoryOutbox;
    transport: ReturnType<MemoryLan['client']>;
  } {
    const outbox = new MemoryOutbox();
    const source = async (): Promise<CommandSource> => ({ kind: 'pc', deviceId });
    const transport = this.lan.client(deviceId, source);
    const client = new HubClient({
      peers: [this.pc1.address, this.pc2.address],
      transport,
      store: outbox,
      now: () => this.clock.now(),
    });
    return { client, outbox, transport };
  }

  networkCheck(sequence: number, run: string = this.id()): HubCommand {
    return {
      id: this.id(),
      name: 'sync.network_check',
      version: 1,
      payload: { sentAt: this.clock.now().toISOString(), sequence, run },
      deviceTime: this.clock.now().toISOString(),
    };
  }

  openOrder(table = 'T1'): HubCommand {
    return {
      id: this.id(),
      name: 'test.open_order',
      version: 1,
      payload: { orderId: this.id(), table },
      deviceTime: this.clock.now().toISOString(),
    };
  }

  addLine(orderId: string, itemId: string, quantity = 1): HubCommand {
    return {
      id: this.id(),
      name: 'test.add_line',
      version: 1,
      payload: { orderId, lineId: this.id(), itemId, quantity },
      deviceTime: this.clock.now().toISOString(),
    };
  }
}
