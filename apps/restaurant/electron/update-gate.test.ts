import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempFolder } from './device-test-kit.js';
import { UPDATE_CHECK_MS, UpdateGate } from './update-gate.js';

const feedUrl = 'https://updates.example.test/restaurant/feed.json';
const installer = Buffer.from('synthetic installer bytes');
const sha256 = createHash('sha256').update(installer).digest('hex');

afterEach(() => {
  vi.useRealTimers();
});

function setup(
  feed: unknown = { version: '1.3.0', url: 'https://updates.example.test/r/1.3.0.exe', sha256 },
) {
  const directory = tempFolder();
  const fetch = vi.fn(async (url: string | URL | Request) =>
    String(url) === feedUrl ? Response.json(feed) : new Response(installer),
  );
  const install = vi.fn();
  const make = (appVersion = '1.2.0', url: string | null = feedUrl) =>
    new UpdateGate({
      feedUrl: url,
      appVersion,
      directory,
      fetch: fetch as unknown as typeof globalThis.fetch,
      install,
      onChange: () => undefined,
    });
  return { directory, fetch, install, make };
}

describe('the update gate (spec S04 rule 46)', () => {
  it('downloads a newer version in the background and keeps it for the next start', async () => {
    const { make, directory, fetch } = setup();
    const gate = make();
    await gate.check();
    expect(gate.ready()).toMatchObject({ version: '1.3.0' });
    expect(readFileSync(join(directory, 'update-1.3.0.exe'))).toEqual(installer);
    // Downloaded once.
    await gate.check();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps nothing whose SHA-256 differs, and nothing not newer', async () => {
    const wrong = setup({
      version: '1.3.0',
      url: 'https://updates.example.test/r.exe',
      sha256: 'c'.repeat(64),
    });
    const gate = wrong.make();
    await expect(gate.check()).rejects.toThrow('SHA-256');
    expect(gate.ready()).toBeNull();
    const same = setup({ version: '1.2.0', url: 'https://updates.example.test/r.exe', sha256 });
    await same.make().check();
    expect(same.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a feed or a download that is not HTTPS', async () => {
    const { make } = setup({ version: '1.3.0', url: 'http://updates.example.test/r.exe', sha256 });
    await expect(make().check()).rejects.toThrow();
  });

  it('checks every 6 hours, and never without a feed', async () => {
    vi.useFakeTimers();
    const { make, fetch } = setup({
      version: '1.0.0',
      url: 'https://updates.example.test/r.exe',
      sha256,
    });
    make('1.2.0', null).start();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS);
    expect(fetch).not.toHaveBeenCalled();
    const gate = make();
    gate.start();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    gate.stop();
  });

  it('installs at start only with an empty queue and every journal entry settled', async () => {
    const { make, install, directory } = setup();
    const gate = make();
    await gate.check();
    expect(await gate.installAtStart({ uploads: 3, unsettled: 0 })).toBe('waiting');
    expect(await gate.installAtStart({ uploads: 0, unsettled: 1 })).toBe('waiting');
    expect(install).not.toHaveBeenCalled();
    expect(await gate.installAtStart({ uploads: 0, unsettled: 0 })).toBe('installed');
    expect(install).toHaveBeenCalledWith(join(directory, 'update-1.3.0.exe'));
  });

  it('installs with work pending once the server refused this version protocol', async () => {
    const { make, install } = setup();
    const gate = make();
    await gate.check();
    gate.noteProtocolRefused();
    expect(await gate.installAtStart({ uploads: 3, unsettled: 2 })).toBe('installed');
    expect(install).toHaveBeenCalled();
  });

  it('never installs a file changed on the disk, and clears what an applied update left', async () => {
    const { make, install, directory } = setup();
    await make().check();
    // The new version started: the download is no longer newer.
    expect(await make('1.3.0').installAtStart({ uploads: 0, unsettled: 0 })).toBe('none');
    expect(existsSync(join(directory, 'update-1.3.0.exe'))).toBe(false);
    const gate = make();
    await gate.check();
    writeFileSync(join(directory, 'update-1.3.0.exe'), 'tampered');
    expect(await gate.installAtStart({ uploads: 0, unsettled: 0 })).toBe('none');
    expect(install).not.toHaveBeenCalled();
  });
});
