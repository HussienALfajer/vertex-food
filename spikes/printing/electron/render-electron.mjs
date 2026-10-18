// Chromium rendering for comparison: the HTML page in a hidden offscreen window, captured and thresholded.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { PAPER } from '../lib/documents.mjs';
import { fromRgba } from '../lib/mono.mjs';
import { toHtml } from '../lib/render-html.mjs';

let win;
export async function openRenderer() {
  const t0 = performance.now();
  win = new BrowserWindow({ show: false, width: 600, height: 400, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(60);
  await win.loadURL('about:blank');
  return performance.now() - t0;
}

export function closeRenderer() {
  win?.destroy();
}

export async function renderElectron(doc, paper, { logoPng, tmpDir }) {
  const W = PAPER[paper].dots;
  const file = join(tmpDir, `render-${paper}.html`);
  writeFileSync(file, toHtml(doc, paper, { logoPng }));
  await win.loadFile(file);
  const h = await win.webContents.executeJavaScript('document.fonts.ready.then(() => Math.ceil(document.body.getBoundingClientRect().height))');
  // Offscreen windows hand out frames through 'paint' (capturePage fails on them in Electron 44).
  const wc = win.webContents;
  const nextPaint = (ok) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wc.off('paint', onPaint);
        reject(new Error('no frame'));
      }, 5000);
      const onPaint = (_e, _dirty, image) => {
        if (!ok(image.getSize())) return;
        clearTimeout(timer);
        wc.off('paint', onPaint);
        resolve(image);
      };
      wc.on('paint', onPaint);
      wc.invalidate();
    });
  win.setContentSize(W, h);
  let img = await nextPaint((s) => s.height > 0 && Math.abs(s.width / s.height - W / h) < 0.02);
  // An offscreen window may render at the display's scale; zoom so one CSS pixel is one printer dot.
  const f = img.getSize().width / W;
  if (f !== 1) {
    wc.setZoomFactor(1 / f);
    win.setContentSize(Math.round(W / f), Math.round(h / f));
    img = await nextPaint((s) => s.width === W && s.height === h);
  }
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  for (let i = 0; i < bgra.length; i += 4) [bgra[i], bgra[i + 2]] = [bgra[i + 2], bgra[i]];
  return { mono: fromRgba(bgra, width, height), scale: f };
}
