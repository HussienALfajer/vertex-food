import { generateKeyPairSync } from 'node:crypto';
import type { CommandEnvelope, HubCommandAnswer } from '@vertex-food/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { signEnvelope } from '../envelope.js';
import { ed25519Signer, ed25519Verifier } from '../node.js';
import {
  appliedLines,
  type TestBranch as Branch,
  type DeviceKeys,
  MEMBERS,
  menu,
  TestBranch,
  type TestPc,
} from '../test-support/branch.js';
import { PowerCut } from '../test-support/memory-store.js';

// Spike A's scenarios in memory (spec S04 "Acceptance", ADR 0022): two hub-capable PCs, a waiter
// phone, a client PC, power cuts, LAN splits and failovers. PR 5 runs them again against the
// encrypted local database, PowerSync and a real PostgreSQL.

const keys = new Map<string, DeviceKeys>();
function keysOf(deviceId: string): DeviceKeys {
  let pair = keys.get(deviceId);
  if (!pair) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const x = publicKey.export({ format: 'jwk' }).x ?? '';
    pair = {
      sign: ed25519Signer(pkcs8),
      verify: ed25519Verifier(Buffer.from(x, 'base64url').toString('base64')),
    };
    keys.set(deviceId, pair);
  }
  return pair;
}

function envelopeOf(answer: HubCommandAnswer): CommandEnvelope {
  if (answer.status !== 'ok' && answer.status !== 'duplicate') {
    throw new Error(`expected an envelope, got ${JSON.stringify(answer)}`);
  }
  return answer.envelope;
}

/** Every acknowledged command is in both PCs' lineage, in the same order. */
function expectSameJournal(branch: Branch): void {
  expect(branch.pc2.store.lineageIds()).toEqual(branch.pc1.store.lineageIds());
}

function uploaded(pc: TestPc): string[] {
  return [...pc.store.data.uploads.keys()];
}

let branch: Branch;

beforeEach(async () => {
  menu.clear();
  appliedLines.clear();
  menu.set('falafel', { priceId: 'price-falafel-1', unitMinor: 1500 });
  branch = new TestBranch(keysOf);
  await branch.startBoth();
});

describe('setup', () => {
  it('starts the configured hub at epoch 1 and the standby in sync', async () => {
    expect(branch.pc1.running.status()).toMatchObject({
      role: 'hub',
      epoch: 1,
      standby: 'in_sync',
    });
    expect(branch.pc2.running.status()).toMatchObject({
      role: 'standby',
      epoch: 1,
      hubDeviceId: branch.pc1.deviceId,
    });
    expect(branch.pc1.running.hello()).toMatchObject({ role: 'hub', epoch: 1, protocol: 1 });
  });

  it('runs a network check from a phone through the hub and the standby', async () => {
    const phone = await branch.pairPhone();
    const command = branch.networkCheck(1);
    await phone.client.send(command);
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 0 });
    const entry = await branch.pc1.store.entry(command.id);
    expect(entry).toMatchObject({ mirrored: true, seq: 3, epoch: 1 });
    // Both PCs journal it and queue it for upload, the hub with `mirrored` beside it.
    expectSameJournal(branch);
    expect(branch.pc1.store.data.uploads.get(command.id)?.mirrored).toBe(true);
    expect(branch.pc2.store.data.uploads.get(command.id)?.mirrored).toBe(true);
    const envelope = branch.pc1.store.data.uploads.get(command.id)?.envelope;
    expect(envelope).toMatchObject({
      originKind: 'hub_client',
      originDeviceId: phone.pairingId,
      executedByDeviceId: branch.pc1.deviceId,
      actor: { kind: 'member', membershipId: MEMBERS.manager, sessionKind: 'hub_client' },
      // A hub client's command takes the hub's clock and offset (PR 1's review).
      deviceTime: branch.clock.now().toISOString(),
      clockOffsetMs: 0,
      hubEpoch: 1,
      hubSeq: 3,
    });
    const snapshot = await branch.pc1.running.liveSnapshot();
    expect(snapshot.networkChecks).toHaveLength(1);
    expect(snapshot.networkChecks[0]?.mirroredAt).not.toBeNull();
    expect(snapshot.clients.map((c) => c.id)).toEqual([phone.pairingId]);
  });
});

