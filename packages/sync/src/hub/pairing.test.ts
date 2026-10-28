import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ed25519Signer, ed25519Verifier } from '../node.js';
import { type DeviceKeys, MEMBERS, TestBranch } from '../test-support/branch.js';

// Pairing and PIN sessions on the hub (spec S04 rules 33–36): offline, on the LAN only.

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
const standby = () => branch.pc2.running;

describe('the pairing window (rule 33)', () => {
  it('is closed by default and opens only for a member with hub.manage', async () => {
    await expect(hub().pairing.pair('482913', '192.168.1.50')).rejects.toMatchObject({
      code: 'PAIRING_CLOSED',
    });
    await expect(
      hub().pairing.open({ kind: 'personal', name: 'هاتف الصالة' }, MEMBERS.waiter),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      standby().pairing.open({ kind: 'personal', name: 'هاتف الصالة' }, MEMBERS.manager),
    ).rejects.toMatchObject({ code: 'NOT_HUB' });
    const { code, closesAt } = await hub().pairing.open(
      { kind: 'personal', name: 'هاتف الصالة' },
      MEMBERS.manager,
    );
    expect(code).toMatch(/^\d{6}$/);
    expect(closesAt.getTime() - branch.clock.now().getTime()).toBe(120_000);
    expect(hub().pairing.isOpen()).toBe(true);
    expect(branch.pc1.store.data.events.at(-1)).toMatchObject({
      action: 'hub_pairing.opened',
      membershipId: MEMBERS.manager,
    });
  });

  it('closes after 2 minutes', async () => {
    const { code } = await hub().pairing.open(
      { kind: 'station', name: 'شاشة المطبخ 1' },
      MEMBERS.manager,
    );
    branch.clock.advance(120_000);
    expect(hub().pairing.isOpen()).toBe(false);
    await expect(hub().pairing.pair(code, '192.168.1.50')).rejects.toMatchObject({
      code: 'PAIRING_CLOSED',
    });
  });

  it('makes an address wait 1, 2, 4 s after wrong codes and closes after 5 of them', async () => {
    const { code } = await hub().pairing.open({ kind: 'personal', name: 'هاتف' }, MEMBERS.manager);
    const address = '192.168.1.50';
    await expect(hub().pairing.pair('000000', address)).rejects.toMatchObject({
      code: 'PAIRING_CODE_INVALID',
    });
    await expect(hub().pairing.pair(code, address)).rejects.toMatchObject({
      code: 'PAIRING_LOCKED',
      details: { retryAfterSeconds: 1 },
    });
    branch.clock.advance(1000);
    await expect(hub().pairing.pair('000001', address)).rejects.toMatchObject({
      code: 'PAIRING_CODE_INVALID',
    });
    await expect(hub().pairing.pair(code, address)).rejects.toMatchObject({
      details: { retryAfterSeconds: 2 },
    });
    // Three more wrong codes from other addresses close the window.
    for (const other of ['192.168.1.51', '192.168.1.52', '192.168.1.53']) {
      await expect(hub().pairing.pair('000002', other)).rejects.toMatchObject({
        code: 'PAIRING_CODE_INVALID',
      });
    }
    await expect(hub().pairing.pair(code, '192.168.1.54')).rejects.toMatchObject({
      code: 'PAIRING_CLOSED',
    });
  });

  it('takes each code once and copies the pairing to the standby', async () => {
    const { code } = await hub().pairing.open(
      { kind: 'personal', name: 'هاتف الصالة' },
      MEMBERS.manager,
    );
    const paired = await hub().pairing.pair(code, '192.168.1.50');
    expect(paired).toMatchObject({
      kind: 'personal',
      peers: [branch.pc1.address, branch.pc2.address],
      caFingerprint: 'f'.repeat(64),
    });
    await expect(hub().pairing.pair(code, '192.168.1.51')).rejects.toMatchObject({
      code: 'PAIRING_CLOSED',
    });
    await branch.settle();
    expect(await standby().pairing.authenticate(paired.token)).toMatchObject({
      id: paired.pairingId,
    });
    expect(await hub().pairing.authenticate('not-a-token')).toBeNull();
    expect(branch.pc1.store.data.events.at(-1)).toMatchObject({
      action: 'hub_pairing.paired',
      pairingId: paired.pairingId,
    });
  });
});

