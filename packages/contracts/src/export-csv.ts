import { z } from 'zod';
import { type CurrencyCode, currencies } from './money.js';
import { businessIsoInstant } from './time.js';

/**
 * The CSV files of a data export, format version 1 (spec S06 "CSV and ZIP format"): UTF-8 with a
 * byte-order mark so Excel reads Arabic, CRLF line ends, comma separators, RFC 4180 quoting and a
 * header row of stable English column names. Each column has a kind that fixes how its values are
 * written, so every dataset of every later spec writes money, instants and lists the same way.
 */
export const EXPORT_FORMAT_VERSION = 1;

export const CSV_BOM = '﻿';

export const CSV_EOL = '\r\n';

export const exportColumnKinds = [
  'text',
  'integer',
  'money',
  'instant',
  'date',
  'boolean',
  'list',
] as const;

export const exportColumnKindSchema = z.enum(exportColumnKinds).meta({ id: 'ExportColumnKind' });

export type ExportColumnKind = z.infer<typeof exportColumnKindSchema>;

/** A column of a dataset: its stable name and its kind. */
export type ExportColumn = { name: string; kind: ExportColumnKind };

/** A money cell's value: minor units with the currency (ADR 0014). */
export type ExportMoney = { amount: number | bigint; currency: CurrencyCode };

/**
 * A row's values by column name. `null` and `undefined` write an empty cell (both cells of a money
 * column).
 */
export type ExportRow = Record<string, unknown>;

/** Column names: lower snake case, so the header reads the same in every release. */
export const exportColumnNamePattern = /^[a-z][a-z0-9_]*$/;

/** A text cell starting with one of these is read as a formula by spreadsheets. */
const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];

/** The header cells of a column: a money column is `<name>_amount` and `<name>_currency`. */
export function exportHeaderCells(column: ExportColumn): string[] {
  return column.kind === 'money'
    ? [`${column.name}_amount`, `${column.name}_currency`]
    : [column.name];
}

/** RFC 4180: a cell holding a comma, a quote or a line break is quoted, its quotes doubled. */
function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Text typed by a person never runs as a formula in Excel: it is prefixed with `'`. */
function neutralize(text: string): string {
  return formulaTriggers.some((trigger) => text.startsWith(trigger)) ? `'${text}` : text;
}

/**
 * Minor units as major units in plain digits with the currency's exponent (`1250` USD → `12.50`):
 * no grouping, no float, a leading `-` for a negative amount.
 */
export function exportMajorUnits(amount: number | bigint, currency: CurrencyCode): string {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new RangeError('Money amounts are safe integers in minor units');
  }
  const { exponent } = currencies[currency];
  const units = BigInt(amount);
  const digits = (units < 0n ? -units : units).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${units < 0n ? '-' : ''}${whole}${fraction}`;
}

function isEmpty(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/** The cells of one value of a column, before quoting. */
export function exportCells(column: ExportColumn, value: unknown): string[] {
  if (column.kind === 'money') {
    if (isEmpty(value)) return ['', ''];
    const { amount, currency } = value as ExportMoney;
    return [exportMajorUnits(amount, currency), currency];
  }
  if (isEmpty(value)) return [''];
  switch (column.kind) {
    case 'text':
      return [neutralize(String(value))];
    case 'integer': {
      if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) {
        throw new RangeError(`Column ${column.name} holds a non-integer`);
      }
      return [String(value)];
    }
    case 'instant':
      return [businessIsoInstant(value as Date | string)];
    case 'date': {
      const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Column ${column.name}: date`);
      return [date];
    }
    case 'boolean':
      return [value ? 'true' : 'false'];
    case 'list':
      return [neutralize((value as readonly unknown[]).map(String).join(';'))];
  }
}

/** The header line of a dataset, with its line end. */
export function exportHeaderLine(columns: readonly ExportColumn[]): string {
  return columns.flatMap(exportHeaderCells).map(quote).join(',') + CSV_EOL;
}

/** One row of a dataset, with its line end. */
export function exportRowLine(columns: readonly ExportColumn[], row: ExportRow): string {
  return (
    columns
      .flatMap((column) => exportCells(column, row[column.name]))
      .map(quote)
      .join(',') + CSV_EOL
  );
}

/** A whole CSV file in memory, for small files (`columns.csv`) and tests. */
export function exportCsv(columns: readonly ExportColumn[], rows: readonly ExportRow[]): string {
  return (
    CSV_BOM + exportHeaderLine(columns) + rows.map((row) => exportRowLine(columns, row)).join('')
  );
}

/** `manifest.json` of an export: what it holds, as of when, and each file's hash. */
export const exportManifestSchema = z
  .object({
    formatVersion: z.literal(EXPORT_FORMAT_VERSION),
    tenantId: z.uuid(),
    slug: z.string().min(1),
    /** The snapshot's instant (UTC). */
    asOf: z.iso.datetime(),
    generatedAt: z.iso.datetime(),
    files: z.array(
      z.object({
        path: z.string().min(1),
        /** Data rows of a CSV file; null for the other files. */
        rows: z.int().min(0).nullable(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    ),
  })
  .meta({ id: 'ExportManifest' });

export type ExportManifest = z.infer<typeof exportManifestSchema>;
