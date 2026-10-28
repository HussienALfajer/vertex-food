import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { appVersionSchema, compareAppVersions, sha256HexSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import type { Fetch } from './device-client.js';
import type { PendingCounts } from './pending-work.js';

// The update gate (spec S04 rule 46, ADR 0035): the app checks its feed every 6 hours while online
// and downloads a newer installer in the background; it installs only at the next start, when the
// upload queue is empty and every journal entry it holds has a server outcome, so a PC with pending
// work keeps the version that made it. The feed's hosting and the installer's signing come with
// the deploy skeleton (Q1): the feed answers `{ version, url, sha256 }` over HTTPS, and the
// download is kept only when its SHA-256 matches.

export const UPDATE_CHECK_MS = 6 * 3600_000;

export const updateFeedSchema = z.object({
  version: appVersionSchema,
  url: z.url({ protocol: /^https$/ }),
  sha256: sha256HexSchema,
});

const readySchema = z.object({
  version: appVersionSchema,
  file: z.string(),
  sha256: sha256HexSchema,
});

type Ready = z.infer<typeof readySchema>;

const READY_FILE = 'ready.json';
/** Written when the server refused this app's sync protocol: its queue can never drain. */
const PROTOCOL_REFUSED_FILE = 'protocol-refused';
const TIMEOUT_MS = 30 * 60_000;

export type UpdateGateDeps = {
  /** The feed's HTTPS URL; null disables the gate (no feed configured). */
  feedUrl: string | null;
  appVersion: string;
  /** Where downloads wait for the next start. */
  directory: string;
  fetch?: Fetch;
  /** Starts the installer; the app quits after it. */
  install: (file: string) => void;
  onChange: () => void;
};

export type InstallDecision = 'installed' | 'waiting' | 'none';

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export class UpdateGate {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<void> | null = null;

  constructor(private readonly deps: UpdateGateDeps) {
    mkdirSync(deps.directory, { recursive: true });
  }

  /** A downloaded update newer than this app, waiting for a start. */
  ready(): Ready | null {
    try {
      const ready = readySchema.parse(
        JSON.parse(readFileSync(join(this.deps.directory, READY_FILE), 'utf8')),
      );
      return compareAppVersions(ready.version, this.deps.appVersion) > 0 ? ready : null;
    } catch {
      return null;
    }
  }

  /** The check now and every 6 hours; an offline check fails quietly and waits for the next. */
  start(): void {
    if (!this.deps.feedUrl) return;
    void this.check().catch(() => undefined);
    this.timer = setInterval(() => void this.check().catch(() => undefined), UPDATE_CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check of the feed, downloading a newer version not downloaded yet. */
  check(): Promise<void> {
    this.checking ??= this.checkOnce().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async checkOnce(): Promise<void> {
    const { feedUrl } = this.deps;
    if (!feedUrl) return;
    const fetchFn = this.deps.fetch ?? fetch;
    const response = await fetchFn(feedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Update feed answered ${response.status}`);
    const feed = updateFeedSchema.parse(await response.json());
    if (compareAppVersions(feed.version, this.deps.appVersion) <= 0) return;
    if (this.ready()?.version === feed.version) return;
    const file = `update-${feed.version}${extname(new URL(feed.url).pathname) || '.exe'}`;
    const path = join(this.deps.directory, file);
    const partial = `${path}.partial`;
    const download = await fetchFn(feed.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!(download.ok && download.body))
      throw new Error(`Update download answered ${download.status}`);
    const hash = createHash('sha256');
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(download.body as WebReadableStream<Uint8Array>),
      hashing,
      createWriteStream(partial),
    );
    if (hash.digest('hex') !== feed.sha256) {
      rmSync(partial, { force: true });
      throw new Error('The update does not match its SHA-256');
    }
    renameSync(partial, path);
    const ready: Ready = { version: feed.version, file, sha256: feed.sha256 };
    writeFileSync(join(this.deps.directory, READY_FILE), JSON.stringify(ready));
    this.deps.onChange();
  }

  /** The server refused this app's protocol: the next start installs even with work pending. */
  noteProtocolRefused(): void {
    writeFileSync(join(this.deps.directory, PROTOCOL_REFUSED_FILE), '');
  }

  /**
   * At start, before the windows open: installs a downloaded update when nothing is waiting to
   * upload and every journal entry has its outcome (rule 46), or when the server refused this
   * version's protocol, so the queue could never drain otherwise; the database stays, and the new
   * version uploads it. Otherwise the old version starts and the next start tries again.
   */
  async installAtStart(pending: PendingCounts): Promise<InstallDecision> {
    const ready = this.ready();
    if (!ready) {
      this.clear();
      return 'none';
    }
    const refused = existsSync(join(this.deps.directory, PROTOCOL_REFUSED_FILE));
    if (!refused && (pending.uploads > 0 || pending.unsettled > 0)) return 'waiting';
    const path = join(this.deps.directory, ready.file);
    if (!existsSync(path) || (await sha256Of(path)) !== ready.sha256) {
      this.clear();
      return 'none';
    }
    this.deps.install(path);
    return 'installed';
  }

  /** Nothing newer than this app is waiting: what an earlier update left goes. */
  private clear(): void {
    rmSync(this.deps.directory, { recursive: true, force: true });
    mkdirSync(this.deps.directory, { recursive: true });
  }
}
