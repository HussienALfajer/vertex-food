import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import type { CommandEnvelope } from '@vertex-food/contracts';
import { createDatabase } from '@vertex-food/db';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from './app.js';
import { TestApi, type TestDevice } from './staff.js';
import { registerPc, signedCommand, upload, uploaded } from './sync.js';

// Spec S04 "Tests", against a real PostgreSQL and the sync service: PowerSync Open Edition (the
// pinned image of `packages/sync/powersync/`) replicates this run's database and serves each PC
// the streams of its token. PCs of two branches and of another tenant upload interleaved
// commands, each command id from both hub-capable PCs; every PC's stream then holds each command of
// its branch once, with its outcome, and nothing of another branch or tenant (ADR 0004, 0035).
//
// Needs PostgreSQL with `wal_level = logical`, Docker, the storage role of `pnpm db:setup-local`
// with `POWERSYNC_STORAGE_URI`, and `SYNC_SCENARIOS=1`: CI's test job sets them up; locally see
// `packages/sync/CLAUDE.md` ("The sync service locally").

const run = promisify(execFile);
const enabled = process.env.SYNC_SCENARIOS === '1';
const IMAGE = 'journeyapps/powersync-service:1.27.0';
const CONFIG_DIR = fileURLToPath(new URL('../../../packages/sync/powersync/', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** A URL of this run's database as the sync service's container reaches the host. */
function fromContainer(url: string, database?: string): string {
  const parsed = new URL(url);
  parsed.hostname = 'host.docker.internal';
  if (database) parsed.pathname = `/${database}`;
  return parsed.href;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

type StreamRows = Map<string, Map<string, Record<string, unknown>>>;

/**
 * One sync over PowerSync's HTTP protocol, as the PC's SDK opens it: the token's default streams,
 * read until the first complete checkpoint. Answers the rows by table and id.
 */
async function syncOnce(endpoint: string, token: string): Promise<StreamRows> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const response = await fetch(`${endpoint}/sync/stream`, {
      method: 'POST',
      signal: abort.signal,
      headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        buckets: [],
        include_checksum: true,
        raw_data: true,
        client_id: uuidv7(),
        streams: { include_defaults: true, subscriptions: [] },
      }),
    });
    if (!response.ok || !response.body) throw new Error(`sync stream ${response.status}`);
    const rows: StreamRows = new Map();
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
        if (!line) continue;
        const message = JSON.parse(line) as {
          data?: {
            data: { op: string; object_type?: string; object_id?: string; data?: string }[];
          };
          checkpoint_complete?: unknown;
        };
        for (const op of message.data?.data ?? []) {
          if (!op.object_type || !op.object_id) continue;
          const table = rows.get(op.object_type) ?? new Map();
          rows.set(op.object_type, table);
          if (op.op === 'PUT') table.set(op.object_id, JSON.parse(op.data ?? '{}'));
          else if (op.op === 'REMOVE') table.delete(op.object_id);
        }
        if (message.checkpoint_complete) return rows;
      }
    }
    throw new Error('The sync stream ended before a checkpoint');
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

