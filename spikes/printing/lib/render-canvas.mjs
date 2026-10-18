// Renders a document to a 1-bit page with Skia (@napi-rs/canvas): HarfBuzz shaping and the bidi algorithm
// come from Skia, so Arabic joins and mixed Arabic/Latin/digits order correctly. Runs in Node and in Electron's
// main process (N-API addon), without a window.
import { ImageData, createCanvas } from '@napi-rs/canvas';
import { PAPER } from './documents.mjs';
import { FAMILY, registerCanvasFonts } from './fonts.mjs';
import { fromRgba, toRgba } from './mono.mjs';

const PAD = 6;
const GAP = 14;
const lineHeight = (size) => Math.round(size * 1.5);
const font = (size, bold) => `${bold ? 'bold ' : ''}${size}px ${FAMILY}`;

function wrap(g, text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderCanvas(doc, paper, { logo } = {}) {
  await registerCanvasFonts();
  const W = PAPER[paper].dots;
  const inner = W - 2 * PAD;
  const scratch = createCanvas(W, 10).getContext('2d');
  scratch.direction = 'rtl';
  const ops = [];
  let y = 0;
  for (const b of doc.blocks) {
    if (b.t === 'logo') {
      if (!logo) continue;
      ops.push({ ...b, y, x: Math.round((W - logo.width) / 2) });
      y += logo.height + 10;
    } else if (b.t === 'text') {
      scratch.font = font(b.size, b.bold);
      for (const l of wrap(scratch, b.text, inner)) {
        ops.push({ t: 'text', text: l, size: b.size, bold: b.bold, align: b.align, y });
        y += lineHeight(b.size);
      }
    } else if (b.t === 'row') {
      scratch.font = font(b.size, b.bold);
      const endW = scratch.measureText(b.end).width;
      const lines = wrap(scratch, b.start, inner - endW - GAP);
      ops.push({ t: 'end', text: b.end, size: b.size, bold: b.bold, y });
      for (const l of lines) {
        ops.push({ t: 'text', text: l, size: b.size, bold: b.bold, align: 'start', y });
        y += lineHeight(b.size);
      }
    } else if (b.t === 'banner') {
      const h = lineHeight(b.size) + 6;
      ops.push({ ...b, y, h });
      y += h + 6;
    } else if (b.t === 'rule') {
      ops.push({ ...b, y: y + 6 });
      y += 14;
    } else if (b.t === 'feed') y += b.dots;
  }
  const H = y + 4;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.direction = 'rtl';
  g.textBaseline = 'alphabetic';
  for (const o of ops) {
    g.fillStyle = '#000';
    if (o.t === 'logo') {
      g.putImageData(new ImageData(toRgba(logo), logo.width, logo.height), o.x, o.y);
    } else if (o.t === 'text' || o.t === 'end') {
      g.font = font(o.size, o.bold);
      const base = o.y + Math.round(o.size * 1.12);
      if (o.t === 'end') {
        g.textAlign = 'left';
        g.fillText(o.text, PAD, base);
      } else if (o.align === 'center') {
        g.textAlign = 'center';
        g.fillText(o.text, W / 2, base);
      } else {
        g.textAlign = 'right';
        g.fillText(o.text, W - PAD, base);
      }
    } else if (o.t === 'banner') {
      g.fillRect(0, o.y, W, o.h);
      g.fillStyle = '#fff';
      g.font = font(o.size, true);
      g.textAlign = 'center';
      g.fillText(o.text, W / 2, o.y + 3 + Math.round(o.size * 1.12));
    } else if (o.t === 'rule') {
      if (o.dashed) for (let x = PAD; x < W - PAD; x += 12) g.fillRect(x, o.y, 6, 2);
      else g.fillRect(PAD, o.y, inner, 2);
    }
  }
  return fromRgba(g.getImageData(0, 0, W, H).data, W, H);
}