describe('pairings (rules 34, 36)', () => {
  it('lets a manager revoke one on the standby, offline too, and the hub learns it', async () => {
    const phone = await branch.pairPhone();
    await expect(standby().pairing.revoke(phone.pairingId, MEMBERS.waiter)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    branch.lan.cut(branch.pc1.deviceId, branch.pc2.deviceId);
    await standby().pairing.revoke(phone.pairingId, MEMBERS.manager);
    expect(await standby().pairing.authenticate(phone.pairingToken)).toBeNull();
    expect(await hub().pairing.authenticate(phone.pairingToken)).not.toBeNull();
    branch.lan.heal(branch.pc1.deviceId, branch.pc2.deviceId);
    await branch.run(500);
    expect(await hub().pairing.authenticate(phone.pairingToken)).toBeNull();
    expect((await hub().liveSnapshot()).clients).toEqual([]);
    expect(branch.pc2.store.data.events.at(-1)).toMatchObject({ action: 'hub_pairing.revoked' });
  });

  it('ends after 30 days without a request, on both PCs', async () => {
    const phone = await branch.pairPhone();
    branch.clock.advance(29 * 24 * 60 * 60 * 1000);
    expect(await hub().pairing.authenticate(phone.pairingToken)).not.toBeNull();
    await branch.run(500);
    // Its use on the hub reached the standby: 29 more days are fine there too.
    branch.clock.advance(29 * 24 * 60 * 60 * 1000);
    expect(await standby().pairing.authenticate(phone.pairingToken)).not.toBeNull();
    branch.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await hub().pairing.authenticate(phone.pairingToken)).toBeNull();
    expect(branch.pc1.store.data.events.at(-1)).toMatchObject({ action: 'hub_pairing.expired' });
  });

  it('lets a station run only station commands, as itself', async () => {
    const station = await branch.pairPhone({ kind: 'station', name: 'شاشة المطبخ 1' });
    const pairing = await hub().pairing.authenticate(station.pairingToken);
    if (!pairing) throw new Error('paired');
    const source = await hub().sourceOfPairing(pairing, null);
    expect(await hub().submit(branch.networkCheck(1), source)).toEqual({
      status: 'refused',
      reason: 'station_not_allowed',
    });
    const ready = {
      id: branch.id(),
      name: 'test.ticket_ready',
      version: 1,
      payload: { ticket: 'T-1' },
      deviceTime: branch.clock.now().toISOString(),
    };
    const answer = await hub().submit(ready, source);
    expect(answer).toMatchObject({
      status: 'ok',
      envelope: {
        actor: { kind: 'station', pairingId: station.pairingId },
        originKind: 'hub_client',
      },
    });
    expect(() => hub().pairing.membersFor(pairing)).toThrow();
  });
});

describe('PIN sessions on a personal pairing (rule 35)', () => {
  it('lists names and roles only, never verifiers', async () => {
    const phone = await branch.pairPhone();
    const pairing = await hub().pairing.authenticate(phone.pairingToken);
    if (!pairing) throw new Error('paired');
    const { members } = hub().pairing.membersFor(pairing);
    expect(members).toHaveLength(3);
    expect(JSON.stringify(members)).not.toContain('pin:');
  });

  it('needs an active session; a hub client never sends a device command', async () => {
    const phone = await branch.pairPhone();
    const pairing = await hub().pairing.authenticate(phone.pairingToken);
    if (!pairing) throw new Error('paired');
    expect(
      await hub().submit(branch.networkCheck(1), await hub().sourceOfPairing(pairing, null)),
    ).toEqual({
      status: 'refused',
      reason: 'pin_session_ended',
    });
    const source = await hub().sourceOfPairing(pairing, phone.sessionToken);
    expect(
      await hub().submit({ ...branch.networkCheck(2), actor: { kind: 'device' } }, source),
    ).toEqual({ status: 'refused', reason: 'permission_missing' });
    // The idle lock (5 minutes here) ends the session; a command counts as input.
    branch.clock.advance(4 * 60 * 1000);
    expect(
      await hub().submit(
        branch.networkCheck(3),
        await hub().sourceOfPairing(pairing, phone.sessionToken),
      ),
    ).toMatchObject({ status: 'ok' });
    branch.clock.advance(4 * 60 * 1000);
    expect(await hub().pairing.session(pairing, phone.sessionToken ?? '')).not.toBeNull();
    branch.clock.advance(5 * 60 * 1000);
    expect(await hub().pairing.session(pairing, phone.sessionToken ?? '')).toBeNull();
  });

  it('refuses a member without the permission', async () => {
    const phone = await branch.pairPhone({ member: MEMBERS.waiter, pin: '135790' });
    await phone.client.send(branch.networkCheck(1));
    expect(phone.refused).toEqual([{ id: expect.any(String), reason: 'permission_missing' }]);
    expect(await phone.client.counts()).toEqual({ sending: 0, unmirrored: 0 });
  });

  it('disables a PIN after 5 wrong tries on the hub and its standby', async () => {
    const phone = await branch.pairPhone();
    const pairing = await hub().pairing.authenticate(phone.pairingToken);
    if (!pairing) throw new Error('paired');
    const attempt = (pin: string) =>
      hub().pairing.startSession(pairing, { membershipId: MEMBERS.waiter, pin });
    for (let i = 0; i < 4; i++)
      await expect(attempt('111111')).rejects.toMatchObject({ code: 'INVALID_PIN' });
    await expect(attempt('111111')).rejects.toMatchObject({ code: 'PIN_DISABLED' });
    await expect(attempt('135790')).rejects.toMatchObject({ code: 'PIN_DISABLED' });
    await branch.settle();
    expect(await branch.pc2.store.pinDisabled(MEMBERS.waiter)).toBe(true);
    expect(branch.pc1.store.data.events.at(-1)).toMatchObject({
      action: 'hub_session.pin_locked',
      membershipId: MEMBERS.waiter,
    });
  });

  it('keeps the session through a failover', async () => {
    const phone = await branch.pairPhone();
    await phone.client.send(branch.networkCheck(1));
    branch.pc1.powerOff();
    await branch.run(3500);
    await phone.client.send(branch.networkCheck(2));
    expect(phone.refused).toEqual([]);
    expect(phone.client.hub()?.deviceId).toBe(branch.pc2.deviceId);
  });
});
