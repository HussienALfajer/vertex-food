import type { INestApplication } from '@nestjs/common';
import { effectivePermissions, SYNC_PROTOCOL } from '@vertex-food/contracts';
import {
  attentionItems,
  auditEntries,
  commandLog,
  commandPayloads,
  commandReplays,
  createDatabase,
  membershipAccessSnapshots,
  quarantineCommands,
  withTenant,
} from '@vertex-food/db';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from './app.js';
import { pinFor, TestApi } from './staff.js';
import { registerPc, resign, serverNow, signedCommand, upload, uploaded } from './sync.js';

// Spec S04 rules 7–16 over HTTP: the command upload of a branch's hub-capable PCs, every reason of
// rule 8, replays and their mismatches, concurrent uploads of one id, the clock rules, the member
// deactivated during a cut (rule 16) and the quarantine of a revoked executor (rule 40).

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  app = await createTestApp();
  api = new TestApi(app, db);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const MINUTE = 60_000;

/** A branch with its hub (the owner's PC), its standby and a client PC, and a manager. */
async function branch() {
  const setup = await api.ownerOnDevice(['main', 'east']);
  const [main, east] = setup.branchIds as [string, string];
  const standby = await registerPc(api, setup, main, 1);
  const client = await registerPc(api, setup, main, 2);
  return { ...setup, main, east, hub: setup.device, standby, client };
}

const logged = (tenantId: string, id: string) =>
  withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(commandLog).where(eq(commandLog.id, id));
    return row;
  });

const attentionOf = (tenantId: string, commandId: string) =>
  withTenant(db, tenantId, (tx) =>
    tx
      .select({ kind: attentionItems.kind, membershipId: attentionItems.membershipId })
      .from(attentionItems)
      .where(eq(attentionItems.commandId, commandId)),
  );

