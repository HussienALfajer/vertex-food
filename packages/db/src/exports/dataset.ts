import type { ExportColumn, ExportRow } from '@vertex-food/contracts';
import type { Transaction } from '../client.js';

/**
 * One CSV file of the restaurant's data export (spec S06 "Dataset definitions"): its stem, its
 * columns, the tables it exports and how it reads them inside the job's transaction, which runs
 * `REPEATABLE READ, READ ONLY` in `withTenant` of the export's tenant, so every dataset agrees with
 * the others at `as_of`.
 */
export type ExportDataset = {
  /** The file is `<stem>.csv`; each tenant table it exports declares `{ dataset: stem }`. */
  stem: string;
  /** The tenant tables whose rows it exports (`tableRegistry`). */
  tables: readonly string[];
  /**
   * Other tables it reads for a column: platform data a tenant route shows the owner (members'
   * names and phones, the agreement's terms, the slug), or an excluded table it takes one value
   * from (a PC's last sync).
   */
  reads: readonly string[];
  columns: readonly ExportColumn[];
  /** The rows in a stable order, page by page, so a large table is never held whole. */
  rows(tx: Transaction, scope: ExportScope): AsyncIterable<ExportRow>;
  /** Binary files the dataset adds to the ZIP beside its CSV (the logo and cover). */
  files?(tx: Transaction, scope: ExportScope): AsyncIterable<ExportFile>;
};

/**
 * The export's tenant, the one `withTenant` set: tenant tables are bounded by RLS, and the platform
 * rows a dataset joins are found through it.
 */
export type ExportScope = { tenantId: string };

export type ExportFile = { path: string; bytes: Buffer };

/** Rows read per page. */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * Reads a table page by page in id order: `page(after)` returns the rows after the id `after`
 * (null for the first page), at most `EXPORT_PAGE_SIZE`, each with its `id`.
 */
export async function* byPages<Row extends { id: string }>(
  page: (after: string | null) => Promise<Row[]>,
): AsyncIterable<Row> {
  let after: string | null = null;
  for (;;) {
    const rows = await page(after);
    yield* rows;
    const last = rows.at(-1);
    if (rows.length < EXPORT_PAGE_SIZE || !last) return;
    after = last.id;
  }
}

/** A `time` column (`04:00:00`) as the wall-clock `HH:MM` the app shows. */
export function wallTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}
