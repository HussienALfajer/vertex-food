import { sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type CommandEnvelope,
  quarantineUploadMessage,
  SYNC_PROTOCOL,
} from '@vertex-food/contracts';
import { auditEntries, commandLog, createDatabase, withTenant } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from './app.js';
import { pinFor, TestApi, type TestDevice } from './staff.js';
import { registerPc, signedCommand, upload, uploaded } from './sync.js';

// Spec S04 rules 40–42 and 47 over HTTP: needs attention as the member who made a command and
// as a manager, closing an item once; the quarantine upload of a revoked PC, signed with its
// device key, its review by the owner, and accepting or rejecting a batch with re-auth.

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

async function branch() {
  const setup = await api.ownerOnDevice(['main', 'east']);
  const [main, east] = setup.branchIds as [string, string];
  const standby = await registerPc(api, setup, main, 1);
  const client = await registerPc(api, setup, main, 2);
  return { ...setup, main, east, hub: setup.device, standby, client };
}

describe('needs attention (rule 47)', () => {
  it('shows a member their own items and a manager all, closed once with a reason', async () => {
    const b = await branch();
    const cashier = await b.hub.addMember(
      b.owner,
      {
        displayName: 'كاشير',
        roles: ['cashier'],
        branchScope: { allBranches: false, branchIds: [b.main] },
      },
      pinFor(3),
    );
    const byCashier = signedCommand(b.hub, { membershipId: cashier.id });
    const byOwner = signedCommand(b.hub, { membershipId: b.ownerMembershipId, version: 7 });
    await upload(b.hub, [uploaded(byCashier), uploaded(byOwner)], 200);

    const cashierSession = await b.hub.signIn(cashier.id, pinFor(3));
    const own = await b.hub
      .as(cashierSession)
      .get(`/api/sync/attention?branchId=${b.main}`)
      .expect(200);
    expect(own.body).toMatchObject({ total: 1, page: 1 });
    expect(own.body.items).toEqual([
      expect.objectContaining({
        commandId: byCashier.id,
        kind: 'rejected',
        membershipId: cashier.id,
        resolution: null,
        command: expect.objectContaining({
          name: 'sync.network_check',
          outcome: 'rejected',
          reason: 'permission_missing',
          summary: { key: 'commands.sync.network_check', params: { sequence: 1 } },
        }),
      }),
    ]);

    const manager = await b.hub.signIn(b.standby.manager.id, pinFor(1));
    const all = await b.hub.as(manager).get(`/api/sync/attention?branchId=${b.main}`).expect(200);
    expect(all.body.items.map((item: { commandId: string }) => item.commandId).sort()).toEqual(
      [byCashier.id, byOwner.id].sort(),
    );
    const unknown = all.body.items.find(
      (item: { commandId: string }) => item.commandId === byOwner.id,
    );
    expect(unknown.command.summary).toEqual({ key: 'reasons.version_unsupported', params: {} });

    const refused = await b.hub
      .as(cashierSession)
      .post(`/api/sync/attention/${own.body.items[0].id}/resolve`)
      .send({ reason: 'تمت المراجعة' });
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const closed = await b.hub
      .as(manager)
      .post(`/api/sync/attention/${own.body.items[0].id}/resolve`)
      .send({ reason: 'تمت المراجعة' })
      .expect(200);
    expect(closed.body.resolution).toMatchObject({
      reason: 'تمت المراجعة',
      resolvedByMembershipId: b.standby.manager.id,
    });
    const again = await b.hub
      .as(manager)
      .post(`/api/sync/attention/${own.body.items[0].id}/resolve`)
      .send({ reason: 'مرة ثانية' });
    expect([again.status, again.body.code]).toEqual([409, 'ATTENTION_ALREADY_RESOLVED']);

    const open = await b.hub.as(manager).get(`/api/sync/attention?branchId=${b.main}`).expect(200);
    expect(open.body.items.map((item: { commandId: string }) => item.commandId)).toEqual([
      byOwner.id,
    ]);
    const done = await b.hub
      .as(manager)
      .get(`/api/sync/attention?branchId=${b.main}&status=closed`)
      .expect(200);
    expect(done.body.items.map((item: { commandId: string }) => item.commandId)).toEqual([
      byCashier.id,
    ]);
    const audited = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'attention_item.resolved')),
    );
    expect(audited).toEqual([expect.objectContaining({ reason: 'تمت المراجعة' })]);
  });

  it('hides another tenant’s item and another branch’s from a branch manager', async () => {
    const b = await branch();
    await upload(
      b.hub,
      [uploaded(signedCommand(b.hub, { membershipId: b.ownerMembershipId, version: 7 }))],
      200,
    );
    const owners = await b.hub
      .as(b.owner)
      .get(`/api/sync/attention?branchId=${b.main}`)
      .expect(200);
    const id = owners.body.items[0].id as string;
    const other = await api.ownerOnDevice();
    const foreign = await other.device
      .as(other.owner)
      .post(`/api/sync/attention/${id}/resolve`)
      .send({ reason: 'ليس لنا' });
    expect([foreign.status, foreign.body.code]).toEqual([404, 'NOT_FOUND']);
    const foreignList = await other.device
      .as(other.owner)
      .get(`/api/sync/attention?branchId=${b.main}`)
      .expect(200);
    expect(foreignList.body.items).toEqual([]);
  });
});

