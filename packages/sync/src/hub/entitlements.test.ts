import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandRegistry } from '../commands/index.js';
import { ed25519Signer, ed25519Verifier } from '../node.js';
import { type DeviceKeys, MEMBERS, TestBranch } from '../test-support/branch.js';

// The hub's entitlement check (spec S05 rule 24): a command whose feature the branch's last synced
// copy shows off at its effective time is refused locally, `not_entitled`, and nothing is written;
// a newer copy lets it through. The server never rejects for it (rule 25, apps/api).

const keys = new Map<string, DeviceKeys>();
function keysOf(deviceId: string): DeviceKeys {
  let pair = keys.get(deviceId);
  if (!pair) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    pair = {
      sign: ed25519Signer(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')),
      verify: ed25519Verifier(
        Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('base64'),
      ),
    };
    keys.set(deviceId, pair);
  }
  return pair;
}

let branch: TestBranch;

beforeEach(async () => {
  branch = new TestBranch(keysOf);
  await branch.startBoth();
});

const hub = () => branch.pc1.running;

async function stationSource() {
  const station = await branch.pairPhone({ kind: 'station', name: 'شاشة المطبخ 1' });
  const pairing = await hub().pairing.authenticate(station.pairingToken);
  if (!pairing) throw new Error('paired');
  return hub().sourceOfPairing(pairing, null);
}

const ticketReady = () => ({
  id: branch.id(),
  name: 'test.ticket_ready',
  version: 1,
  payload: { ticket: 'T-1' },
  deviceTime: branch.clock.now().toISOString(),
});

describe('the hub’s entitlement check (rule 24)', () => {
  it('refuses a command of a feature the copy does not list, and writes nothing', async () => {
    branch.entitledFeatures = [{ key: 'pos', until: null }];
    const source = await stationSource();
    const command = ticketReady();
    const journal = branch.pc1.store.data.journal.size;
    expect(await hub().submit(command, source)).toEqual({
      status: 'refused',
      reason: 'not_entitled',
    });
    expect(branch.pc1.store.data.journal.size).toBe(journal);
    // The newer copy arrives through the stream: the next command passes.
    branch.entitledFeatures = [{ key: 'kitchen_display', until: null }];
    expect(await hub().submit(ticketReady(), source)).toMatchObject({ status: 'ok' });
  });

  it('refuses once a scheduled removal’s time has come, at the hub’s clock', async () => {
    const until = new Date(branch.clock.now().getTime() + 60_000);
    branch.entitledFeatures = [{ key: 'kitchen_display', until: until.toISOString() }];
    const source = await stationSource();
    expect(await hub().submit(ticketReady(), source)).toMatchObject({ status: 'ok' });
    branch.clock.advance(60_000);
    expect(await hub().submit(ticketReady(), source)).toEqual({
      status: 'refused',
      reason: 'not_entitled',
    });
  });

  it('never checks a platform command, which every package has', async () => {
    branch.entitledFeatures = [];
    for (const definition of commandRegistry.definitions()) expect(definition.feature).toBeNull();
    const command = {
      ...branch.networkCheck(1),
      actor: { kind: 'member' as const, membershipId: MEMBERS.manager, sessionKind: 'pc' as const },
    };
    const source = { kind: 'pc' as const, deviceId: branch.pc1.deviceId };
    expect(await hub().submit(command, source)).toMatchObject({ status: 'ok' });
  });
});