describe('offline LAN commands', () => {
  it('numbers orders from the hub’s block and answers a re-sent id with its stored answer', async () => {
    const pc = branch.clientPc(branch.id());
    const command = {
      ...branch.openOrder(),
      actor: { kind: 'member', membershipId: MEMBERS.manager, sessionKind: 'pc' },
    } as const;
    await pc.client.send(command);
    await pc.client.send({ ...branch.openOrder('T2'), actor: command.actor });
    const numbers = [...branch.pc1.store.data.rows.values()]
      .filter((r) => r.name === 'test.open_order')
      .map((r) => (r.resolved as { number: number }).number);
    expect(numbers).toEqual([1, 2]);
    const again = await branch.pc1.running.submit(command, { kind: 'pc', deviceId: branch.id() });
    expect(again.status).toBe('duplicate');
    expect(envelopeOf(again).id).toBe(command.id);
    expectSameJournal(branch);
  });
});

describe('crash between mirror and commit', () => {
  it('takes back the entry the standby holds and answers the retry as a duplicate', async () => {
    const phone = await branch.pairPhone();
    const command = branch.networkCheck(1);
    branch.pc1.store.crashOnNextCommit = true;
    await expect(
      branch.pc1.running.submit(command, {
        kind: 'personal',
        pairingId: phone.pairingId,
        membershipId: MEMBERS.manager,
      }),
    ).rejects.toBeInstanceOf(PowerCut);
    expect(await branch.pc1.store.entry(command.id)).toBeNull();
    expect(await branch.pc2.store.entry(command.id)).not.toBeNull();
    await branch.pc1.restart();
    expect(await branch.pc1.store.entry(command.id)).not.toBeNull();
    await phone.client.send(command);
    expect(phone.outbox.items.size).toBe(0);
    expectSameJournal(branch);
  });
});

describe('power cut on the hub', () => {
  it('fails over to the standby within about 4 s and loses no acknowledged command', async () => {
    const phone = await branch.pairPhone();
    for (let i = 1; i <= 5; i++) await phone.client.send(branch.networkCheck(i));
    const acknowledged = branch.pc1.store.lineageIds();
    branch.pc1.powerOff();
    await branch.run(3500);
    expect(branch.pc2.running.status()).toMatchObject({ role: 'hub', epoch: 2 });
    for (let i = 6; i <= 8; i++) await phone.client.send(branch.networkCheck(i));
    expect(phone.client.hub()?.deviceId).toBe(branch.pc2.deviceId);
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 3 });
    // Orders now come from the standby's block.
    const order = branch.openOrder();
    await phone.client.send(order);
    expect(branch.pc2.store.data.rows.get(order.id)?.resolved).toMatchObject({ number: 5001 });
    await branch.pc1.start();
    await branch.run(1000);
    expect(branch.pc1.running.status()).toMatchObject({
      role: 'standby',
      epoch: 2,
      rejoining: false,
    });
    expectSameJournal(branch);
    expect(branch.pc1.store.lineageIds()).toEqual(expect.arrayContaining(acknowledged));
    expect(uploaded(branch.pc1)).toEqual(
      expect.arrayContaining(
        branch.pc2.store.lineageIds().filter((id) => branch.pc2.store.data.uploads.has(id)),
      ),
    );
  });
});

/** A command from the hub PC's own cashier screen, by its signed-in manager. */
function cashier(pc: TestPc, command: ReturnType<Branch['networkCheck']>) {
  return pc.running.submit(
    { ...command, actor: { kind: 'member', membershipId: MEMBERS.manager, sessionKind: 'pc' } },
    { kind: 'pc', deviceId: pc.deviceId },
  );
}

function phoneId(phone: { pairingId: string }): string {
  return `phone-${phone.pairingId}`;
}

describe('LAN split that isolates the hub', () => {
  it('lets the isolated hub serve its own screen, then hands its entries over on heal', async () => {
    const phone = await branch.pairPhone();
    await phone.client.send(branch.networkCheck(1));
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    branch.lan.cut(branch.pc1.deviceId, phoneId(phone));
    await branch.run(3500);
    expect(branch.pc2.running.status()).toMatchObject({ role: 'hub', epoch: 2 });
    // The isolated hub still serves its own cashier screen, unmirrored.
    const alone = branch.networkCheck(2);
    expect(await cashier(branch.pc1, alone)).toMatchObject({ status: 'ok', mirrored: false });
    await phone.client.send(branch.networkCheck(3));
    expect(phone.client.hub()?.deviceId).toBe(branch.pc2.deviceId);

    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    branch.lan.heal(branch.pc1.deviceId, phoneId(phone));
    await branch.run(1500);
    expect(branch.pc1.running.status()).toMatchObject({
      role: 'standby',
      epoch: 2,
      rejoining: false,
    });
    expect(branch.pc2.running.status()).toMatchObject({ role: 'hub', standby: 'in_sync' });
    expectSameJournal(branch);
    expect(branch.pc2.store.lineageIds()).toContain(alone.id);
    // The forwarded entry keeps its executor's signed envelope; only its place changed.
    const forwarded = await branch.pc2.store.entry(alone.id);
    expect(forwarded?.body.kind === 'command' && forwarded.body.envelope.executedByDeviceId).toBe(
      branch.pc1.deviceId,
    );
    expect(forwarded?.epoch).toBe(2);
    expect(branch.pc1.store.data.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['hub.demoted', 'hub.rejoined']),
    );
  });
});

