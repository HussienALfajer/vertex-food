import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type StoredFile } from '@vertex-food/contracts';
import { type Database, files, type Transaction, withTenant } from '@vertex-food/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { DATABASE } from '../../../core/database/database.module.js';
import type { EncodedImage } from './image-encoding.js';

type FileRow = typeof files.$inferSelect;

export function toFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    purpose: row.purpose as StoredFile['purpose'],
    mediaType: row.mediaType as StoredFile['mediaType'],
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Files of a tenant (module `files`, spec S01): stores re-encoded images and serves them. Other
 * modules store and archive files inside their own transaction, so the file and the record that
 * points at it commit together.
 */
@Injectable()
export class FilesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Stores an encoded image in the transaction of `tenantId`. */
  async store(tx: Transaction, tenantId: string, image: EncodedImage): Promise<StoredFile> {
    const [row] = await tx
      .insert(files)
      .values({
        tenantId,
        purpose: image.purpose,
        mediaType: image.mediaType,
        bytes: image.bytes,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
      })
      .returning();
    if (!row) throw new Error('No file inserted');
    return toFile(row);
  }

  /** Archives a file the tenant replaced or removed; it stays readable and is never deleted. */
  async archive(tx: Transaction, fileId: string): Promise<void> {
    await tx
      .update(files)
      .set({ archivedAt: new Date() })
      .where(and(eq(files.id, fileId), isNull(files.archivedAt)));
  }

  /** The bytes of one of the session tenant's files; another tenant's id is `NOT_FOUND`. */
  async read(actor: StaffActor, id: string): Promise<{ mediaType: string; bytes: Buffer }> {
    // Checked here too, not only by the route (apps/api/CLAUDE.md, Rules).
    requirePermission(actor, 'tenant.view');

    const [row] = await withTenant(this.db, actor.tenantId, (tx) =>
      tx
        .select({ mediaType: files.mediaType, bytes: files.bytes })
        .from(files)
        .where(eq(files.id, id)),
    );
    if (!row) throw new DomainError('NOT_FOUND', 'No such file');
    return row;
  }
}
