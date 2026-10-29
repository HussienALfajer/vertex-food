import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CSV_BOM,
  type DataExportFailure,
  dataExportExpiresAt,
  dataExportFileName,
  dataExportPolicy,
  EXPORT_FORMAT_VERSION,
  type ExportManifest,
  eventCatalog,
  exportHeaderLine,
  exportManifestSchema,
  exportRowLine,
} from '@vertex-food/contracts';
import {
  and,
  auditEntries,
  type Database,
  dataExportChunks,
  dataExports,
  type ExportDataset,
  eq,
  exportDatasets,
  inArray,
  sql,
  type Transaction,
  tenantSlugs,
  withTenant,
  withTenantSnapshot,
} from '@vertex-food/db';
import type { Job } from 'pg-boss';
import { JOBS_DATABASE } from '../../core/jobs-database/jobs-database.module.js';
import type { OutboxJobData, QueueJob } from '../../core/queue/queue-job.js';
import { exportColumnsCsv, exportReadme } from './texts.js';
import { ZipTooLargeError, ZipWriter } from './zip.js';

/** What a build reads and the caps it keeps (spec S06 rule 12); tests shrink them. */
export type DataExportBuildSettings = {
  datasets: readonly ExportDataset[];
  maxBytes: number;
  maxBuildMs: number;
  chunkBytes: number;
};

export const DATA_EXPORT_BUILD_SETTINGS = Symbol('DataExportBuildSettings');

const defaultSettings: DataExportBuildSettings = {
  datasets: exportDatasets,
  maxBytes: dataExportPolicy.maxBytes,
  maxBuildMs: dataExportPolicy.maxBuildMinutes * 60_000,
  chunkBytes: dataExportPolicy.chunkBytes,
};

/** Text gathered per piece handed to the compressor. */
const PIECE_CHARS = 64 * 1024;

/** A build stopped by a cap: the export fails with this reason, with no retry. */
class BuildFailure extends Error {
  constructor(readonly failure: Exclude<DataExportFailure, 'server_error'>) {
    super(`The export failed: ${failure}`);
  }
}

/** Another attempt took the export over, or it is no longer running: this one stops quietly. */
class Superseded extends Error {
  constructor() {
    super('The export is no longer this attempt’s');
  }
}

/** One attempt at one export: the tenant, the export and the attempt's start, its token. */
type Attempt = { tenantId: string; exportId: string; startedAt: Date };

/**
 * Builds a restaurant's data export (spec S06 rules 10–12, 15, "Jobs"), on
 * `data_export.requested.v1`: claims the export (`running`, `started_at`, any chunks of an earlier
 * attempt deleted), reads every dataset in one `REPEATABLE READ, READ ONLY` transaction inside the
 * export's tenant, so the files agree at `as_of`, and streams the ZIP into 1 MiB chunks as it
 * reads. A ready file gets its size, hash, row counts and `data_export.completed`; a file past
 * 1 GiB or a build past 30 minutes fails at once (`too_large`, `timed_out`, chunks deleted,
 * `data_export.failed`); any other error is retried with backoff, and after the third attempt, a
 * crash or a lost heartbeat included, pg-boss hands the job to `failed` (`server_error`).
 *
 * Safe twice: a `ready`, `failed` or `expired` export is skipped, one left `running` is rebuilt
 * from the start with a new `as_of`. `started_at` names the attempt that owns the export: each
 * chunk and the final change are written only while the row still holds it, under its lock, so
 * an attempt left behind by a retry stops at its next write. Runs as the jobs role; its statements
 * hold ids and codes, the file's bytes only as chunk parameters.
 */
@Injectable()
export class DataExportBuildJob implements QueueJob {
  readonly queue = 'data-export.build';
  readonly events = ['data_export.requested.v1'];
  readonly options = {
    retryLimit: dataExportPolicy.maxAttempts - 1,
    retryDelay: 30,
    retryBackoff: true,
    // Past the 30-minute cap, so a live build is never retried under it; a crash is noticed by
    // its missing heartbeat instead.
    expireInSeconds: (dataExportPolicy.maxBuildMinutes + 5) * 60,
    heartbeatSeconds: 30,
  };

  private readonly settings: DataExportBuildSettings;

  constructor(
    @Inject(JOBS_DATABASE) private readonly db: Database,
    @Optional() @Inject(DATA_EXPORT_BUILD_SETTINGS) settings?: Partial<DataExportBuildSettings>,
  ) {
    this.settings = { ...defaultSettings, ...settings };
  }

  private get actorName() {
    return this.queue.replace('.', '/');
  }