describe('LAN split that isolates the standby', () => {
  it('lets the higher epoch win on heal, in the other direction', async () => {
    const phone = await branch.pairPhone();
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    branch.lan.cut(branch.pc2.deviceId, phoneId(phone));
    for (let i = 1; i <= 3; i++) await phone.client.send(branch.networkCheck(i));
    await branch.run(3500);
    // The standby cannot tell the hub is alive: it promotes itself.
    expect(branch.pc2.running.status()).toMatchObject({ role: 'hub', epoch: 2 });
    expect(branch.pc1.running.status()).toMatchObject({ role: 'hub', epoch: 1 });
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 3 });

    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    branch.lan.heal(branch.pc2.deviceId, phoneId(phone));
    await branch.run(1500);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'standby', epoch: 2 });
    expectSameJournal(branch);
    // The phone follows the higher epoch; its re-sent versions are duplicates there now.
    await phone.client.send(branch.networkCheck(4));
    expect(phone.client.hub()?.deviceId).toBe(branch.pc2.deviceId);
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 0 });
    expectSameJournal(branch);
  });
});

describe('rejoin cut short', () => {
  it('keeps rejoining, refuses mirrors and never promotes itself until the rejoin completes', async () => {
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    const alone = branch.networkCheck(1);
    await cashier(branch.pc1, alone);
    // The LAN drops between the catch-up and the forward, twice.
    branch.lan.fail(branch.pc1.deviceId, branch.pc2.deviceId, 'forward', 2);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(250);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'rejoining', rejoining: true });
    expect(await branch.pc1.store.entry(alone.id)).toMatchObject({
      ownLineage: true,
      forwardedAt: null,
    });
    expect(await branch.pc2.store.entry(alone.id)).toBeNull();
    // Saved with the role: a restart resumes it too.
    expect(branch.pc1.store.data.state?.rejoining).toBe(true);
    // While rejoining it refuses mirrors: the hub's commands are not copied to it.
    expect(await cashier(branch.pc2, branch.networkCheck(2))).toMatchObject({ mirrored: false });
    await branch.pc1.restart();
    await branch.run(1000);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'standby', rejoining: false });
    expectSameJournal(branch);
    expect(branch.pc2.store.lineageIds()).toContain(alone.id);
  });

  it('says it needs the other PC after three failed tries', async () => {
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    await cashier(branch.pc1, branch.networkCheck(1));
    branch.lan.fail(branch.pc1.deviceId, branch.pc2.deviceId, 'journal', 3);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(250);
    expect(branch.pc1.running.status().notice).toBeNull();
    await branch.run(250);
    expect(branch.pc1.running.status().notice).toBe('needs_other_pc');
    await branch.run(1000);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'standby', notice: null });
  });
});

describe('hub lost after a LAN blip, with re-sent versions', () => {
  it('applies the versions the phone kept instead of resolving them again', async () => {
    const phone = await branch.pairPhone();
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    const orders = [branch.openOrder('T1'), branch.openOrder('T2')];
    for (const order of orders) await phone.client.send(order);
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 2 });
    const versions = orders.map((o) => branch.pc1.store.data.uploads.get(o.id)?.envelope);
    // The hub dies before the LAN heals: the standby never got the two orders.
    branch.pc1.powerOff();
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    expect(branch.pc2.running.status().role).toBe('hub');
    await phone.client.send(branch.networkCheck(1));
    // Applied as the old hub resolved and signed them: numbers 1 and 2 from its block.
    for (const [i, order] of orders.entries()) {
      expect(branch.pc2.store.data.uploads.get(order.id)?.envelope).toEqual(versions[i]);
    }
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 3 });
  });
});

