import { createHmac, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import {
  activeDataExportStatuses,
  assertDataExportAllowed,
  type DataExport,
  type DataExportLink,
  type DataExportPage,
  DomainError,
  dataExportAllowance,
  dataExportPolicy,
} from '@vertex-food/contracts';
import {
  type Database,
  dataExportChunks,
  dataExportLinks,
  dataExports,
  enterTenant,
  staffMemberships,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import type { Config } from '../../../core/config/config.js';
import { CONFIG } from '../../../core/config/config.module.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { databaseNow } from '../../../core/database/database-now.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { emit } from '../../../core/events/outbox.js';
import { type ByteRange, parseByteRange } from './byte-range.js';
import { type DataExportRow, toDataExport } from './data-export.views.js';

/** The transaction setting through which the file route sees one link (`data_export_link_lookup`). */
const TOKEN_HASH_SETTING = 'app.export_token_hash';

/** The public path of a download link; the token is its only secret (rule 16). */
export const DATA_EXPORT_FILES_PATH = '/api/data-exports/files/';

const notFound = () => new DomainError('NOT_FOUND', 'No such export');

/** A download as the file route answers it. */
export type DataExportDownload = {
  fileName: string;
  byteSize: number;
  sha256: string;
  range: ByteRange;
  /** The bytes of the range (or of the whole file), read one stored chunk at a time. */
  open(): Readable;
};

/**
 * The restaurant's data export (spec S06, ADR 0016, 0037): the owner requests it (re-auth, one
 * active, 3 a Damascus day), follows it and creates short-lived download links; the worker builds
 * the file (`data-export.build`) and expires it. The public file route serves a link's export by
 * the token alone, in ranges, never naming the token in a log or an error.
 */
@Injectable()
export class DataExportService {
  private readonly hashKey: Buffer;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) config: Config,
  ) {
    this.hashKey = config.identity.hashKey;
  }

  /** Rules 6–9: the row, its audit entry and `data_export.requested.v1` in one transaction. */
  request(actor: StaffActor): Promise<DataExport> {
    requirePermission(actor, 'data.export');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      await assertNoneActive(tx);
      const now = await databaseNow(tx);
      assertDataExportAllowed(await requestedToday(tx, now), now);
      // In a savepoint: when another owner's request got in first (edge case 7), the index
      // refuses this one and the transaction still reads theirs.
      const [row] = await tx
        .transaction((savepoint) =>
          savepoint
            .insert(dataExports)
            .values({ tenantId: actor.tenantId, requestedBy: actor.accountId, requestedAt: now })
            .returning(),
        )
        .catch(async (error: unknown) => {
          if (isUniqueViolation(error, 'data_exports_one_active_idx')) await assertNoneActive(tx);
          throw error;
        });
      if (!row) throw new Error('No export inserted');
      await audit(tx, actor.tenantId, actor, {
        action: 'data_export.requested',
        entityType: 'data_export',
        entityId: row.id,
      });
      await emit(tx, actor.tenantId, 'data_export.requested.v1', {
        tenantId: actor.tenantId,
        exportId: row.id,
      });
      return (await this.views(tx, [row]))[0] as DataExport;
    });
  }

  /** The history, newest first, 20 a page, with today's allowance (rule 8). */
  list(actor: StaffActor, before?: string): Promise<DataExportPage> {
    requirePermission(actor, 'data.export');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(dataExports)
        .where(before ? lt(dataExports.id, before) : undefined)
        .orderBy(desc(dataExports.id))
        .limit(dataExportPolicy.pageSize + 1);
      const items = rows.slice(0, dataExportPolicy.pageSize);
      const now = await databaseNow(tx);
      const { remainingToday, nextAllowedAt } = dataExportAllowance(
        await requestedToday(tx, now),
        now,
      );
      return {
        items: await this.views(tx, items),
        nextBefore: rows.length > items.length ? (items.at(-1)?.id ?? null) : null,
        remainingToday,
        nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
      };
    });
  }

  get(actor: StaffActor, id: string): Promise<DataExport> {
    requirePermission(actor, 'data.export');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(dataExports).where(eq(dataExports.id, id));
      if (!row) throw notFound();
      return (await this.views(tx, [row]))[0] as DataExport;
    });
  }

  /**
   * Rule 16: a link to a ready export of the session's tenant, checked now and not on each range
   * request; a random 32-byte token stored only as its keyed hash, valid 10 minutes, audited.
   * Another tenant's, a failed or an expired export answers `NOT_FOUND`; one not built yet
   * `EXPORT_NOT_READY`.
   */
  link(actor: StaffActor, id: string): Promise<DataExportLink> {
    requirePermission(actor, 'data.export');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(dataExports).where(eq(dataExports.id, id));
      if (!row) throw notFound();
      if (row.status === 'queued' || row.status === 'running') {
        throw new DomainError('EXPORT_NOT_READY', 'The export is not built yet', { exportId: id });
      }
      const now = await databaseNow(tx);
      if (row.status !== 'ready' || !row.expiresAt || row.expiresAt <= now) throw notFound();
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + dataExportPolicy.linkMinutes * 60_000);
      const [link] = await tx
        .insert(dataExportLinks)
        .values({
          tenantId: actor.tenantId,
          exportId: id,
          createdBy: actor.accountId,
          tokenHash: this.tokenHash(token),
          expiresAt,
          createdAt: now,
        })
        .returning({ id: dataExportLinks.id });
      await audit(tx, actor.tenantId, actor, {
        action: 'data_export.downloaded',
        entityType: 'data_export',
        entityId: id,
        details: { linkId: link?.id ?? null },
      });
      return { url: `${DATA_EXPORT_FILES_PATH}${token}`, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * Rule 17: the export of a live link, by its token alone. The link is found through its hash
   * (`data_export_link_lookup`), then the export is read inside the link's tenant. An unknown or
   * expired token and an export no longer ready all answer the same `NOT_FOUND`.
   */
  async download(token: string, rangeHeader: string | undefined): Promise<DataExportDownload> {
    const hash = this.tokenHash(token);
    const found = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config(${TOKEN_HASH_SETTING}, ${hash}, true)`);
      const [link] = await tx
        .select({
          tenantId: dataExportLinks.tenantId,
          exportId: dataExportLinks.exportId,
          expiresAt: dataExportLinks.expiresAt,
        })
        .from(dataExportLinks)
        .where(eq(dataExportLinks.tokenHash, hash));
      const now = await databaseNow(tx);
      if (!link || link.expiresAt <= now) return null;
      // The tenant comes from the link the token's hash names, never from the request.
      await enterTenant(tx, link.tenantId);
      const [row] = await tx
        .select()
        .from(dataExports)
        .where(and(eq(dataExports.id, link.exportId), eq(dataExports.status, 'ready')));
      if (!row?.fileName || row.byteSize === null || !row.sha256) return null;
      if (!row.expiresAt || row.expiresAt <= now) return null;
      return {
        tenantId: link.tenantId,
        exportId: row.id,
        fileName: row.fileName,
        byteSize: row.byteSize,
        sha256: row.sha256,
      };
    });
    if (!found) throw notFound();
    const range = parseByteRange(rangeHeader, found.byteSize);
    const [start, end] =
      range.kind === 'partial' ? [range.start, range.end] : [0, found.byteSize - 1];
    return {
      fileName: found.fileName,
      byteSize: found.byteSize,
      sha256: found.sha256,
      range,
      open: () =>
        range.kind === 'unsatisfiable'
          ? Readable.from([])
          : Readable.from(this.chunks(found.tenantId, found.exportId, start, end)),
    };
  }

  /** The bytes `start`–`end` (included), one stored chunk read at a time. */
  private async *chunks(
    tenantId: string,
    exportId: string,
    start: number,
    end: number,
  ): AsyncGenerator<Buffer> {
    const size = dataExportPolicy.chunkBytes;
    for (let seq = Math.floor(start / size); seq <= Math.floor(end / size); seq += 1) {
      const [chunk] = await withTenant(this.db, tenantId, (tx) =>
        tx
          .select({ bytes: dataExportChunks.bytes })
          .from(dataExportChunks)
          .where(and(eq(dataExportChunks.exportId, exportId), eq(dataExportChunks.seq, seq))),
      );
      // Edge case 13: the export expired during the download.
      if (!chunk) throw new Error(`A chunk of export ${exportId} is gone`);
      const offset = seq * size;
      yield chunk.bytes.subarray(
        Math.max(0, start - offset),
        Math.min(chunk.bytes.length, end - offset + 1),
      );
    }
  }

  /** HMAC-SHA-256 under `IDENTITY_HASH_KEY`, hex, as `data_export_links.token_hash` holds it. */
  private tokenHash(token: string): string {
    return createHmac('sha256', this.hashKey).update(`data-export.link\n${token}`).digest('hex');
  }

  /** The exports with their requesters' names in this tenant. */
  private async views(tx: Transaction, rows: DataExportRow[]): Promise<DataExport[]> {
    const accountIds = [...new Set(rows.map((row) => row.requestedBy))];
    const members =
      accountIds.length === 0
        ? []
        : await tx
            .select({
              accountId: staffMemberships.accountId,
              displayName: staffMemberships.displayName,
            })
            .from(staffMemberships)
            .where(inArray(staffMemberships.accountId, accountIds));
    const names = new Map(members.map((member) => [member.accountId, member.displayName]));
    return rows.map((row) => toDataExport(row, names.get(row.requestedBy) ?? null));
  }
}

/** Rule 7: `EXPORT_IN_PROGRESS` with the tenant's active export. */
async function assertNoneActive(tx: Transaction): Promise<void> {
  const [active] = await tx
    .select({ id: dataExports.id })
    .from(dataExports)
    .where(inArray(dataExports.status, [...activeDataExportStatuses]));
  if (active) {
    throw new DomainError('EXPORT_IN_PROGRESS', 'An export is already being prepared', {
      exportId: active.id,
    });
  }
}

/**
 * The request times of today's exports that did not fail (rule 8), from the start of the day
 * before `now` at most: the Damascus day is read from them by `dataExportAllowance`.
 */
async function requestedToday(tx: Transaction, now: Date): Promise<Date[]> {
  const rows = await tx
    .select({ requestedAt: dataExports.requestedAt })
    .from(dataExports)
    .where(
      and(
        ne(dataExports.status, 'failed'),
        gte(dataExports.requestedAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  return rows.map((row) => row.requestedAt);
}
