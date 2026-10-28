import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandRegistry, networkCheck, recordLocalEvents } from './commands/index.js';
import { createCommandRegistry } from './registry.js';

const context = {
  now: new Date('2026-10-28T10:00:00.120Z'),
  executedByDeviceId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7d',
};

describe('the command registry (rule 1)', () => {
  it('finds a command by name and version, and says why it cannot', () => {
    expect(commandRegistry.lookup('sync.network_check', 1)).toEqual({
      ok: true,
      definition: networkCheck,
    });
    expect(commandRegistry.lookup('sync.network_check', 2)).toEqual({
      ok: false,
      reason: 'version_unsupported',
    });
    expect(commandRegistry.lookup('orders.create', 1)).toEqual({
      ok: false,
      reason: 'unknown_command',
    });
  });

  it('holds S04’s two commands, each named in the registry form', () => {
    expect(commandRegistry.definitions().map((d) => `${d.name}@${d.version}`)).toEqual([
      'sync.network_check@1',
      'audit.record_local_events@1',
    ]);
  });

  it('refuses a command defined twice at one version', () => {
    expect(() => createCommandRegistry([networkCheck, networkCheck])).toThrow(/defined twice/);
  });
});

describe('sync.network_check', () => {
  const payload = {
    sentAt: '2026-10-28T10:00:00.000Z',
    sequence: 3,
    run: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7f',
  };

  it('needs hub.manage from a member, never a station', () => {
    expect(networkCheck.access).toEqual({
      actor: 'member',
      permission: 'hub.manage',
      station: false,
    });
  });

  it('records when the hub ran it and describes itself by its sequence', () => {
    const resolved = networkCheck.resolve(networkCheck.payload.parse(payload), context);
    expect(networkCheck.resolved.parse(resolved)).toEqual({
      receivedAt: '2026-10-28T10:00:00.120Z',
    });
    expect(networkCheck.describe(payload, resolved)).toEqual({
      key: 'commands.sync.network_check',
      params: { sequence: 3 },
    });
  });

  it('refuses a sequence below 1 or a run that is not an id', () => {
    expect(networkCheck.payload.safeParse({ ...payload, sequence: 0 }).success).toBe(false);
    expect(networkCheck.payload.safeParse({ ...payload, run: 'run-1' }).success).toBe(false);
  });
});

describe('audit.record_local_events', () => {
  const event = {
    action: 'hub.promoted',
    at: '2026-10-28T10:00:00.000Z',
    details: { fromEpoch: 1, toEpoch: 2, manual: false },
  };

  it('is made by the PC itself, with one to 200 local events', () => {
    expect(recordLocalEvents.access).toEqual({ actor: 'device' });
    expect(recordLocalEvents.payload.safeParse({ events: [event] }).success).toBe(true);
    expect(recordLocalEvents.payload.safeParse({ events: [] }).success).toBe(false);
    expect(recordLocalEvents.payload.safeParse({ events: Array(201).fill(event) }).success).toBe(
      false,
    );
  });

  it('takes only local event actions and flat details', () => {
    expect(
      recordLocalEvents.payload.safeParse({ events: [{ ...event, action: 'staff.added' }] })
        .success,
    ).toBe(false);
    expect(
      recordLocalEvents.payload.safeParse({ events: [{ ...event, details: { nested: { a: 1 } } }] })
        .success,
    ).toBe(false);
  });

  it('describes itself by its count', () => {
    expect(recordLocalEvents.describe({ events: [event, event] } as never, {})).toEqual({
      key: 'commands.audit.record_local_events',
      params: { count: 2 },
    });
  });
});

describe('runtime boundary', () => {
  // Hub client pages load this package in a browser: only node.ts may import a Node built-in.
  it('keeps Node built-ins out of every source file but node.ts', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const offenders = files(root)
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .filter((path) => !path.endsWith('node.ts'))
      .filter((path) => /from ['"]node:/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