describe('forged re-send', () => {
  it('resolves a tampered or out-of-block version again on the new hub', async () => {
    const phone = await branch.pairPhone();
    const order = branch.openOrder();
    await phone.client.send(order);
    const orderId = String(order.payload.orderId);
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    const line = branch.addLine(orderId, 'falafel', 2);
    const second = branch.openOrder('T9');
    await phone.client.send(line);
    await phone.client.send(second);
    branch.pc1.powerOff();
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);

    // A zero price in the kept version breaks the executor's signature.
    const kept = phone.outbox.items.get(line.id);
    if (kept?.state !== 'unmirrored') throw new Error('expected a kept version');
    phone.outbox.items.set(line.id, {
      ...kept,
      envelope: { ...kept.envelope, resolved: { ...kept.envelope.resolved, unitMinor: 0 } },
    });
    // A validly signed version whose number lies in the other PC's block.
    const other = phone.outbox.items.get(second.id);
    if (other?.state !== 'unmirrored') throw new Error('expected a kept version');
    const { signature: _s, payloadHash: _h, ...unsigned } = other.envelope;
    const forged = signEnvelope(
      { ...unsigned, resolved: { ...unsigned.resolved, number: 7777 } },
      keysOf(branch.pc1.deviceId).sign,
    );
    phone.outbox.items.set(second.id, { ...other, envelope: forged });

    await phone.client.send(branch.networkCheck(1));
    const lineVersion = branch.pc2.store.data.uploads.get(line.id)?.envelope;
    expect(lineVersion?.resolved).toEqual({ priceId: 'price-falafel-1', unitMinor: 1500 });
    expect(lineVersion?.executedByDeviceId).toBe(branch.pc2.deviceId);
    const orderVersion = branch.pc2.store.data.uploads.get(second.id)?.envelope;
    expect(orderVersion?.executedByDeviceId).toBe(branch.pc2.deviceId);
    expect(orderVersion?.resolved).toMatchObject({ number: 5001 });
  });
});

describe('divergence adopted', () => {
  it('replaces the standby’s version of a command the restarted hub resolved again', async () => {
    const phone = await branch.pairPhone();
    const command = branch.networkCheck(1);
    branch.pc1.store.crashOnNextCommit = true;
    await expect(
      branch.pc1.running.submit(command, {
        kind: 'personal',
        pairingId: phone.pairingId,
        membershipId: MEMBERS.manager,
      }),
    ).rejects.toBeInstanceOf(PowerCut);
    const standbyVersion = branch.pc2.store.data.uploads.get(command.id)?.envelope;
    // The hub restarts without its standby, and the client's retry is resolved again.
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.pc1.restart();
    branch.clock.advance(1000);
    await phone.client.send(command);
    const hubVersion = branch.pc1.store.data.uploads.get(command.id)?.envelope;
    expect(hubVersion?.payloadHash).not.toBe(standbyVersion?.payloadHash);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(1000);
    expect(branch.pc2.store.data.uploads.get(command.id)?.envelope).toEqual(hubVersion);
    expect(branch.pc2.store.data.events.map((e) => e.action)).toContain('hub.divergence_adopted');
    expectSameJournal(branch);
  });
});

describe('ten repeated cuts', () => {
  it('loses no acknowledged command across ten power cuts of the live hub', async () => {
    const phone = await branch.pairPhone();
    const sent: string[] = [];
    for (let cut = 0; cut < 10; cut++) {
      for (let i = 0; i < 3; i++) {
        const command = branch.networkCheck(cut * 3 + i + 1);
        sent.push(command.id);
        await phone.client.send(command);
      }
      const hub = branch.hubPc();
      if (!hub) throw new Error('no hub');
      hub.powerOff();
      await branch.run(3500);
      await hub.start();
      await branch.run(1500);
    }
    await phone.client.flush();
    await branch.run(1000);
    expect(await phone.client.counts()).toMatchObject({ sending: 0 });
    expectSameJournal(branch);
    expect(branch.pc1.store.lineageIds()).toEqual(expect.arrayContaining(sent));
    expect(new Set(branch.pc1.store.lineageIds()).size).toBe(branch.pc1.store.lineageIds().length);
  });
});

