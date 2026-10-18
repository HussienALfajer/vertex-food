// The alternative to images: shape Arabic into presentation forms in JavaScript, reorder each line for a
// printer that only prints left to right, and encode it in the printer's Arabic code page (IBM 864 here).
import iconv from 'iconv-lite';
import { PAPER } from './documents.mjs';
import * as P from './escpos.mjs';

// Contextual forms: [isolated, final, initial, medial]; right-joining letters have only the first two.
const FORMS = {
  0x0621: [0xfe80],
  0x0622: [0xfe81, 0xfe82], 0x0623: [0xfe83, 0xfe84], 0x0624: [0xfe85, 0xfe86], 0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], 0x0627: [0xfe8d, 0xfe8e], 0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94], 0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], 0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], 0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], 0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa], 0x0630: [0xfeab, 0xfeac], 0x0631: [0xfead, 0xfeae], 0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], 0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], 0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], 0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], 0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], 0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], 0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], 0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], 0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], 0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], 0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee], 0x0649: [0xfeef, 0xfef0], 0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};
const LAM_ALEF = { 0x0622: [0xfef5, 0xfef6], 0x0623: [0xfef7, 0xfef8], 0x0625: [0xfef9, 0xfefa], 0x0627: [0xfefb, 0xfefc] };
const TATWEEL = 0x0640;
const isTransparent = (c) => (c >= 0x064b && c <= 0x065f) || c === 0x0670;
const joinsNext = (c) => c === TATWEEL || FORMS[c]?.length === 4;
const joinsPrev = (c) => c === TATWEEL || (FORMS[c] && FORMS[c].length >= 2);

export function shape(text) {
  const cps = [...text].map((c) => c.codePointAt(0)).filter((c) => !isTransparent(c)); // harakat dropped
  const out = [];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    const prev = cps[i - 1];
    const connPrev = prev !== undefined && joinsNext(prev) && joinsPrev(c);
    if (c === 0x0644 && LAM_ALEF[cps[i + 1]]) {
      out.push(LAM_ALEF[cps[i + 1]][connPrev ? 1 : 0]);
      i++;
      continue;
    }
    const f = FORMS[c];
    if (!f) {
      out.push(c);
      continue;
    }
    const connNext = joinsNext(c) && cps[i + 1] !== undefined && joinsPrev(cps[i + 1]);
    const form = connPrev && connNext ? 3 : connPrev ? 1 : connNext ? 2 : 0;
    out.push(f[form] ?? f[connPrev ? 1 : 0] ?? f[0]);
  }
  return String.fromCodePoint(...out);
}

// A small bidi reordering for one line with a right-to-left base direction (enough for receipts: Arabic,
// Latin words, numbers with separators). The product would use a full UBA implementation if it kept this path.
const isArabic = (c) => (c >= 0x0600 && c <= 0x06ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);
const isLtr = (ch) => /[\p{L}\p{Nd}]/u.test(ch) && !isArabic(ch.codePointAt(0));
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '«': '»', '»': '«' };

export function visual(line) {
  const chars = [...line];
  const dir = chars.map((ch) => (isArabic(ch.codePointAt(0)) ? 'R' : isLtr(ch) ? 'L' : 'N'));
  // Separators inside numbers and words ("25,000", "14:32", "2026-10-18", "330ml") stay left to right.
  for (let i = 0; i < chars.length; i++) {
    if (dir[i] !== 'N') continue;
    let j = i;
    while (j < chars.length && dir[j] === 'N') j++;
    const before = dir[i - 1];
    const after = dir[j];
    const tight = j - i === 1 && /[,.:/\-%$]/.test(chars[i]);
    const r = before === 'L' && after === 'L' ? 'L' : (tight && (before === 'L' || after === 'L')) ? 'L' : 'R';
    for (let k = i; k < j; k++) dir[k] = r;
    i = j - 1;
  }
  const runs = [];
  for (let i = 0; i < chars.length; i++) {
    if (runs.length && runs.at(-1).d === dir[i]) runs.at(-1).s.push(chars[i]);
    else runs.push({ d: dir[i], s: [chars[i]] });
  }
  return runs
    .reverse()
    .map((r) => (r.d === 'L' ? r.s.join('') : r.s.reverse().map((ch) => MIRROR[ch] ?? ch).join('')))
    .join('');
}

