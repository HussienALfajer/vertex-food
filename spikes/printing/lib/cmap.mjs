// The characters a WOFF2 font file maps (its cmap table), to check that every character a receipt prints is in
// the bundled fonts. Skia silently falls back to Windows fonts for a missing glyph, so rendering alone proves nothing.
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];

function base128(buf, at) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[at.i++];
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error('bad UIntBase128');
}

export function woff2Chars(path) {
  const f = readFileSync(path);
  if (f.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not WOFF2');
  const numTables = f.readUInt16BE(12);
  const compressed = f.readUInt32BE(20);
  const at = { i: 48 };
  const tables = [];
  for (let t = 0; t < numTables; t++) {
    const flags = f[at.i++];
    const idx = flags & 0x3f;
    let tag = KNOWN[idx];
    if (idx === 63) {
      tag = f.toString('latin1', at.i, at.i + 4);
      at.i += 4;
    }
    const version = flags >> 6;
    const orig = base128(f, at);
    // glyf and loca are transformed unless version 3; any other table is transformed unless version 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? base128(f, at) : orig;
    tables.push({ tag, length });
  }
  const data = brotliDecompressSync(f.subarray(at.i, at.i + compressed));
  let off = 0;
  let cmap;
  for (const t of tables) {
    if (t.tag === 'cmap') cmap = data.subarray(off, off + t.length);
    off += t.length;
  }
  const chars = new Set();
  const n = cmap.readUInt16BE(2);
  for (let s = 0; s < n; s++) {
    const sub = cmap.subarray(cmap.readUInt32BE(4 + s * 8 + 4));
    const format = sub.readUInt16BE(0);
    if (format === 4) {
      const segs = sub.readUInt16BE(6) / 2;
      for (let k = 0; k < segs; k++) {
        const end = sub.readUInt16BE(14 + k * 2);
        const start = sub.readUInt16BE(16 + segs * 2 + k * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) chars.add(c);
      }
    } else if (format === 12) {
      const groups = sub.readUInt32BE(12);
      for (let k = 0; k < groups; k++) {
        const start = sub.readUInt32BE(16 + k * 12);
        const end = sub.readUInt32BE(20 + k * 12);
        for (let c = start; c <= end; c++) chars.add(c);
      }
    }
  }
  return chars;
}