describe('the command upload (rules 7–10)', () => {
  it('records a new command once, with its payload, and answers replays from the log', async () => {
    const b = await branch();
    const command = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    const first = await upload(b.hub, [uploaded(command)], 200);
    expect(first.body).toEqual({
      results: [{ id: command.id, outcome: 'accepted', replay: false }],
    });
    const row = await logged(b.tenantId, command.id);
    expect(row).toMatchObject({
      branchId: b.main,
      name: 'sync.network_check',
      executedByDeviceId: b.hub.deviceId,
      uploadedByDeviceId: b.hub.deviceId,
      actorKind: 'member',
      membershipId: b.ownerMembershipId,
      outcome: 'accepted',
      reason: null,
      flags: [],
      payloadHash: command.payloadHash,
    });
    const payload = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandPayloads).where(eq(commandPayloads.commandId, command.id)),
    );
    expect(payload[0]).toMatchObject({ payload: command.payload, resolved: command.resolved });

    // The standby uploads the same command from its journal: the stored outcome, nothing written.
    const replay = await upload(b.standby.device, [uploaded(command)], 200);
    expect(replay.body.results).toEqual([{ id: command.id, outcome: 'accepted', replay: true }]);
    const replays = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandReplays).where(eq(commandReplays.commandId, command.id)),
    );
    expect(replays).toEqual([]);
    expect(await attentionOf(b.tenantId, command.id)).toEqual([]);
  });

  it('keeps a mismatched replay once per version and opens replay_mismatch', async () => {
    const b = await branch();
    const command = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    await upload(b.hub, [uploaded(command)], 200);
    const other = resign(b.standby.device, {
      ...command,
      executedByDeviceId: b.standby.device.deviceId,
      payload: { ...command.payload, sequence: 2 },
    });
    for (let i = 0; i < 2; i++) {
      const response = await upload(b.standby.device, [uploaded(other)], 200);
      expect(response.body.results).toEqual([{ id: command.id, outcome: 'accepted', replay: true }]);
    }
    // A forged version that claims the stored hash is a mismatch too.
    const forged = { ...command, payload: { ...command.payload, sequence: 3 } };
    await upload(b.standby.device, [uploaded(forged)], 200);
    const replays = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandReplays).where(eq(commandReplays.commandId, command.id)),
    );
    expect(replays.map((replay) => replay.payloadHash).sort()).toEqual(
      [other.payloadHash, command.payloadHash].sort(),
    );
    expect(await attentionOf(b.tenantId, command.id)).toEqual([
      { kind: 'replay_mismatch', membershipId: b.ownerMembershipId },
    ]);
  });

  it('executes one id once when the hub and the standby upload it together', async () => {
    const b = await branch();
    const command = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    const [hub, standby] = await Promise.all([
      upload(b.hub, [uploaded(command)]),
      upload(b.standby.device, [uploaded(command)]),
    ]);
    const replays = [hub.body.results[0].replay, standby.body.results[0].replay].sort();
    expect(replays).toEqual([false, true]);
    const rows = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandLog).where(eq(commandLog.id, command.id)),
    );
    expect(rows).toHaveLength(1);
  });

  it('answers each command of an upload in order, a repeated id as a replay', async () => {
    const b = await branch();
    const a = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    const c = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    const response = await upload(b.hub, [uploaded(a), uploaded(c), uploaded(a)], 200);
    expect(response.body.results.map((r: { id: string; replay: boolean }) => [r.id, r.replay])).toEqual([
      [a.id, false],
      [c.id, false],
      [a.id, true],
    ]);
  });

  it('refuses a client PC, a missing token and an unsupported protocol', async () => {
    const b = await branch();
    const command = signedCommand(b.client.device, { membershipId: b.ownerMembershipId });
    const client = await upload(b.client.device, [uploaded(command)]);
    expect([client.status, client.body.code]).toEqual([403, 'DEVICE_NOT_HUB_CAPABLE']);
    const anonymous = await api
      .http()
      .post('/api/sync/commands')
      .send({ protocol: SYNC_PROTOCOL, commands: [uploaded(command)] });
    expect([anonymous.status, anonymous.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    const old = signedCommand(b.hub, { membershipId: b.ownerMembershipId, protocol: 99 });
    const http = await b.hub.device();
    const response = await http
      .post('/api/sync/commands')
      .send({ protocol: SYNC_PROTOCOL, commands: [uploaded(old)] });
    expect([response.status, response.body.code]).toEqual([426, 'PROTOCOL_UNSUPPORTED']);
    const whole = await http
      .post('/api/sync/commands')
      .send({ protocol: 99, commands: [uploaded(signedCommand(b.hub))] });
    expect([whole.status, whole.body.code]).toEqual([426, 'PROTOCOL_UNSUPPORTED']);
    expect(await logged(b.tenantId, old.id)).toBeUndefined();
  });

  it('refuses a revoked PC with DEVICE_REVOKED', async () => {
    const b = await branch();
    const http = await b.standby.device.device();
    await b.hub
      .as(b.owner)
      .post(`/api/devices/${b.standby.device.deviceId}/revoke`)
      .send({ reason: 'lost_or_stolen' })
      .expect(200);
    const response = await http
      .post('/api/sync/commands')
      .send({ protocol: SYNC_PROTOCOL, commands: [uploaded(signedCommand(b.standby.device))] });
    expect([response.status, response.body.code]).toEqual([403, 'DEVICE_REVOKED']);
  });
});

