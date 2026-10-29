import { describe, expect, it } from 'vitest';
import { parseByteRange } from './byte-range.js';

describe('parseByteRange', () => {
  it('serves the whole file without a header', () => {
    expect(parseByteRange(undefined, 10)).toEqual({ kind: 'full' });
  });

  it('reads a closed, an open and a suffix range, clipped to the file', () => {
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ kind: 'partial', start: 2, end: 5 });
    expect(parseByteRange('bytes=4-', 10)).toEqual({ kind: 'partial', start: 4, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ kind: 'partial', start: 7, end: 9 });
    expect(parseByteRange('bytes=-30', 10)).toEqual({ kind: 'partial', start: 0, end: 9 });
    expect(parseByteRange('bytes=8-100', 10)).toEqual({ kind: 'partial', start: 8, end: 9 });
  });

  it('refuses what it cannot serve', () => {
    for (const header of [
      'bytes=10-',
      'bytes=5-2',
      'bytes=-0',
      'bytes=-',
      'bytes=0-1,4-5',
      'items=0-1',
      'bytes=a-b',
      '',
    ]) {
      expect(parseByteRange(header, 10), header).toEqual({ kind: 'unsatisfiable' });
    }
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
