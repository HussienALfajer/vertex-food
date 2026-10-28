import type { INestApplication } from '@nestjs/common';
import {
  attentionItems,
  auditEntries,
  commandLog,
  createDatabase,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { commandRegistry, createCommandRegistry, defineCommand } from '@vertex-food/sync';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import {
  COMMAND_EXECUTORS,
  COMMAND_REGISTRY,
  commandExecutors,
  defineExecutor,
} from '../src/modules/platform/sync/index.js';
import { createTestApp } from './app.js';
import { TestApi } from './staff.js';
import { signedCommand, upload, uploaded } from './sync.js';

// Spec S04 rule 9 and audit finding SYNC-01: an executor's writes are rolled back with its
// rejection; an exception is rolled back and recorded `server_error`, so the PC's queue drains; a
// database or infrastructure failure answers 5xx and records nothing, so the PC re-sends. Test
// commands join the registry for this file only.

const testCommand = (name: string) =>
  defineCommand({
    name: `test.${name}`,
    version: 1,
    payload: z.object({}),
    resolved: z.object({}),
    access: { actor: 'member', permission: 'hub.manage', station: false },
    resolve: () => ({}),
    describe: () => ({ key: `commands.test.${name}`, params: {} }),
  });

const definitions = {
  reject: testCommand('write_then_reject'),
  throws: testCommand('write_then_throw'),
  constraint: testCommand('break_a_constraint'),
  nodeError: testCommand('throw_a_node_error'),
  adjust: testCommand('adjust'),
  infrastructure: testCommand('lose_the_connection'),
};

/** What every test executor writes first: an audit entry the rollback must take back. */
async function write(tx: Transaction, tenantId: string, commandId: string) {
  await tx.insert(auditEntries).values({
    tenantId,
    actorKind: 'system',
    actorName: 'sync-test',
    action: 'branch.hub_roles_changed',
    entityType: 'sync_test',
    entityId: commandId,
    occurredAt: new Date(),
  });
}

const executors = [
  ...commandExecutors,
  defineExecutor(definitions.reject, async (tx, command) => {
    await write(tx, command.tenantId, command.envelope.id);
    return { outcome: 'rejected', reason: 'payload_invalid', details: { field: 'total' } };
  }),
  defineExecutor(definitions.throws, async (tx, command) => {
    await write(tx, command.tenantId, command.envelope.id);
    throw new Error('a handler bug');
  }),
  defineExecutor(definitions.constraint, async (tx, command) => {
    await write(tx, command.tenantId, command.envelope.id);
    await tx.insert(auditEntries).values({
      tenantId: command.tenantId,
      actorKind: 'nobody',
      action: 'branch.hub_roles_changed',
      entityType: 'sync_test',
      occurredAt: new Date(),
    });
    return { outcome: 'accepted' };
  }),
  defineExecutor(definitions.nodeError, async () => {
    throw Object.assign(new TypeError('The "data" argument must be a string'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
  }),
  defineExecutor(definitions.adjust, async (tx, command) => {
    await write(tx, command.tenantId, command.envelope.id);
    return { outcome: 'adjusted', details: { priceRowId: command.envelope.id } };
  }),
  defineExecutor(definitions.infrastructure, async () => {
    throw Object.assign(new Error('Connection terminated'), {
      cause: Object.assign(new Error('terminated'), { code: '08006' }),
    });
  }),
];

let app: INestApplication;
let api: TestApi;
const db = createDatabase(inject('databaseUrl'));

beforeAll(async () => {
  app = await createTestApp({
    overrides: [
      {
        token: COMMAND_REGISTRY,
        value: createCommandRegistry([
          ...commandRegistry.definitions(),
          ...Object.values(definitions),
        ]),
      },
      { token: COMMAND_EXECUTORS, value: executors },
    ],
  });
  api = new TestApi(app, db);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const written = (tenantId: string, commandId: string) =>
  withTenant(db, tenantId, (tx) =>
    tx.select().from(auditEntries).where(eq(auditEntries.entityId, commandId)),
  );

const attention = (tenantId: string, commandId: string) =>
  withTenant(db, tenantId, (tx) =>
    tx
      .select({ kind: attentionItems.kind })
      .from(attentionItems)
      .where(eq(attentionItems.commandId, commandId)),
  );

const command = (device: Parameters<typeof signedCommand>[0], name: string, membershipId: string) =>
  signedCommand(device, { name, membershipId, payload: {}, resolved: {} });

describe('execution in a savepoint (rule 9, SYNC-01)', () => {
  it('rolls back what a rejected command wrote and records the rejection', async () => {
    const { device, tenantId, ownerMembershipId } = await api.ownerOnDevice();
    const rejected = command(device, 'test.write_then_reject', ownerMembershipId);
    const response = await upload(device, [uploaded(rejected)], 200);
    expect(response.body.results).toEqual([
      {
        id: rejected.id,
        outcome: 'rejected',
        reason: 'payload_invalid',
        details: { field: 'total' },
        replay: false,
      },
    ]);
    expect(await written(tenantId, rejected.id)).toEqual([]);
    expect(await attention(tenantId, rejected.id)).toEqual([{ kind: 'rejected' }]);
  });

  it('records an exception or a broken constraint as server_error, with nothing written', async () => {
    const { device, tenantId, ownerMembershipId } = await api.ownerOnDevice();
    for (const name of [
      'test.write_then_throw',
      'test.break_a_constraint',
      'test.throw_a_node_error',
    ]) {
      const failed = command(device, name, ownerMembershipId);
      const response = await upload(device, [uploaded(failed)], 200);
      expect(response.body.results).toEqual([
        { id: failed.id, outcome: 'rejected', reason: 'server_error', replay: false },
      ]);
      expect(await written(tenantId, failed.id)).toEqual([]);
      expect(await attention(tenantId, failed.id)).toEqual([{ kind: 'server_error' }]);
      // Never run again: a re-sent command answers its recorded outcome.
      const again = await upload(device, [uploaded(failed)], 200);
      expect(again.body.results[0]).toMatchObject({ outcome: 'rejected', replay: true });
    }
  });

  it('keeps what an adjusted command wrote and opens adjusted', async () => {
    const { device, tenantId, ownerMembershipId } = await api.ownerOnDevice();
    const adjusted = command(device, 'test.adjust', ownerMembershipId);
    const response = await upload(device, [uploaded(adjusted)], 200);
    expect(response.body.results[0]).toEqual({
      id: adjusted.id,
      outcome: 'adjusted',
      details: { priceRowId: adjusted.id },
      replay: false,
    });
    expect(await written(tenantId, adjusted.id)).toHaveLength(1);
    expect(await attention(tenantId, adjusted.id)).toEqual([{ kind: 'adjusted' }]);
  });

  it('answers 5xx on an infrastructure failure, recording nothing, and keeps earlier outcomes', async () => {
    const { device, tenantId, ownerMembershipId } = await api.ownerOnDevice();
    const first = signedCommand(device, { membershipId: ownerMembershipId });
    const failing = command(device, 'test.lose_the_connection', ownerMembershipId);
    const response = await upload(device, [uploaded(first), uploaded(failing)]);
    expect(response.status).toBeGreaterThanOrEqual(500);
    const logged = await withTenant(db, tenantId, (tx) =>
      tx.select({ id: commandLog.id }).from(commandLog),
    );
    expect(logged.map((row) => row.id)).toEqual([first.id]);
  });
});