describe('rule 8, in order', () => {
  async function rejected(
    b: Awaited<ReturnType<typeof branch>>,
    command: ReturnType<typeof signedCommand>,
    reason: string,
    stored = true,
  ) {
    const response = await upload(b.hub, [uploaded(command)], 200);
    expect(response.body.results).toEqual([
      { id: command.id, outcome: 'rejected', reason, replay: false },
    ]);
    const row = await logged(b.tenantId, command.id);
    if (!stored) {
      expect(row).toBeUndefined();
      return;
    }
    expect(row).toMatchObject({ outcome: 'rejected', reason });
    expect(await attentionOf(b.tenantId, command.id)).toEqual([
      expect.objectContaining({ kind: 'rejected' }),
    ]);
  }

  it('rejects an unknown command, an unsupported version and an invalid payload', async () => {
    const b = await branch();
    const member = { membershipId: b.ownerMembershipId };
    await rejected(b, signedCommand(b.hub, { ...member, name: 'sync.unknown' }), 'unknown_command');
    await rejected(b, signedCommand(b.hub, { ...member, version: 9 }), 'version_unsupported');
    const payload = { sentAt: new Date().toISOString(), sequence: 0, run: uuidv7() };
    await rejected(b, signedCommand(b.hub, { ...member, payload }), 'payload_invalid');
    // A float the canonical form refuses: its payload is not kept, its claimed hash is.
    const float = signedCommand(b.hub, member);
    const withFloat = { ...float, payload: { ...float.payload, sequence: 1.5 } };
    await rejected(b, withFloat, 'payload_invalid');
  });

  it('rejects a signature that does not verify, or a PC outside the token’s branch', async () => {
    const b = await branch();
    const member = { membershipId: b.ownerMembershipId };
    const command = signedCommand(b.hub, member);
    await rejected(b, { ...command, signature: signedCommand(b.hub, member).signature }, 'signature_invalid');
    // Signed by the standby but naming the hub as its executor.
    const forged = resign(b.standby.device, signedCommand(b.hub, member));
    await rejected(b, forged, 'signature_invalid');
    // A PC of the tenant's other branch, signing as itself.
    const east = await registerPc(api, b, b.east, 3);
    await rejected(b, signedCommand(east.device, member), 'signature_invalid');
    // A PC of another tenant: the log cannot name it, so nothing is stored.
    const other = await api.ownerOnDevice();
    await rejected(b, signedCommand(other.device, member), 'signature_invalid', false);
  });

  it('checks the actor: permission, station, device commands and approvers', async () => {
    const b = await branch();
    const cashier = await b.hub.addMember(
      b.owner,
      { displayName: 'كاشير', roles: ['cashier'], branchScope: { allBranches: false, branchIds: [b.main] } },
      pinFor(4),
    );
    await rejected(b, signedCommand(b.hub, { membershipId: cashier.id }), 'permission_missing');
    await rejected(
      b,
      signedCommand(b.hub, { actor: { kind: 'station', pairingId: uuidv7() } }),
      'station_not_allowed',
    );
    await rejected(b, signedCommand(b.hub, { actor: { kind: 'device' } }), 'permission_missing');
    await rejected(
      b,
      signedCommand(b.hub, {
        membershipId: b.ownerMembershipId,
        approvedByMembershipId: b.standby.manager.id,
      }),
      'approver_not_allowed',
    );
    const events = { events: [{ action: 'hub.promoted', at: new Date().toISOString(), details: {} }] };
    await rejected(
      b,
      signedCommand(b.hub, {
        name: 'audit.record_local_events',
        membershipId: b.ownerMembershipId,
        payload: events,
        resolved: {},
      }),
      'permission_missing',
    );
    // A member the tenant does not hold is not stored.
    await rejected(b, signedCommand(b.hub, { membershipId: uuidv7() }), 'member_inactive', false);
  });

  it('rejects a command from before the member existed (member_inactive)', async () => {
    const b = await branch();
    const at = new Date((await serverNow(db)).getTime() - 60 * MINUTE);
    await rejected(b, signedCommand(b.hub, { membershipId: b.ownerMembershipId, at }), 'member_inactive');
  });
});

