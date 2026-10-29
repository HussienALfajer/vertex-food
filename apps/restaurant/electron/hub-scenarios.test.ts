import { get } from 'node:http';
import { request } from 'node:https';
import {
  type HubCommand,
  type HubPairResult,
  hubLiveSnapshotSchema,
  hubPairResultSchema,
  hubSessionSchema,
} from '@vertex-food/contracts';
import { HubClient, type OutboxItem, type OutboxStore } from '@vertex-food/sync';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBranchCa,
  eventually,
  issuePcCertificate,
  LoopbackBranch,
  MANAGER,
  phoneCall,
  phoneTransport,
  type TestPc,
  testMembers,
  WAITER,
} from './hub-test-kit.js';
import { uuidv7 } from './uuid.js';

// The hub on the real ports (spec S04 "Tests", rules 21–42): PCs on loopback addresses with their
// encrypted databases, HTTPS with the branch CA, mutual TLS between PCs, a phone paired over the
// LAN API, a power cut on the hub, a client PC, and a promotion by PIN. The protocol's own
// scenarios (splits, divergence, ten cuts…) run in memory in `packages/sync`; these check that the
// same hub holds on this PC's database, server and certificates, on real time.

class MemoryOutbox implements OutboxStore {
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

let branch: LoopbackBranch;

afterEach(async () => {
  await branch?.stopAll();
});

function runtime(pc: TestPc) {
  if (!pc.runtime) throw new Error('The PC is off');
  return pc.runtime;
}

async function journalIds(pc: TestPc): Promise<string[]> {
  const rows = await pc.local?.reads.getAll<{ id: string }>(
    "SELECT id FROM hub_journal WHERE kind = 'command' AND own_lineage = 0 ORDER BY seq",
  );
  return (rows ?? []).map((row) => row.id);
}

async function role(pc: TestPc): Promise<string | undefined> {
  return (await runtime(pc).view([])).status?.role;
}

function networkCheck(sequence: number, run: string): HubCommand {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    name: 'sync.network_check',
    version: 1,
    payload: { sentAt: now, sequence, run },
    deviceTime: now,
  };
}

/** Opens pairing on `hub`, pairs a phone and signs the manager in on it. */
async function pairPhone(hub: TestPc): Promise<{ pair: HubPairResult; session: string }> {
  const opened = await runtime(hub).openPairing({ kind: 'personal', name: 'هاتف الصالة' });
  const ca = branch.ca.certificate;
  const pair = await phoneCall(branch.url(hub, '/hub/pair'), {
    ca,
    method: 'POST',
    body: { code: opened.code },
  });
  expect(pair.status).toBe(200);
  const paired = hubPairResultSchema.parse(pair.body);
  const session = await phoneCall(branch.url(hub, '/hub/sessions'), {
    ca,
    method: 'POST',
    body: { membershipId: MANAGER, pin: '246810' },
    headers: { authorization: `Bearer ${paired.token}` },
  });
  expect(session.status).toBe(200);
  return { pair: paired, session: hubSessionSchema.parse(session.body).token };
}

function phoneClient(pair: HubPairResult, session: string): HubClient {
  return new HubClient({
    peers: pair.peers,
    transport: phoneTransport(branch, { token: pair.token, session }),
    store: new MemoryOutbox(),
    now: () => new Date(),
  });
}

