import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  type ExportColumn,
  exportCells,
  exportCsv,
  exportHeaderLine,
  exportMajorUnits,
  exportManifestSchema,
  exportRowLine,
} from './export-csv.js';

const columns: ExportColumn[] = [
  { name: 'name', kind: 'text' },
  { name: 'count', kind: 'integer' },
  { name: 'price', kind: 'money' },
  { name: 'at', kind: 'instant' },
  { name: 'day', kind: 'date' },
  { name: 'active', kind: 'boolean' },
  { name: 'roles', kind: 'list' },
];

describe('export CSV, format version 1', () => {
  it('starts with a byte-order mark and ends every line with CRLF', () => {
    const file = exportCsv(columns, [{ name: 'فرع الجامعة', count: 2 }]);
    expect(file.startsWith(CSV_BOM)).toBe(true);
    expect(file.slice(1).split('\r\n')).toEqual([
      'name,count,price_amount,price_currency,at,day,active,roles',
      'فرع الجامعة,2,,,,,,',
      '',
    ]);
  });

  it('writes the header of an empty dataset', () => {
    expect(exportCsv(columns, [])).toBe(`${CSV_BOM}${exportHeaderLine(columns)}`);
  });

  it('quotes commas, quotes and line breaks (RFC 4180), Arabic and Latin mixed intact', () => {
    const text: ExportColumn[] = [{ name: 'note', kind: 'text' }];
    expect(exportRowLine(text, { note: 'a,b' })).toBe('"a,b"\r\n');
    expect(exportRowLine(text, { note: 'قال "نعم"' })).toBe('"قال ""نعم"""\r\n');
    expect(exportRowLine(text, { note: 'سطر\nline 2' })).toBe('"سطر\nline 2"\r\n');
    expect(exportRowLine(text, { note: 'Azaz عزاز' })).toBe('Azaz عزاز\r\n');
  });

  it('prefixes each formula trigger in text and list cells only', () => {
    for (const trigger of ['=', '+', '-', '@', '\t', '\r']) {
      const value = `${trigger}SUM(A1)`;
      expect(exportCells({ name: 't', kind: 'text' }, value), JSON.stringify(trigger)).toEqual([
        `'${value}`,
      ]);
      expect(exportCells({ name: 'l', kind: 'list' }, [value, 'b'])).toEqual([`'${value};b`]);
    }
    expect(exportRowLine([{ name: 't', kind: 'text' }], { t: '\rx' })).toBe(`"'\rx"\r\n`);
    expect(exportCells({ name: 't', kind: 'text' }, 'a=b')).toEqual(['a=b']);
    // Numbers, money and instants are never prefixed, negatives included.
    expect(exportCells({ name: 'n', kind: 'integer' }, -5)).toEqual(['-5']);
    expect(exportCells({ name: 'm', kind: 'money' }, { amount: -1250, currency: 'USD' })).toEqual([
      '-12.50',
      'USD',
    ]);
  });

  it('writes money as major-unit digits with the exponent and the currency apart', () => {
    expect(exportMajorUnits(1250, 'USD')).toBe('12.50');
    expect(exportMajorUnits(5, 'TRY')).toBe('0.05');
    expect(exportMajorUnits(125050, 'SYP')).toBe('1250.50');
    expect(exportMajorUnits(0, 'SYP')).toBe('0.00');
    expect(exportMajorUnits(-7, 'USD')).toBe('-0.07');
    expect(exportMajorUnits(900719925474099100n, 'SYP')).toBe('9007199254740991.00');
    expect(() => exportMajorUnits(1.5, 'USD')).toThrow(RangeError);
    expect(exportCells({ name: 'm', kind: 'money' }, null)).toEqual(['', '']);
  });

  it('writes instants in Damascus time with the offset, dates, booleans and lists', () => {
    expect(exportCells({ name: 'a', kind: 'instant' }, new Date('2026-10-29T11:05:00Z'))).toEqual([
      '2026-10-29T14:05:00+03:00',
    ]);
    expect(exportCells({ name: 'a', kind: 'instant' }, '2026-10-29T21:30:00.000Z')).toEqual([
      '2026-10-30T00:30:00+03:00',
    ]);
    expect(exportCells({ name: 'd', kind: 'date' }, '2026-10-29')).toEqual(['2026-10-29']);
    expect(() => exportCells({ name: 'd', kind: 'date' }, '29/10/2026')).toThrow(RangeError);
    expect(exportCells({ name: 'b', kind: 'boolean' }, false)).toEqual(['false']);
    expect(exportCells({ name: 'b', kind: 'boolean' }, true)).toEqual(['true']);
    expect(exportCells({ name: 'l', kind: 'list' }, ['owner', 'manager'])).toEqual([
      'owner;manager',
    ]);
    expect(exportCells({ name: 'l', kind: 'list' }, [])).toEqual(['']);
    expect(() => exportCells({ name: 'n', kind: 'integer' }, 1.5)).toThrow(RangeError);
  });
});

describe('exportManifestSchema', () => {
  it('holds the version, the snapshot and each file with its rows and hash', () => {
    const manifest = {
      formatVersion: 1,
      tenantId: '0192f0a4-5c2e-7a3b-8c4d-5e6f7a8b9c0d',
      slug: 'test-kitchen',
      asOf: '2026-10-29T11:05:00.000Z',
      generatedAt: '2026-10-29T11:06:00.000Z',
      files: [
        { path: 'staff.csv', rows: 2, sha256: 'a'.repeat(64) },
        { path: 'README.txt', rows: null, sha256: 'b'.repeat(64) },
      ],
    };
    expect(exportManifestSchema.parse(manifest)).toEqual(manifest);
    expect(exportManifestSchema.safeParse({ ...manifest, formatVersion: 2 }).success).toBe(false);
  });
});