describe('the clock (rules 14–16)', () => {
  it('flags clock-suspect commands without rejecting them and clamps the effective time', async () => {
    const b = await branch();
    const now = await serverNow(db);
    const behind = signedCommand(b.hub, {
      membershipId: b.ownerMembershipId,
      highestSeenTime: new Date(now.getTime() + 11 * MINUTE).toISOString(),
    });
    // The hub's clock runs 15 minutes ahead and its offset was never measured.
    const ahead = signedCommand(b.hub, {
      membershipId: b.ownerMembershipId,
      at: new Date(now.getTime() + 15 * MINUTE),
    });
    const fine = signedCommand(b.hub, {
      membershipId: b.ownerMembershipId,
      at: new Date(now.getTime() + 15 * MINUTE),
      clockOffsetMs: -15 * MINUTE,
    });
    const response = await upload(b.hub, [uploaded(behind), uploaded(ahead), uploaded(fine)], 200);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    for (const command of [behind, ahead]) {
      expect((await logged(b.tenantId, command.id))?.flags).toEqual(['clock_suspect']);
      expect(await attentionOf(b.tenantId, command.id)).toEqual([
        { kind: 'clock_suspect', membershipId: b.ownerMembershipId },
      ]);
    }
    const row = await logged(b.tenantId, ahead.id);
    expect(row?.effectiveTime.getTime()).toBe(row?.receivedAt.getTime());
    expect((await logged(b.tenantId, fine.id))?.flags).toEqual([]);
  });

  it('flags a command when the PC’s offset jumped by more than 10 minutes after it', async () => {
    const b = await branch();
    const http = await b.hub.device();
    await http
      .post('/api/sync/heartbeat')
      .send({
        lastRoundTripMs: 40,
        pendingUploads: 1,
        liveRole: 'hub',
        hubEpoch: 1,
        standbyInSync: true,
        appVersion: '0.1.0',
        protocol: SYNC_PROTOCOL,
        lanAddresses: ['192.168.1.20'],
        clockOffsetMs: 20 * MINUTE,
      })
      .expect(200);
    const at = new Date((await serverNow(db)).getTime() - 2 * MINUTE);
    const command = signedCommand(b.hub, { membershipId: b.ownerMembershipId, at });
    await upload(b.hub, [uploaded(command)], 200);
    expect((await logged(b.tenantId, command.id))?.flags).toEqual(['clock_suspect']);
  });

  it('carries the offline window and mirrored flags to the log', async () => {
    const b = await branch();
    const command = signedCommand(b.hub, { membershipId: b.ownerMembershipId, afterOfflineWindow: true });
    await upload(b.hub, [uploaded(command, false)], 200);
    expect((await logged(b.tenantId, command.id))?.flags).toEqual([
      'after_offline_window',
      'mirrored_false',
    ]);
  });

  it('runs a deactivated member’s command made more than 10 minutes before, else quarantines it', async () => {
    const b = await branch();
    const manager = b.standby.manager;
    const now = await serverNow(db);
    // The manager was a member for the last hour.
    await withTenant(db, b.tenantId, (tx) =>
      tx.insert(membershipAccessSnapshots).values({
        tenantId: b.tenantId,
        membershipId: manager.id,
        status: 'active',
        roles: ['manager'],
        allBranches: false,
        branchIds: [b.main],
        permissions: effectivePermissions(['manager'], [], []),
        effectiveFrom: new Date(now.getTime() - 60 * MINUTE),
      }),
    );
    await b.hub
      .as(b.owner)
      .post(`/api/staff/${manager.id}/deactivate`)
      .send({ reason: 'left' })
      .expect(200);
    const deactivatedAt = await serverNow(db);
    const early = signedCommand(b.hub, {
      membershipId: manager.id,
      at: new Date(deactivatedAt.getTime() - 20 * MINUTE),
    });
    const late = signedCommand(b.hub, {
      membershipId: manager.id,
      at: new Date(deactivatedAt.getTime() - 5 * MINUTE),
    });
    const suspect = signedCommand(b.hub, {
      membershipId: manager.id,
      at: new Date(deactivatedAt.getTime() - 20 * MINUTE),
      highestSeenTime: new Date(deactivatedAt.getTime() - 5 * MINUTE).toISOString(),
    });
    const after = signedCommand(b.hub, { membershipId: manager.id, at: deactivatedAt });
    const response = await upload(b.hub, [
      uploaded(early),
      uploaded(late),
      uploaded(suspect),
      uploaded(after),
    ], 200);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'accepted',
      'quarantined',
      'quarantined',
      'quarantined',
    ]);
    const held = await withTenant(db, b.tenantId, (tx) =>
      tx.select({ commandId: quarantineCommands.commandId }).from(quarantineCommands),
    );
    expect(held.map((row) => row.commandId).sort()).toEqual([late.id, suspect.id, after.id].sort());
    expect(await logged(b.tenantId, late.id)).toBeUndefined();
    // Uploaded again, a held command answers as held.
    const again = await upload(b.hub, [uploaded(late)], 200);
    expect(again.body.results).toEqual([{ id: late.id, outcome: 'quarantined', replay: true }]);
  });
});

