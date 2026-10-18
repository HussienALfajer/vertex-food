// Side-by-side previews: the image page (identical to what the emulator printed) next to the code-page paper.
// Run after `pnpm scenarios`; writes out/compare-<kind>-<paper>.png.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FAMILY, registerCanvasFonts } from '../lib/fonts.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
await registerCanvasFonts();
for (const [kind, paper] of [['receipt', 80], ['receipt', 58], ['kitchen', 80], ['kitchen', 58]]) {
  const a = await loadImage(readFileSync(path.join(out, 'node', `image-${kind}-${paper}.png`)));
  const b = await loadImage(readFileSync(path.join(out, 'node', `codepage-${kind}-${paper}.png`)));
  const gap = 40;
  const head = 44;
  const c = createCanvas(a.width + b.width + gap * 3, Math.max(a.height, b.height) + head + gap);
  const g = c.getContext('2d');
  g.fillStyle = '#bbb';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  g.font = `bold 22px ${FAMILY}`;
  g.fillText(`Image (raster), ${paper} mm`, gap, 30);
  g.fillText(`Code page IBM 864 (simulated), ${paper} mm`, a.width + gap * 2, 30);
  g.drawImage(a, gap, head);
  g.drawImage(b, a.width + gap * 2, head);
  writeFileSync(path.join(out, `compare-${kind}-${paper}.png`), await c.encode('png'));
}
console.log('written out/compare-*.png');