describe('manual promotion', () => {
  it('promotes the standby by PIN with the missing count, and the old hub rejoins later', async () => {
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await cashier(branch.pc1, branch.networkCheck(1));
    // The standby heard of an entry it lacks, then the hub died: no automatic promotion.
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    branch.lan.fail(branch.pc1.deviceId, branch.pc2.deviceId, 'mirror');
    await branch.run(250);
    branch.pc1.powerOff();
    await branch.run(3500);
    const preview = branch.pc2.running.promotionPreview();
    expect(branch.pc2.running.status().role).toBe('standby');
    expect(preview.missing).toBeGreaterThan(0);
    await expect(
      branch.pc2.running.promoteManually({
        membershipId: MEMBERS.manager,
        pin: '000000',
        acknowledgedMissing: preview.missing,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PIN' });
    await expect(
      branch.pc2.running.promoteManually({
        membershipId: MEMBERS.waiter,
        pin: '135790',
        acknowledgedMissing: preview.missing,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      branch.pc2.running.promoteManually({
        membershipId: MEMBERS.manager,
        pin: '246810',
        acknowledgedMissing: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // S02's lockout on the PC: the owner's PIN is disabled after 5 wrong tries.
    for (let i = 0; i < 5; i++) {
      await expect(
        branch.pc2.running.promoteManually({
          membershipId: MEMBERS.owner,
          pin: '111111',
          acknowledgedMissing: preview.missing,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PIN' });
    }
    await expect(
      branch.pc2.running.promoteManually({
        membershipId: MEMBERS.owner,
        pin: '975310',
        acknowledgedMissing: preview.missing,
      }),
    ).rejects.toMatchObject({ code: 'PIN_DISABLED' });
    await branch.pc2.running.promoteManually({
      membershipId: MEMBERS.manager,
      pin: '246810',
      acknowledgedMissing: preview.missing,
    });
    expect(branch.pc2.running.status()).toMatchObject({ role: 'hub', epoch: 2 });
    expect(branch.pc2.store.data.events.at(-1)).toMatchObject({
      action: 'hub.promoted',
      membershipId: MEMBERS.manager,
      details: { manual: true, fromEpoch: 1, toEpoch: 2 },
    });
    // The entries it lacked come back from the old hub when it rejoins.
    await branch.pc1.start();
    await branch.run(1500);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'standby', epoch: 2 });
    expectSameJournal(branch);
  });

  it('during a pending rejoin, re-adds its own entries after the highest sequence it holds', async () => {
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    const alone = branch.networkCheck(1);
    await cashier(branch.pc1, alone);
    branch.lan.fail(branch.pc1.deviceId, branch.pc2.deviceId, 'forward', 2);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(250);
    expect(branch.pc1.running.status().rejoining).toBe(true);
    // The new hub vanishes before the rejoin completes: only a manager can promote pc1.
    branch.pc2.powerOff();
    await branch.run(4000);
    expect(branch.pc1.running.status().role).toBe('rejoining');
    // It keeps trying while the hub is silent, and says the other PC is needed (rule 27).
    expect(branch.pc1.running.status().notice).toBe('needs_other_pc');
    const held = branch.pc1.running.status().appliedSeq;
    await branch.pc1.running.promoteManually({
      membershipId: MEMBERS.manager,
      pin: '246810',
      acknowledgedMissing: branch.pc1.running.promotionPreview().missing,
    });
    expect(branch.pc1.running.status()).toMatchObject({ role: 'hub', epoch: 3, rejoining: false });
    expect(await branch.pc1.store.entry(alone.id)).toMatchObject({
      seq: held + 1,
      epoch: 3,
      ownLineage: false,
    });
    await branch.pc2.start();
    await branch.run(1500);
    expect(branch.pc2.running.status()).toMatchObject({ role: 'standby', epoch: 3 });
    expectSameJournal(branch);
  });
});

describe('equal-epoch tie-break', () => {
  async function twoHubsAtEpoch2(): Promise<Branch> {
    const split = new TestBranch(keysOf);
    for (const pc of [split.pc1, split.pc2]) {
      await pc.store.transaction((tx) =>
        tx.saveState({
          role: 'hub',
          epoch: 2,
          appliedSeq: 0,
          hubDeviceId: pc.deviceId,
          rejoining: false,
          hubSeq: 0,
          lastHeartbeatAt: null,
          notice: null,
        }),
      );
    }
    split.lan.cut(split.pc1.deviceId, split.pc2.deviceId);
    await split.pc1.start();
    await split.pc2.start();
    await cashier(split.pc1, split.networkCheck(1));
    await cashier(split.pc2, split.networkCheck(2));
    return split;
  }

  it('keeps the hub that more hub clients are connected to', async () => {
    const split = await twoHubsAtEpoch2();
    split.pc2.running.setLiveClients(3);
    split.pc1.running.setLiveClients(1);
    split.lan.heal(split.pc1.deviceId, split.pc2.deviceId);
    await split.run(1500);
    expect(split.pc2.running.status()).toMatchObject({ role: 'hub', epoch: 2 });
    expect(split.pc1.running.status()).toMatchObject({ role: 'standby', epoch: 2 });
    expectSameJournal(split);
    expect(split.pc1.store.lineageIds()).toHaveLength(2);
  });

  it('then keeps the lower device id', async () => {
    const split = await twoHubsAtEpoch2();
    split.lan.heal(split.pc1.deviceId, split.pc2.deviceId);
    await split.run(1500);
    expect(split.pc1.deviceId < split.pc2.deviceId).toBe(true);
    expect(split.pc1.running.status().role).toBe('hub');
    expect(split.pc2.running.status().role).toBe('standby');
    expectSameJournal(split);
  });
});

describe('standby too far behind', () => {
  it('cannot catch up offline, still forwards its own entries, and rejoins after a server sync', async () => {
    branch.pc2.powerOff();
    for (let day = 0; day < 10; day++) {
      await cashier(branch.pc1, branch.networkCheck(day + 1));
      branch.clock.advance(24 * 60 * 60 * 1000);
      await branch.run(250);
    }
    for (const id of branch.pc1.store.lineageIds()) branch.pc1.store.data.settled.add(id);
    expect(await branch.pc1.running.pruneJournal()).toBeGreaterThan(0);
    await branch.pc2.start();
    await branch.run(1000);
    expect(branch.pc2.running.status()).toMatchObject({
      notice: 'too_far_behind',
      rejoining: true,
    });
    await branch.run(5000);
    // It never promotes itself, and the hub still runs commands.
    expect(branch.pc2.running.status().role).toBe('rejoining');
    await branch.pc2.running.rejoinAfterServerSync();
    await branch.run(1000);
    expect(branch.pc2.running.status()).toMatchObject({ role: 'standby', notice: null });
    expect(branch.pc1.running.status().standby).toBe('in_sync');
  });
});

describe('a client PC following a failover', () => {
  it('sends its own device commands and follows the standby when the hub dies', async () => {
    const deviceId = branch.id();
    const pc3 = branch.clientPc(deviceId);
    const events = {
      id: branch.id(),
      name: 'audit.record_local_events',
      version: 1,
      payload: {
        events: [
          { action: 'staff_pin.failed_offline', at: branch.clock.now().toISOString(), details: {} },
        ],
      },
      deviceTime: branch.clock.now().toISOString(),
      actor: { kind: 'device' },
    } as const;
    await pc3.client.send(events);
    expect(branch.pc1.store.data.uploads.get(events.id)?.envelope).toMatchObject({
      originKind: 'pc',
      originDeviceId: deviceId,
      actor: { kind: 'device' },
    });
    branch.pc1.powerOff();
    await branch.run(3500);
    const check = {
      ...branch.networkCheck(1),
      actor: { kind: 'member', membershipId: MEMBERS.manager, sessionKind: 'pc' },
    } as const;
    await pc3.client.send(check);
    expect(pc3.client.hub()?.deviceId).toBe(branch.pc2.deviceId);
    expect(await branch.pc2.store.entry(check.id)).not.toBeNull();
  });
});

describe('both PCs down', () => {
  it('keeps the phone’s commands as sending until a PC returns', async () => {
    const phone = await branch.pairPhone();
    await phone.client.send(branch.networkCheck(1));
    branch.pc1.powerOff();
    branch.pc2.powerOff();
    const waiting = [branch.networkCheck(2), branch.networkCheck(3)];
    for (const command of waiting) await phone.client.send(command);
    expect(await phone.client.counts()).toEqual({ sending: 2, unmirrored: 0 });
    await branch.pc2.start();
    await branch.run(3500);
    expect(branch.pc2.running.status().role).toBe('hub');
    await phone.client.flush();
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 2 });
    for (const command of waiting) expect(await branch.pc2.store.entry(command.id)).not.toBeNull();
  });
});

describe('revoked hub', () => {
  it('stops serving once it learns its revocation, and the standby takes over', async () => {
    const phone = await branch.pairPhone();
    await branch.pc1.running.retire();
    expect(await cashier(branch.pc1, branch.networkCheck(1))).toMatchObject({ status: 'not_hub' });
    await branch.run(3500);
    expect(branch.pc2.running.status().role).toBe('hub');
    await phone.client.send(branch.networkCheck(2));
    expect(phone.client.hub()?.deviceId).toBe(branch.pc2.deviceId);
  });
});

describe('protocol mismatch between peers', () => {
  it('talks to a peer one version apart and stops mirroring to one further away', async () => {
    const near = new TestBranch(keysOf);
    near.pc2.protocol = 2;
    await near.startBoth();
    expect(near.pc1.running.status().standby).toBe('in_sync');

    const far = new TestBranch(keysOf);
    far.pc2.protocol = 3;
    await far.startBoth();
    expect(await cashier(far.pc1, far.networkCheck(1))).toMatchObject({
      status: 'ok',
      mirrored: false,
    });
    expect(far.pc1.running.status().standby).toBe('not_in_sync');
    // Its heartbeats still say the hub is alive: the standby never promotes itself meanwhile.
    await far.run(5000);
    expect(far.pc2.running.status().role).toBe('standby');
    // It never heard what the hub holds, so only a manager may promote it.
    far.pc1.powerOff();
    await far.run(3500);
    expect(far.pc2.running.status().role).toBe('standby');
  });
});

describe('numbering on the hub (rules 18, 19)', () => {
  const numberOf = (pc: TestPc, id: string) => pc.store.data.rows.get(id)?.resolved;

  it('keeps counting after a restart and gives a provisional label once the block is used up', async () => {
    const [today] = [...branch.pc1.store.data.blocks.values()];
    if (!today) throw new Error('no block');
    today.lastUsed = 4997;
    const first = branch.openOrder();
    await cashier(branch.pc1, first);
    await branch.pc1.restart();
    await branch.run(500);
    const second = branch.openOrder();
    const third = branch.openOrder();
    await cashier(branch.pc1, second);
    await cashier(branch.pc1, third);
    expect(numberOf(branch.pc1, first.id)).toMatchObject({ number: 4998, label: null });
    expect(numberOf(branch.pc1, second.id)).toMatchObject({ number: 4999, label: null });
    expect(numberOf(branch.pc1, third.id)).toMatchObject({
      number: null,
      label: `#${third.id.slice(-4)}`,
    });
  });

  it('numbers from the block of the order’s business date, and labels a date it has no block for', async () => {
    branch.clock.advance(8 * 24 * 60 * 60 * 1000);
    const order = branch.openOrder();
    await cashier(branch.pc1, order);
    expect(numberOf(branch.pc1, order.id)).toMatchObject({
      number: null,
      label: `#${order.id.slice(-4)}`,
    });
  });
});

describe('journal retention (rule 29)', () => {
  it('keeps unsettled and recent entries, and the latest one', async () => {
    for (let i = 1; i <= 3; i++) await cashier(branch.pc1, branch.networkCheck(i));
    branch.clock.advance(8 * 24 * 60 * 60 * 1000);
    expect(await branch.pc1.running.pruneJournal()).toBe(0);
    const ids = branch.pc1.store.lineageIds();
    branch.pc1.store.data.settled.add(ids[0] ?? '');
    branch.pc1.store.data.settled.add(ids[2] ?? '');
    // The first is dropped; the second is not settled, so nothing after it goes either.
    expect(await branch.pc1.running.pruneJournal()).toBe(1);
    expect(branch.pc1.store.lineageIds()).toEqual(ids.slice(1));
  });
});

describe('the live snapshot (rule 32)', () => {
  it('reports the hub, its standby and a change on every command', async () => {
    let changes = 0;
    const stop = branch.pc1.running.onChange(() => {
      changes += 1;
    });
    await cashier(branch.pc1, branch.networkCheck(1));
    expect(changes).toBeGreaterThan(0);
    stop();
    expect((await branch.pc1.running.liveSnapshot()).hub).toEqual({
      deviceId: branch.pc1.deviceId,
      role: 'hub',
      epoch: 1,
      standby: 'in_sync',
      connectivity: 'offline',
    });
    branch.pc2.powerOff();
    await cashier(branch.pc1, branch.networkCheck(2));
    expect((await branch.pc1.running.liveSnapshot()).hub.standby).toBe('not_in_sync');
  });
});

describe('review findings of PR 2', () => {
  it('applies a kept version whose PIN session the new hub never saw', async () => {
    const phone = await branch.pairPhone();
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    // The member signs in again during the cut: that session exists on the hub only.
    const pairing = await branch.pc1.running.pairing.authenticate(phone.pairingToken);
    if (!pairing) throw new Error('paired');
    const session = await branch.pc1.running.pairing.startSession(pairing, {
      membershipId: MEMBERS.manager,
      pin: '246810',
    });
    phone.sessionToken = session.token;
    const orders = [branch.openOrder('T1'), branch.openOrder('T2')];
    for (const order of orders) await phone.client.send(order);
    branch.pc1.powerOff();
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    // 3 s without the live stream: the phone looks for the hub again (rule 30).
    phone.client.checkLive();
    await phone.client.flush();
    expect(phone.refused).toEqual([]);
    for (const order of orders) {
      expect(branch.pc2.store.data.uploads.get(order.id)?.envelope.executedByDeviceId).toBe(
        branch.pc1.deviceId,
      );
    }
    expect(await phone.client.counts()).toMatchObject({ unmirrored: 2 });
  });

  it('catches a standby up that misses more than one batch of entries', async () => {
    branch.pc2.powerOff();
    for (let i = 1; i <= 620; i++) await cashier(branch.pc1, branch.networkCheck(i));
    await branch.pc2.start();
    await branch.run(1500);
    expect(branch.pc1.running.status().standby).toBe('in_sync');
    expectSameJournal(branch);
    expect(branch.pc2.store.lineageIds()).toHaveLength(620);
  });

  it('rejoins over several pages of the hub’s journal', async () => {
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    for (let i = 1; i <= 600; i++) await cashier(branch.pc2, branch.networkCheck(i));
    const alone = branch.networkCheck(9999);
    await cashier(branch.pc1, alone);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(2000);
    expect(branch.pc1.running.status()).toMatchObject({ role: 'standby', rejoining: false });
    expectSameJournal(branch);
    expect(branch.pc2.store.lineageIds()).toContain(alone.id);
  });

  it('never gives one number twice when a lost commit comes back', async () => {
    const phone = await branch.pairPhone();
    const first = branch.openOrder('T1');
    branch.pc1.store.crashOnNextCommit = true;
    await expect(
      branch.pc1.running.submit(first, {
        kind: 'personal',
        pairingId: phone.pairingId,
        membershipId: MEMBERS.manager,
      }),
    ).rejects.toBeInstanceOf(PowerCut);
    // The hub restarts without its standby and numbers another order.
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.pc1.restart();
    const second = branch.openOrder('T2');
    await phone.client.send(second);
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(1500);
    const numbers = [first, second].map(
      (o) =>
        (branch.pc1.store.data.rows.get(o.id)?.resolved as { number?: number } | undefined)?.number,
    );
    expect(new Set(numbers).size).toBe(2);
    expectSameJournal(branch);
  });

  it('refuses a command whose resolve fails and goes on with the next one', async () => {
    const phone = await branch.pairPhone();
    const order = branch.openOrder();
    await phone.client.send(order);
    const bad = branch.addLine(String(order.payload.orderId), 'no-such-item');
    const next = branch.networkCheck(1);
    await phone.client.send(bad);
    await phone.client.send(next);
    expect(phone.refused).toEqual([{ id: bad.id, reason: 'payload_invalid' }]);
    expect(await branch.pc1.store.entry(bad.id)).toBeNull();
    expect(await branch.pc1.store.entry(next.id)).not.toBeNull();
  });

  it('finds the shared lineage from below, so an entry the hub lacks under a match is forwarded', async () => {
    const phone = await branch.pairPhone();
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    // pc1 takes B alone, then the phone's C; both unmirrored. Then pc1 dies.
    const b = branch.networkCheck(1);
    await cashier(branch.pc1, b);
    const c = branch.networkCheck(2);
    await phone.client.send(c);
    branch.pc1.powerOff();
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(3500);
    // pc2 runs X at the number of B, and the phone's re-sent C lands at the number of C.
    const x = branch.networkCheck(3);
    await cashier(branch.pc2, x);
    phone.client.checkLive();
    await phone.client.flush();
    const atB = (await branch.pc1.store.entry(b.id))?.seq;
    expect((await branch.pc2.store.entry(x.id))?.seq).toBe(atB);
    expect((await branch.pc2.store.entry(c.id))?.seq).toBe(
      (await branch.pc1.store.entry(c.id))?.seq,
    );
    await branch.pc1.start();
    await branch.run(1500);
    expectSameJournal(branch);
    expect(branch.pc2.store.lineageIds()).toEqual(expect.arrayContaining([b.id, c.id, x.id]));
    const seqs = [...branch.pc1.store.data.journal.values()]
      .filter((e) => !e.ownLineage)
      .map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
