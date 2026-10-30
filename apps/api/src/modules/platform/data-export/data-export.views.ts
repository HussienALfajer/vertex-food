import type { DataExport, DataExportFailure, DataExportStatus } from '@vertex-food/contracts';
import type { dataExports } from '@vertex-food/db';

export type DataExportRow = typeof dataExports.$inferSelect;

/** An export as the owner sees it, with the requester's name in this tenant. */
export function toDataExport(row: DataExportRow, requesterName: string | null): DataExport {
  return {
    id: row.id,
    status: row.status as DataExportStatus,
    formatVersion: 1,
    requestedBy: { accountId: row.requestedBy, name: requesterName },
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    asOf: row.asOf?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failure: (row.failure as DataExportFailure | null) ?? null,
    fileName: row.fileName,
    byteSize: row.byteSize,
    rowCounts: (row.rowCounts as Record<string, number> | null) ?? null,
  };
}