/** The first snapshot of `GET /hub/live`. */
function firstSnapshot(pc: TestPc, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      branch.url(pc, '/hub/live'),
      { ca: branch.ca.certificate, agent: false, headers: { authorization: `Bearer ${token}` } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
          const end = text.indexOf('\n\n');
          if (end < 0) return;
          req.destroy();
          resolve(JSON.parse(text.slice(0, end).replace(/^data: /, '')));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** A live stream left open: `opened` at its first snapshot, `ended` when the hub closes it. */
function liveStream(pc: TestPc, token: string): { opened: Promise<void>; ended: Promise<void> } {
  let open: () => void = () => undefined;
  let end: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  const req = request(
    branch.url(pc, '/hub/live'),
    { ca: branch.ca.certificate, agent: false, headers: { authorization: `Bearer ${token}` } },
    (res) => {
      res.on('data', () => open());
      res.on('end', () => end());
      res.on('close', () => end());
    },
  );
  req.on('error', () => end());
  req.end();
  return { opened, ended };
}

function plainGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

// `pnpm test:electron` runs this file again in Electron's own Node (BoringSSL, its module ABI).
it.runIf(process.env.VERTEX_FOOD_ELECTRON_RUNTIME === '1')("runs in Electron's runtime", () => {
  expect(process.versions.electron).toBeDefined();
});

// Failovers wait out the 3 s of silence before a promotion, on real time.
describe('the branch hub on the real ports', { timeout: 30_000 }, () => {
  it('starts in sync, pairs a phone over HTTPS and runs its network check on both PCs', async () => {
    branch = await LoopbackBranch.create();
    const pc1 = await branch.addPc('hub', '127.0.0.11');
    const pc2 = await branch.addPc('standby', '127.0.0.12');
    await branch.start(pc1);
    await branch.start(pc2);
    await eventually(
      'the standby in sync',
      async () => (await runtime(pc1).view([])).status?.standby === 'in_sync',
    );
    expect(await role(pc1)).toBe('hub');
    expect(await role(pc2)).toBe('standby');
    expect(runtime(pc1).live()).toEqual({ liveRole: 'hub', hubEpoch: 1, standbyInSync: true });
    expect(runtime(pc2).live()).toMatchObject({ liveRole: 'standby', standbyInSync: null });

    const ca = branch.ca.certificate;
    // Unpaired requests get 401; the CA is served only while pairing is open (rules 34, 37).
    expect((await phoneCall(branch.url(pc1, '/hub/hello'), { ca })).status).toBe(401);
    const caUrl = `http://${pc1.address}:${branch.caPort}/ca.crt`;
    expect((await plainGet(caUrl)).status).toBe(404);
    const opened = await runtime(pc1).openPairing({ kind: 'personal', name: 'هاتف الصالة' });
    expect(opened.caFingerprint).toBe(branch.ca.fingerprint);
    expect(opened.pairingUrl).toContain(`/pair#peers=${pc1.address},${pc2.address}&fp=`);
    expect(await plainGet(caUrl)).toEqual({ status: 200, body: ca });
    const wrong = await phoneCall(branch.url(pc1, '/hub/pair'), {
      ca,
      method: 'POST',
      body: { code: opened.code === '000000' ? '111111' : '000000' },
    });
    expect(wrong).toMatchObject({ status: 401, body: { code: 'PAIRING_CODE_INVALID' } });
    runtime(pc1).closePairing();
    expect((await plainGet(caUrl)).status).toBe(404);
    // The address waits 1 s after a wrong code (rule 33).
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { pair, session } = await pairPhone(pc1);
    expect(pair.peers).toEqual([pc1.address, pc2.address]);
    const auth = { authorization: `Bearer ${pair.token}` };
    const members = await phoneCall(branch.url(pc1, '/hub/members'), { ca, headers: auth });
    expect(JSON.stringify(members.body)).not.toContain('pin:');

    const phone = phoneClient(pair, session);
    const run = uuidv7();
    const command = networkCheck(1, run);
    await phone.send(command);
    expect(await phone.counts()).toEqual({ sending: 0, unmirrored: 0 });
    expect(await journalIds(pc1)).toEqual([command.id]);
    expect(await journalIds(pc2)).toEqual([command.id]);

    const snapshot = hubLiveSnapshotSchema.parse(await firstSnapshot(pc1, pair.token));
    expect(snapshot.hub).toMatchObject({ role: 'hub', epoch: 1, standby: 'in_sync' });
    expect(snapshot.networkChecks.map((check) => check.commandId)).toEqual([command.id]);
    expect(snapshot.clients.map((client) => client.id)).toEqual([pair.pairingId]);

    // The hub client pages, under the renderer's policy with both PCs' origins.
    const page = await phoneCall(branch.url(pc1, '/pair'), { ca });
    expect(page.status).toBe(200);
    expect(String(page.headers['content-security-policy'])).toContain(
      `connect-src 'self' https://${pc1.address}:${branch.port} https://${pc2.address}:${branch.port}`,
    );
  });

  it('refuses a peer certificate of another CA, of a revoked PC, and of a PC that is no peer', async () => {
    branch = await LoopbackBranch.create();
    const pc1 = await branch.addPc('hub', '127.0.0.21');
    const pc2 = await branch.addPc('standby', '127.0.0.22');
    const pc3 = await branch.addPc(null, '127.0.0.23');
    await branch.start(pc1);
    const ca = branch.ca.certificate;
    const state = (cert: { key: string; cert: string } | undefined, from: string) =>
      phoneCall(branch.pcUrl(pc1, '/peer/state'), {
        ca,
        method: 'POST',
        body: { protocol: 1, from, epoch: 0 },
        ...(cert ? { cert } : {}),
      });
    const asPc = (pc: TestPc) => ({
      key: pc.certificate.privateKey,
      cert: pc.certificate.certificate,
    });

    expect((await state(asPc(pc2), pc2.deviceId)).status).toBe(200);
    // A peer speaks only for itself.
    expect((await state(asPc(pc2), pc3.deviceId)).status).toBe(403);
    // A client PC reaches the hub's API, never its peer routes.
    expect((await state(asPc(pc3), pc3.deviceId)).status).toBe(403);
    const hello = await phoneCall(branch.pcUrl(pc1, '/hub/hello'), { ca, cert: asPc(pc3) });
    expect(hello).toMatchObject({ status: 200, body: { deviceId: pc1.deviceId, role: 'hub' } });
    // The PCs' port takes no handshake without a certificate of the branch CA: none, or one of
    // another CA naming the standby.
    await expect(state(undefined, pc2.deviceId)).rejects.toThrow();
    const rogue = await issuePcCertificate(await createBranchCa(), pc2.deviceId, [pc2.address]);
    await expect(
      state({ key: rogue.privateKey, cert: rogue.certificate }, pc2.deviceId),
    ).rejects.toThrow();
    // The phones' port asks for no certificate and serves no peer route; a PC is unknown there.
    const peerOnPhonePort = await phoneCall(branch.url(pc1, '/peer/state'), {
      ca,
      method: 'POST',
      body: { protocol: 1, from: pc2.deviceId, epoch: 0 },
      cert: asPc(pc2),
    });
    expect(peerOnPhonePort.status).toBe(404);
    const helloOnPhonePort = await phoneCall(branch.url(pc1, '/hub/hello'), {
      ca,
      cert: asPc(pc3),
    });
    expect(helloOnPhonePort.status).toBe(401);
    // Revoked: refused as soon as the synced device list says so (rule 42).
    await branch.revoke(pc2);
    expect((await state(asPc(pc2), pc2.deviceId)).status).toBe(403);
  });

  it('fails over to the standby on a power cut, and the old hub rejoins with every command', async () => {
    branch = await LoopbackBranch.create();
    const pc1 = await branch.addPc('hub', '127.0.0.31');
    const pc2 = await branch.addPc('standby', '127.0.0.32');
    await branch.start(pc1);
    await branch.start(pc2);
    await eventually(
      'the standby in sync',
      async () => (await runtime(pc1).view([])).status?.standby === 'in_sync',
    );
    const { pair, session } = await pairPhone(pc1);
    const phone = phoneClient(pair, session);
    const run = uuidv7();
    const sent: string[] = [];
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      const command = networkCheck(sequence, run);
      sent.push(command.id);
      await phone.send(command);
    }
    expect(await phone.counts()).toEqual({ sending: 0, unmirrored: 0 });

    await branch.powerOff(pc1);
    const afterCut = networkCheck(21, run);
    sent.push(afterCut.id);
    await phone.send(afterCut);
    // "Sending" until the standby promotes itself after 3 s of silence (rule 22).
    expect((await phone.counts()).sending).toBe(1);
    await eventually('the standby promoted', async () => (await role(pc2)) === 'hub');
    expect(runtime(pc2).live()).toMatchObject({ liveRole: 'hub', hubEpoch: 2 });
    await eventually('the phone followed the failover', async () => {
      await phone.flush();
      return (await phone.counts()).sending === 0;
    });
    expect(phone.hub()).toMatchObject({ address: pc2.address, epoch: 2 });

    await branch.start(pc1);
    await eventually(
      'the old hub rejoined as standby',
      async () => (await role(pc1)) === 'standby',
    );
    await eventually('the old hub caught up', async () => {
      const ids = await journalIds(pc1);
      return sent.every((id) => ids.includes(id));
    });
    expect(await journalIds(pc1)).toEqual(await journalIds(pc2));

    // The promotion's audit event leaves as one `audit.record_local_events` command (spec "Audit").
    const events = async () =>
      (await pc2.local?.reads.getAll<{ action: string }>('SELECT action FROM local_events')) ?? [];
    expect((await events()).map((e) => e.action)).toContain('hub.promoted');
    await runtime(pc2).sendLocalEvents();
    await runtime(pc2).sendLocalEvents();
    expect(await events()).toEqual([]);
    const audit = await pc2.local?.reads.getAll<{ id: string }>(
      "SELECT id FROM hub_journal WHERE name = 'audit.record_local_events'",
    );
    expect(audit).toHaveLength(1);
  });

  it('runs a client PC through the hub, and promotes the standby by a manager PIN', async () => {
    branch = await LoopbackBranch.create();
    const pc1 = await branch.addPc('hub', '127.0.0.41');
    const pc2 = await branch.addPc('standby', '127.0.0.42');
    const pc3 = await branch.addPc(null, '127.0.0.43');
    await branch.start(pc1);
    await branch.start(pc2);
    await branch.start(pc3);
    await eventually(
      'the standby in sync',
      async () => (await runtime(pc1).view([])).status?.standby === 'in_sync',
    );
    expect((await runtime(pc3).view([])).status).toBeNull();
    expect(runtime(pc3).live()).toEqual({ liveRole: 'client', hubEpoch: 0, standbyInSync: null });

    // A client PC's command goes through its outbox to the hub by mutual TLS.
    const id = await runtime(pc3).sendNetworkCheck({ run: uuidv7(), sequence: 1 });
    await eventually('the client PC sent it', async () => (await journalIds(pc1)).includes(id));
    await eventually(
      'the client PC outbox emptied',
      async () => (await runtime(pc3).view([])).outbox.sending === 0,
    );
    // A member without `hub.manage` sends no network check (rule 36).
    pc3.session = null;
    await expect(runtime(pc3).sendNetworkCheck({ run: uuidv7(), sequence: 2 })).rejects.toThrow();

    // Rule 27: a wrong PIN changes nothing; the manager's PIN makes the standby the hub.
    await expect(
      runtime(pc2).promote({ membershipId: MANAGER, pin: '000000', acknowledgedMissing: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_PIN' });
    expect(runtime(pc2).promotionPreview()).toEqual({ missing: 0, rejoining: false });
    await runtime(pc2).promote({ membershipId: MANAGER, pin: '246810', acknowledgedMissing: 0 });
    expect(await role(pc2)).toBe('hub');
    await eventually('the old hub demoted', async () => (await role(pc1)) === 'standby');
    const after = await runtime(pc3)
      .sendNetworkCheck({ run: uuidv7(), sequence: 3 })
      .catch(() => null);
    expect(after).toBeNull();
    pc3.session = MANAGER;
    const next = await runtime(pc3).sendNetworkCheck({ run: uuidv7(), sequence: 4 });
    await eventually('the client PC followed the new hub', async () =>
      (await journalIds(pc2)).includes(next),
    );
  });

  it("closes a revoked pairing's live stream, and records a refused command of a client PC", async () => {
    branch = await LoopbackBranch.create();
    const pc1 = await branch.addPc('hub', '127.0.0.51');
    const pc3 = await branch.addPc(null, '127.0.0.53');
    await branch.start(pc1);
    const { pair } = await pairPhone(pc1);
    const live = liveStream(pc1, pair.token);
    await live.opened;
    // Rule 34: a stolen phone's pairing revoked; its open stream ends at once.
    await runtime(pc1).revokePairing(pair.pairingId);
    await live.ended;
    const after = await phoneCall(branch.url(pc1, '/hub/hello'), {
      ca: branch.ca.certificate,
      headers: { authorization: `Bearer ${pair.token}` },
    });
    expect(after.status).toBe(401);

    // The client PC's list still grants the waiter `hub.manage`; the hub's does not (rule 6).
    const stale = testMembers.map((m) =>
      m.membershipId === WAITER ? { ...m, permissions: ['hub.manage' as const] } : m,
    );
    await branch.start(pc3, {
      device: {
        members: () => stale,
        clock: () => null,
        checkPin: async () => 'invalid',
        sessionMember: () => WAITER,
        afterOfflineWindow: () => false,
      },
    });
    const id = await runtime(pc3).sendNetworkCheck({ run: uuidv7(), sequence: 1 });
    const result = async () =>
      pc3.local?.reads.getOptional<{ outcome: string; reason: string }>(
        'SELECT outcome, reason FROM command_results WHERE id = ?',
        [id],
      );
    await eventually('the refusal recorded', async () => (await result())?.outcome === 'refused');
    expect(await result()).toEqual({ outcome: 'refused', reason: 'permission_missing' });
    expect((await runtime(pc3).view([])).outbox.sending).toBe(0);
    expect(await journalIds(pc1)).not.toContain(id);
  });
});
