/** What a download answers for its `Range` header (spec S06 rule 17, RFC 9110 §14). */
export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * One byte range of a file of `size` bytes: `bytes=a-b`, `bytes=a-` or the last `n` bytes,
 * `bytes=-n`, with `end` included and clipped to the file. No header is the whole file. A range
 * that cannot be served (malformed, several ranges, past the end, an empty file) is
 * `unsatisfiable`: a resumed download asks for one range at a time.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: 'full' };
  const match = SINGLE_RANGE.exec(header.trim());
  const [, first = '', last = ''] = match ?? [];
  if (!match || (first === '' && last === '') || size === 0) return { kind: 'unsatisfiable' };
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}