  async work(jobs: Job<OutboxJobData>[]): Promise<void> {
    for (const job of jobs) {
      const { tenantId, exportId } = eventCatalog['data_export.requested.v1'].parse(
        job.data.payload,
      );
      await this.build(tenantId, exportId, job.signal);
    }
  }

  /** Every attempt failed (rule 12): the export fails with `server_error`. */
  async failed(jobs: Job<OutboxJobData>[]): Promise<void> {
    for (const job of jobs) {
      const { tenantId, exportId } = eventCatalog['data_export.requested.v1'].parse(
        job.data.payload,
      );
      await this.fail({ tenantId, exportId, startedAt: null }, 'server_error');
    }
  }

  /** One attempt; answers the export's status once it ends, or null when it was skipped. */
  async build(
    tenantId: string,
    exportId: string,
    signal?: AbortSignal,
  ): Promise<'ready' | 'failed' | null> {
    const attempt = await this.claim(tenantId, exportId);
    if (!attempt) return null;
    const deadline = attempt.startedAt.getTime() + this.settings.maxBuildMs;
    const check = () => {
      signal?.throwIfAborted();
      if (Date.now() > deadline) throw new BuildFailure('timed_out');
    };
    try {
      await this.write(attempt, check);
      return 'ready';
    } catch (error) {
      if (error instanceof Superseded) return null;
      const failure =
        error instanceof BuildFailure
          ? error.failure
          : error instanceof ZipTooLargeError
            ? 'too_large'
            : Date.now() > deadline
              ? 'timed_out'
              : null;
      if (!failure) throw error;
      await this.fail(attempt, failure);
      return 'failed';
    }
  }