/** Rule 40: the revoked PC's signed upload of its pending work. */
async function quarantineUpload(device: TestDevice, commands: CommandEnvelope[], signer = device) {
  const challenge = await api
    .http()
    .post('/api/devices/token/challenge')
    .send({ tenantId: device.tenantId, deviceId: device.deviceId })
    .expect(200);
  const nonce = challenge.body.nonce as string;
  const signature = sign(
    null,
    Buffer.from(quarantineUploadMessage(nonce, device.deviceId)),
    signer.privateKey,
  ).toString('base64');
  const body = {
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    nonce,
    signature,
    protocol: SYNC_PROTOCOL,
    commands,
  };
  return { response: await api.http().post('/api/sync/quarantine').send(body), body };
}

async function revoke(b: Awaited<ReturnType<typeof branch>>, device: TestDevice) {
  await b.hub
    .as(b.owner)
    .post(`/api/devices/${device.deviceId}/revoke`)
    .send({ reason: 'lost_or_stolen' })
    .expect(200);
}

describe('the quarantine (rules 40–42)', () => {
  it('takes one signed batch per revoked PC and refuses an active PC or a bad signature', async () => {
    const b = await branch();
    const commands = [signedCommand(b.standby.device, { membershipId: b.ownerMembershipId })];
    const active = await quarantineUpload(b.standby.device, commands);
    expect([active.response.status, active.response.body.code]).toEqual([
      409,
      'DEVICE_NOT_REVOKED',
    ]);
    await revoke(b, b.standby.device);
    const forged = await quarantineUpload(b.standby.device, commands, b.hub);
    expect([forged.response.status, forged.response.body.code]).toEqual([401, 'SIGNATURE_INVALID']);
    const first = await quarantineUpload(b.standby.device, commands);
    expect(first.response.status).toBe(201);
    // The nonce is used up.
    const replayed = await api.http().post('/api/sync/quarantine').send(first.body);
    expect([replayed.status, replayed.body.code]).toEqual([401, 'SIGNATURE_INVALID']);
    const second = await quarantineUpload(b.standby.device, [
      ...commands,
      signedCommand(b.standby.device, { membershipId: b.ownerMembershipId }),
    ]);
    expect(second.response.body.batchId).toBe(first.response.body.batchId);
    const list = await b.hub.as(b.owner).get('/api/sync/quarantine').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: first.response.body.batchId,
        deviceId: b.standby.device.deviceId,
        reason: 'device_revoked',
        commandCount: 2,
        decision: null,
      }),
    ]);
    const manager = await b.hub.signIn(b.client.manager.id, pinFor(2));
    const refused = await b.hub.as(manager).get('/api/sync/quarantine');
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('accepts a batch with re-auth, running its commands in journal order once', async () => {
    const b = await branch();
    const early = signedCommand(b.standby.device, {
      membershipId: b.ownerMembershipId,
      hubEpoch: 2,
      hubSeq: 1,
    });
    const late = signedCommand(b.standby.device, {
      membershipId: b.ownerMembershipId,
      hubEpoch: 2,
      hubSeq: 2,
    });
    const uploadedBefore = signedCommand(b.standby.device, {
      membershipId: b.ownerMembershipId,
      hubEpoch: 1,
      hubSeq: 9,
    });
    // The hub uploaded one of them before the revocation.
    await upload(b.hub, [uploaded(uploadedBefore)], 200);
    await revoke(b, b.standby.device);
    const { response } = await quarantineUpload(b.standby.device, [late, uploadedBefore, early]);
    const batchId = response.body.batchId as string;
    const detail = await b.hub.as(b.owner).get(`/api/sync/quarantine/${batchId}`).expect(200);
    expect(
      detail.body.commands.map((command: { commandId: string; alreadyExecuted: boolean }) => [
        command.commandId,
        command.alreadyExecuted,
      ]),
    ).toEqual([
      [uploadedBefore.id, true],
      [early.id, false],
      [late.id, false],
    ]);
    expect(detail.body.commands[1].summary).toEqual({
      key: 'commands.sync.network_check',
      params: { sequence: 1 },
    });

    const pinSession = await b.hub.signIn(b.ownerMembershipId, pinFor(0));
    const noReauth = await b.hub.as(pinSession).post(`/api/sync/quarantine/${batchId}/accept`);
    expect([noReauth.status, noReauth.body.code]).toEqual([403, 'REAUTH_REQUIRED']);
    const accepted = await b.hub
      .as(b.owner)
      .post(`/api/sync/quarantine/${batchId}/accept`)
      .expect(200);
    expect(accepted.body.batch.decision).toMatchObject({ decision: 'accept', reason: null });
    expect(accepted.body.results).toEqual([
      { id: uploadedBefore.id, outcome: 'accepted', replay: true },
      { id: early.id, outcome: 'accepted', replay: false },
      { id: late.id, outcome: 'accepted', replay: false },
    ]);
    const row = await withTenant(db, b.tenantId, async (tx) => {
      const [found] = await tx.select().from(commandLog).where(eq(commandLog.id, early.id));
      return found;
    });
    expect(row).toMatchObject({
      flags: ['from_quarantine'],
      uploadedByDeviceId: b.standby.device.deviceId,
    });
    const twice = await b.hub.as(b.owner).post(`/api/sync/quarantine/${batchId}/accept`);
    expect([twice.status, twice.body.code]).toEqual([409, 'QUARANTINE_ALREADY_DECIDED']);
  });

  it('takes nothing more into a decided batch, and refuses the revoked PC’s later commands', async () => {
    const b = await branch();
    const pending = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    await revoke(b, b.standby.device);
    const { response } = await quarantineUpload(b.standby.device, [pending]);
    const batchId = response.body.batchId as string;
    await b.hub.as(b.owner).post(`/api/sync/quarantine/${batchId}/accept`).expect(200);

    // A stolen key signs new commands after the decision: stored nowhere, run never.
    const forged = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    const again = await quarantineUpload(b.standby.device, [forged]);
    expect(again.response.body.batchId).toBe(batchId);
    const detail = await b.hub.as(b.owner).get(`/api/sync/quarantine/${batchId}`).expect(200);
    expect(detail.body.commands.map((command: { commandId: string }) => command.commandId)).toEqual(
      [pending.id],
    );
    // Uploaded by the hub, the late command is refused with its reason, visibly.
    const viaHub = await upload(b.hub, [uploaded(forged)], 200);
    expect(viaHub.body.results).toEqual([
      { id: forged.id, outcome: 'rejected', reason: 'device_revoked', replay: false },
    ]);
    // The accepted one, uploaded again by the hub, answers its outcome.
    const pendingAgain = await upload(b.hub, [uploaded(pending)], 200);
    expect(pendingAgain.body.results[0]).toMatchObject({ outcome: 'accepted', replay: true });
  });

  it('runs the commands another PC executed instead of holding them, and refuses a wiped PC', async () => {
    const b = await branch();
    // The standby holds the hub's commands in its journal when it is revoked.
    const hubCommand = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    const own = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    await revoke(b, b.standby.device);
    const { response } = await quarantineUpload(b.standby.device, [hubCommand, own]);
    const batchId = response.body.batchId as string;
    const detail = await b.hub.as(b.owner).get(`/api/sync/quarantine/${batchId}`).expect(200);
    expect(detail.body.commands.map((command: { commandId: string }) => command.commandId)).toEqual(
      [own.id],
    );
    const logged = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandLog).where(eq(commandLog.id, hubCommand.id)),
    );
    expect(logged[0]).toMatchObject({
      outcome: 'accepted',
      uploadedByDeviceId: b.standby.device.deviceId,
    });
    // The hub's own upload of it answers the outcome, whatever the owner decides on the batch.
    await b.hub
      .as(b.owner)
      .post(`/api/sync/quarantine/${batchId}/reject`)
      .send({ reason: 'جهاز مسروق' })
      .expect(200);
    const replay = await upload(b.hub, [uploaded(hubCommand)], 200);
    expect(replay.body.results[0]).toMatchObject({ outcome: 'accepted', replay: true });

    // Once the PC confirmed its wipe, it uploads nothing more.
    const http = await b.standby.device.device();
    await http.post('/api/devices/current/wiped').expect(204);
    const wiped = await quarantineUpload(b.standby.device, [own]);
    expect([wiped.response.status, wiped.response.body.code]).toEqual([403, 'DEVICE_REVOKED']);
  });

  it('leaves out another PC’s command the revoked PC changed, so the real one still runs', async () => {
    const b = await branch();
    const hubCommand = signedCommand(b.hub, { membershipId: b.ownerMembershipId });
    await revoke(b, b.standby.device);
    const tampered = { ...hubCommand, payload: { ...hubCommand.payload, sequence: 9 } };
    await quarantineUpload(b.standby.device, [tampered]);
    const logged = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandLog).where(eq(commandLog.id, hubCommand.id)),
    );
    expect(logged).toEqual([]);
    const real = await upload(b.hub, [uploaded(hubCommand)], 200);
    expect(real.body.results).toEqual([{ id: hubCommand.id, outcome: 'accepted', replay: false }]);
  });

  it('runs a revoked PC’s command made before its revocation, held or not', async () => {
    const b = await branch();
    const before = signedCommand(b.standby.device, { membershipId: b.ownerMembershipId });
    await revoke(b, b.standby.device);
    await quarantineUpload(b.standby.device, [before]);
    const viaHub = await upload(b.hub, [uploaded(before)], 200);
    expect(viaHub.body.results).toEqual([{ id: before.id, outcome: 'accepted', replay: false }]);
  });

  it('rejects a batch with a reason and runs nothing', async () => {
    const b = await branch();
    const command = signedCommand(b.client.device, { membershipId: b.ownerMembershipId });
    await revoke(b, b.client.device);
    const { response } = await quarantineUpload(b.client.device, [command]);
    const batchId = response.body.batchId as string;
    const short = await b.hub
      .as(b.owner)
      .post(`/api/sync/quarantine/${batchId}/reject`)
      .send({ reason: 'x' });
    expect([short.status, short.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const rejected = await b.hub
      .as(b.owner)
      .post(`/api/sync/quarantine/${batchId}/reject`)
      .send({ reason: 'جهاز مسروق' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      batch: { decision: { decision: 'reject', reason: 'جهاز مسروق' } },
      results: [],
    });
    const logged = await withTenant(db, b.tenantId, (tx) =>
      tx.select().from(commandLog).where(eq(commandLog.id, command.id)),
    );
    expect(logged).toEqual([]);
    const foreign = await api.ownerOnDevice();
    const other = await foreign.device.as(foreign.owner).get(`/api/sync/quarantine/${batchId}`);
    expect([other.status, other.body.code]).toEqual([404, 'NOT_FOUND']);
    const missing = await b.hub.as(b.owner).get(`/api/sync/quarantine/${uuidv7()}`);
    expect(missing.status).toBe(404);
  });
});