describe('a revoked executor (rules 40–42)', () => {
  it('quarantines its commands made after the revocation and runs the ones before', async () => {
    const b = await branch();
    const before = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    await b.hub
      .as(b.owner)
      .post(`/api/devices/${b.standby.device.deviceId}/revoke`)
      .send({ reason: 'lost_or_stolen' })
      .expect(200);
    const revokedAt = await serverNow(db);
    const after = signedCommand(b.standby.device, {
      membershipId: b.ownerMembershipId,
      at: new Date(revokedAt.getTime() + 1000),
      clockOffsetMs: 0,
    });
    const response = await upload(b.hub, [uploaded(before), uploaded(after)], 200);
    expect(response.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'accepted',
      'quarantined',
    ]);
  });
});

describe('audit.record_local_events', () => {
  it('writes the PC’s offline events with their device times, as the members who caused them', async () => {
    const b = await branch();
    const at = new Date(Date.now() - 30 * MINUTE).toISOString();
    const pairingId = uuidv7();
    const command = signedCommand(b.hub, {
      name: 'audit.record_local_events',
      payload: {
        events: [
          { action: 'staff_pin.failed_offline', at, membershipId: b.ownerMembershipId, details: { attempts: 1 } },
          { action: 'hub_pairing.paired', at, pairingId, details: { kind: 'station' } },
        ],
      },
      resolved: {},
    });
    const response = await upload(b.hub, [uploaded(command)], 200);
    expect(response.body.results[0]).toMatchObject({ outcome: 'accepted' });
    const entries = await withTenant(db, b.tenantId, (tx) =>
      tx
        .select()
        .from(auditEntries)
        .where(and(eq(auditEntries.recordedOffline, true), eq(auditEntries.deviceId, b.hub.deviceId))),
    );
    expect(entries).toHaveLength(2);
    const pin = entries.find((entry) => entry.action === 'staff_pin.failed_offline');
    expect(pin).toMatchObject({
      actorKind: 'staff',
      entityType: 'staff_membership',
      entityId: b.ownerMembershipId,
      occurredAt: new Date(at),
      details: { attempts: 1, membershipId: b.ownerMembershipId, commandId: command.id },
    });
    const paired = entries.find((entry) => entry.action === 'hub_pairing.paired');
    expect(paired).toMatchObject({ actorKind: 'system', actorName: 'device', entityId: pairingId });
  });

  it('rejects events naming a member the tenant does not hold, writing nothing', async () => {
    const b = await branch();
    const command = signedCommand(b.hub, {
      name: 'audit.record_local_events',
      payload: {
        events: [
          { action: 'hub.promoted', at: new Date().toISOString(), details: {} },
          { action: 'staff_pin.locked_offline', at: new Date().toISOString(), membershipId: uuidv7(), details: {} },
        ],
      },
      resolved: {},
    });
    const response = await upload(b.hub, [uploaded(command)], 200);
    expect(response.body.results[0]).toMatchObject({ outcome: 'rejected', reason: 'payload_invalid' });
    const entries = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.recordedOffline, true)),
    );
    expect(entries).toEqual([]);
  });
});