// IBM 864 lacks many final and medial forms; printers that use it substitute the nearest form.
const cp864 = new Map();
{
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  [...iconv.decode(bytes, 'cp864')].forEach((ch, i) => {
    if (ch !== '�' && !cp864.has(ch)) cp864.set(ch, i);
  });
}
const FALLBACK = new Map();
for (const f of Object.values(FORMS)) {
  if (f.length === 4) {
    FALLBACK.set(f[3], [f[2], f[1], f[0]]); // medial → initial, final, isolated
    FALLBACK.set(f[1], [f[0]]); // final → isolated
    FALLBACK.set(f[2], [f[0]]);
  } else if (f.length === 2) FALLBACK.set(f[1], [f[0]]);
}
// Letters IBM 864 lacks entirely: alef with hamza below and its lam-alef ligature print as a bare alef.
FALLBACK.set(0xfe87, [0xfe8d]);
FALLBACK.set(0xfe88, [0xfe8e]);
FALLBACK.set(0xfef9, [0xfefb]);
FALLBACK.set(0xfefa, [0xfefc]);
const SUBST = { '—': '-', '–': '-', '•': '*', '%': '٪' };

export function encode864(text, stats) {
  const out = [];
  for (const ch of text) {
    let b = cp864.get(ch);
    if (b === undefined) {
      const alt = (FALLBACK.get(ch.codePointAt(0)) ?? []).map((c) => String.fromCodePoint(c)).find((c) => cp864.has(c));
      if (alt) {
        b = cp864.get(alt);
        stats.substituted++;
      } else if (SUBST[ch]) {
        b = cp864.get(SUBST[ch]);
        stats.substituted++;
      } else {
        b = 0x3f;
        stats.missing.add(ch);
      }
    }
    out.push(b);
    stats.chars++;
  }
  return Buffer.from(out);
}

function wrapCols(text, cols) {
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (line && [...shape(next)].length > cols) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// The code-page job for the same document. The logo is still an image: there is no other way to print one.
// `table` is the ESC t number of PC864 on the target printer; it differs between makers (Q8).
export function codePageJob(doc, paper, { logo, table, kick = false } = {}) {
  const stats = { chars: 0, substituted: 0, missing: new Set() };
  const cols = PAPER[paper].cols;
  const parts = [P.init(), P.codePage(table)];
  if (kick) parts.push(P.drawerKick());
  const big = (s) => s >= PAPER[paper].big;
  const line = (logical, c) => encode864(visual(shape(logical)), stats).subarray(0, c);
  for (const b of doc.blocks) {
    if (b.t === 'logo' && logo) parts.push(P.align(1), P.raster(logo));
    else if (b.t === 'text' || b.t === 'banner') {
      const dbl = big(b.size);
      const c = dbl ? cols / 2 : cols;
      parts.push(P.align(b.align === 'center' || b.t === 'banner' ? 1 : 2), P.bold(b.bold || b.t === 'banner'), P.size(dbl ? 2 : 1, dbl ? 2 : 1));
      if (b.t === 'banner') parts.push(Buffer.from([P.GS, 0x42, 1]));
      for (const l of wrapCols(b.text, c)) parts.push(line(l, c), Buffer.from([0x0a]));
      if (b.t === 'banner') parts.push(Buffer.from([P.GS, 0x42, 0]));
    } else if (b.t === 'row') {
      const dbl = big(b.size);
      const c = dbl ? cols / 2 : cols;
      parts.push(P.align(0), P.bold(b.bold), P.size(dbl ? 2 : 1, dbl ? 2 : 1));
      const end = encode864(visual(shape(b.end)), stats);
      const room = c - end.length - 1;
      const starts = wrapCols(b.start, room);
      if (starts.some((s) => [...shape(s)].length > room)) {
        // A word wider than the space left: the label gets its own line, the amount the next one.
        for (const s of wrapCols(b.start, c)) parts.push(P.align(2), line(s, c), Buffer.from([0x0a]));
        parts.push(P.align(0), end, Buffer.from([0x0a]));
        continue;
      }
      starts.forEach((s, i) => {
        const st = line(s, c - end.length - 1);
        const left = i === 0 ? end : Buffer.alloc(end.length, 0x20);
        parts.push(left, Buffer.alloc(c - left.length - st.length, 0x20), st, Buffer.from([0x0a]));
      });
    } else if (b.t === 'rule') parts.push(P.size(1, 1), P.align(0), Buffer.from(`${(b.dashed ? '- ' : '--').repeat(cols / 2)}\n`));
    else if (b.t === 'feed') parts.push(Buffer.from([0x0a]));
  }
  parts.push(P.size(1, 1), P.bold(false), P.feed(3), P.cut());
  return { bytes: Buffer.concat(parts), stats: { ...stats, missing: [...stats.missing] } };
}