  /** `queued` or `running` → `running` with this attempt's start, earlier chunks deleted. */
  private claim(tenantId: string, exportId: string): Promise<Attempt | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ status: dataExports.status })
        .from(dataExports)
        .where(
          and(eq(dataExports.id, exportId), inArray(dataExports.status, ['queued', 'running'])),
        )
        .for('update');
      if (!row) return null;
      const startedAt = new Date();
      await tx.delete(dataExportChunks).where(eq(dataExportChunks.exportId, exportId));
      await tx
        .update(dataExports)
        .set({ status: 'running', startedAt, updatedAt: startedAt })
        .where(eq(dataExports.id, exportId));
      return { tenantId, exportId, startedAt };
    });
  }

  /** Locks the export while this attempt still owns it; throws `Superseded` otherwise. */
  private async owned(tx: Transaction, attempt: Attempt) {
    const [row] = await tx
      .select({ id: dataExports.id })
      .from(dataExports)
      .where(
        and(
          eq(dataExports.id, attempt.exportId),
          eq(dataExports.status, 'running'),
          eq(dataExports.startedAt, attempt.startedAt),
        ),
      )
      .for('update');
    if (!row) throw new Superseded();
  }

  /** Reads the snapshot, streams the ZIP into chunks, then marks the export ready. */
  private async write(attempt: Attempt, check: () => void) {
    const { tenantId, exportId } = attempt;
    const { datasets, maxBytes, chunkBytes } = this.settings;
    const whole = createHash('sha256');
    let byteSize = 0;
    let seq = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    const store = (bytes: Buffer) =>
      withTenant(this.db, tenantId, async (tx) => {
        await this.owned(tx, attempt);
        await tx.insert(dataExportChunks).values({ tenantId, exportId, seq, bytes });
        seq += 1;
      });
    const out = async (bytes: Buffer) => {
      check();
      byteSize += bytes.length;
      if (byteSize > maxBytes) throw new BuildFailure('too_large');
      whole.update(bytes);
      pending.push(bytes);
      pendingBytes += bytes.length;
      while (pendingBytes >= chunkBytes) {
        const all = Buffer.concat(pending);
        await store(all.subarray(0, chunkBytes));
        const rest = all.subarray(chunkBytes);
        pending = rest.length > 0 ? [rest] : [];
        pendingBytes = rest.length;
      }
    };

    const built = await withTenantSnapshot(this.db, tenantId, async (tx) => {
      // `now()` is the read transaction's start: the snapshot's instant.
      const { rows } = await tx.execute<{ asOf: Date }>(sql`select now() as "asOf"`);
      const asOfDate = new Date(rows[0]?.asOf ?? Number.NaN);
      const [primary] = await tx
        .select({ slug: tenantSlugs.slug })
        .from(tenantSlugs)
        .where(and(eq(tenantSlugs.subjectTenantId, tenantId), eq(tenantSlugs.isPrimary, true)));
      if (!primary) throw new Error('The tenant has no primary slug');
      const zip = new ZipWriter(out, asOfDate);
      const files: ExportManifest['files'] = [];
      const rowCounts: Record<string, number> = {};
      /** `rows` is read once the entry is written: a CSV's count is known only then. */
      const add = async (
        path: string,
        content: AsyncIterable<Buffer>,
        rows: () => number | null = () => null,
      ) => {
        const sha256 = await zip.add(path, content);
        files.push({ path, rows: rows(), sha256 });
      };
      await add('README.txt', once(exportReadme(datasets, asOfDate)));
      await add('columns.csv', once(exportColumnsCsv(datasets)));
      for (const dataset of datasets) {
        const path = `${dataset.stem}.csv`;
        const counter = { rows: 0 };
        await add(path, csv(dataset, tx, tenantId, counter, check), () => counter.rows);
        rowCounts[path] = counter.rows;
        for await (const file of dataset.files?.(tx, { tenantId }) ?? []) {
          check();
          await add(file.path, single(file.bytes));
        }
      }
      const manifest = exportManifestSchema.parse({
        formatVersion: EXPORT_FORMAT_VERSION,
        tenantId,
        slug: primary.slug,
        asOf: asOfDate.toISOString(),
        generatedAt: new Date().toISOString(),
        files,
      } satisfies ExportManifest);
      await zip.add('manifest.json', once(`${JSON.stringify(manifest, null, 2)}\n`));
      await zip.finish();
      return { asOf: asOfDate, slug: primary.slug, rowCounts };
    });
    if (pendingBytes > 0) await store(Buffer.concat(pending));

    await withTenant(this.db, tenantId, async (tx) => {
      await this.owned(tx, attempt);
      const finishedAt = new Date();
      await tx
        .update(dataExports)
        .set({
          status: 'ready',
          asOf: built.asOf,
          finishedAt,
          expiresAt: dataExportExpiresAt(finishedAt),
          fileName: dataExportFileName(built.slug, built.asOf),
          byteSize,
          sha256: whole.digest('hex'),
          rowCounts: built.rowCounts,
          updatedAt: finishedAt,
        })
        .where(eq(dataExports.id, exportId));
      await tx.insert(auditEntries).values({
        tenantId,
        actorKind: 'system',
        actorName: this.actorName,
        action: 'data_export.completed',
        entityType: 'data_export',
        entityId: exportId,
        details: { byteSize, rowCounts: built.rowCounts },
        occurredAt: finishedAt,
      });
    });
  }

  /**
   * `failed` with its reason, the chunks deleted, `data_export.failed`. For an attempt, only while
   * it still owns the export; after every attempt (`startedAt` null), whatever attempt ran last.
   */
  private async fail(
    attempt: Omit<Attempt, 'startedAt'> & { startedAt: Date | null },
    failure: DataExportFailure,
  ) {
    const { tenantId, exportId, startedAt } = attempt;
    await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: dataExports.id })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.id, exportId),
            startedAt
              ? and(eq(dataExports.status, 'running'), eq(dataExports.startedAt, startedAt))
              : inArray(dataExports.status, ['queued', 'running']),
          ),
        )
        .for('update');
      if (!row) return;
      const finishedAt = new Date();
      await tx.delete(dataExportChunks).where(eq(dataExportChunks.exportId, exportId));
      await tx
        .update(dataExports)
        .set({ status: 'failed', failure, finishedAt, updatedAt: finishedAt })
        .where(eq(dataExports.id, exportId));
      await tx.insert(auditEntries).values({
        tenantId,
        actorKind: 'system',
        actorName: this.actorName,
        action: 'data_export.failed',
        entityType: 'data_export',
        entityId: exportId,
        details: { failure },
        occurredAt: finishedAt,
      });
    });
  }
}

async function* once(text: string): AsyncIterable<Buffer> {
  yield Buffer.from(text, 'utf8');
}

async function* single(bytes: Buffer): AsyncIterable<Buffer> {
  yield bytes;
}

/** A dataset's CSV, read page by page and handed on in pieces; counts its rows. */
async function* csv(
  dataset: ExportDataset,
  tx: Transaction,
  tenantId: string,
  counter: { rows: number },
  check: () => void,
): AsyncIterable<Buffer> {
  let text = CSV_BOM + exportHeaderLine(dataset.columns);
  for await (const row of dataset.rows(tx, { tenantId })) {
    check();
    text += exportRowLine(dataset.columns, row);
    counter.rows += 1;
    if (text.length >= PIECE_CHARS) {
      yield Buffer.from(text, 'utf8');
      text = '';
    }
  }
  yield Buffer.from(text, 'utf8');
}