/** Syncs until `check` holds on the rows: replication reaches the service a moment after a commit. */
async function syncUntil(
  endpoint: string,
  token: string,
  check: (rows: StreamRows) => boolean,
): Promise<StreamRows> {
  const until = Date.now() + 60_000;
  for (;;) {
    let rows: StreamRows | null = null;
    try {
      rows = await syncOnce(endpoint, token);
    } catch {
      // Still starting.
    }
    if (rows && check(rows)) return rows;
    if (Date.now() > until) return rows ?? new Map();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const ids = (rows: StreamRows, table: string) => [...(rows.get(table)?.keys() ?? [])].sort();

describe.runIf(enabled)('the sync service on a real PostgreSQL', { timeout: 180_000 }, () => {
  let app: INestApplication;
  let api: TestApi;
  const db = createDatabase(inject('databaseUrl'));
  const database = new URL(inject('databaseUrl')).pathname.slice(1);
  const container = `vertex-food-sync-test-${process.pid}`;
  let endpoint = '';

  async function tokenOf(device: TestDevice): Promise<string> {
    const http = await device.device();
    const answer = await http.get('/api/sync/token').expect(200);
    expect(answer.body.endpoint).toBe(endpoint);
    return answer.body.token as string;
  }

  beforeAll(async () => {
    const syncPort = await freePort();
    endpoint = `http://127.0.0.1:${syncPort}`;
    app = await createTestApp({ env: { SYNC_ENDPOINT: endpoint } });
    // The sync service fetches the API's JWKS to check each PC's token: Docker Desktop reaches the
    // host's loopback, Docker on Linux the host's bridge address.
    await app.listen(0, process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1');
    const apiPort = (app.getHttpServer().address() as AddressInfo).port;
    api = new TestApi(app, db);

    // A clean bucket storage for this run (the storage role owns its database).
    const storageUrl = requireEnv('POWERSYNC_STORAGE_URI');
    const storage = new pg.Client({ connectionString: storageUrl });
    await storage.connect();
    await storage.query('DROP OWNED BY CURRENT_USER CASCADE');
    await storage.end();

    await run('docker', ['rm', '-f', container]).catch(() => undefined);
    await run('docker', [
      'run',
      '-d',
      '--name',
      container,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-p',
      `127.0.0.1:${syncPort}:8080`,
      '-v',
      `${CONFIG_DIR}:/config:ro`,
      '-e',
      'POWERSYNC_CONFIG_PATH=/config/service.yaml',
      '-e',
      `PS_DATA_SOURCE_URI=${fromContainer(requireEnv('DATABASE_SYNC_URL'), database)}`,
      '-e',
      'PS_DATA_SOURCE_SSLMODE=disable',
      '-e',
      `PS_STORAGE_SOURCE_URI=${fromContainer(storageUrl)}`,
      '-e',
      'PS_STORAGE_SSLMODE=disable',
      '-e',
      `PS_JWKS_URL=http://host.docker.internal:${apiPort}/api/.well-known/jwks.json`,
      '-e',
      `PS_ADMIN_TOKEN=test-${uuidv7()}`,
      '-e',
      'PS_PORT=8080',
      IMAGE,
      'start',
      '-r',
      'unified',
    ]);
    // The first run pulls the image (CI pulls it in a step of its own).
  }, 180_000);

  afterAll(async () => {
    await run('docker', ['rm', '-f', container]).catch(() => undefined);
    // The service's replication slot would keep this run's database from being dropped.
    const sync = new pg.Client({
      connectionString: Object.assign(new URL(requireEnv('DATABASE_SYNC_URL')), {
        pathname: `/${database}`,
      }).href,
    });
    await sync.connect();
    await sync.query(
      `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
       WHERE database = current_database() AND NOT active`,
    );
    await sync.end();
    await app?.close();
    await db.$client.end();
  }, 60_000);

  it("gives each PC its branch's commands once, with their outcome, and nothing of another branch or tenant", async () => {
    const setup = await api.ownerOnDevice(['main', 'east']);
    const [main, east] = setup.branchIds as [string, string];
    const hub = setup.device;
    const { device: standby } = await registerPc(api, setup, main, 1);
    const { device: eastHub } = await registerPc(api, setup, east, 2);
    const other = await api.ownerOnDevice();

    // The hub's and the standby's commands, each uploaded by both PCs in turn (rule 7).
    const member = { membershipId: setup.ownerMembershipId };
    const fromHub = [signedCommand(hub, member), signedCommand(hub, member)];
    const fromStandby = [signedCommand(standby, member)];
    const branchCommands: CommandEnvelope[] = [...fromHub, ...fromStandby];
    await upload(hub, [uploaded(fromHub[0] as CommandEnvelope)], 200);
    await upload(
      standby,
      branchCommands.map((c) => uploaded(c, false)),
      200,
    );
    const replay = await upload(
      hub,
      branchCommands.map((c) => uploaded(c)),
      200,
    );
    expect(replay.body.results.map((r: { replay: boolean }) => r.replay)).toEqual([
      true,
      true,
      true,
    ]);
    // Another branch's and another tenant's commands (a device actor: refused, still logged).
    const eastCommand = signedCommand(eastHub);
    await upload(eastHub, [uploaded(eastCommand)], 200);
    const otherCommand = signedCommand(other.device);
    await upload(other.device, [uploaded(otherCommand)], 200);

    const expected = branchCommands.map((c) => c.id).sort();
    const rows = await syncUntil(endpoint, await tokenOf(hub), (r) =>
      expected.every((id) => r.get('command_log')?.has(id)),
    );
    expect(ids(rows, 'command_log')).toEqual(expected);
    for (const id of expected) {
      expect(rows.get('command_log')?.get(id)).toMatchObject({ outcome: 'accepted' });
    }
    expect(ids(rows, 'devices')).toEqual([hub.deviceId, standby.deviceId].sort());
    expect(rows.get('devices')?.get(hub.deviceId)).toMatchObject({ hub_role: 'hub' });
    expect(rows.get('devices')?.get(standby.deviceId)).toMatchObject({ hub_role: 'standby' });
    expect(ids(rows, 'branches')).toEqual([main]);
    expect(ids(rows, 'tenants')).toEqual([setup.tenantId]);
    // The streams never carry a payload, a CA key or a member's secret (spec S04 "Data").
    expect(JSON.stringify([...rows.values()].map((t) => [...t.values()]))).not.toMatch(
      /payload|private_key|pin_verifier/,
    );

    // The standby's token reads the same branch; the east branch's PC only its own.
    const standbyRows = await syncUntil(endpoint, await tokenOf(standby), (r) =>
      expected.every((id) => r.get('command_log')?.has(id)),
    );
    expect(ids(standbyRows, 'command_log')).toEqual(expected);
    const eastRows = await syncUntil(endpoint, await tokenOf(eastHub), (r) =>
      Boolean(r.get('command_log')?.has(eastCommand.id)),
    );
    expect(ids(eastRows, 'command_log')).toEqual([eastCommand.id]);
    expect(ids(eastRows, 'devices')).toEqual([eastHub.deviceId]);
    const otherRows = await syncUntil(endpoint, await tokenOf(other.device), (r) =>
      Boolean(r.get('command_log')?.has(otherCommand.id)),
    );
    expect(ids(otherRows, 'command_log')).toEqual([otherCommand.id]);
    expect(ids(otherRows, 'tenants')).toEqual([other.tenantId]);
  });
});
