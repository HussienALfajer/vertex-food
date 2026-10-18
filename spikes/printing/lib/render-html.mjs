// The same document as an HTML page, for the comparison with Chromium rendering in an Electron window.
import { pathToFileURL } from 'node:url';
import { PAPER } from './documents.mjs';
import { fontFiles } from './fonts.mjs';

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function toHtml(doc, paper, { logoPng } = {}) {
  const W = PAPER[paper].dots;
  const faces = fontFiles
    .map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url("${pathToFileURL(f.path)}") format("woff2")}`)
    .join('');
  const style = (b) => `font-size:${b.size}px;line-height:${Math.round(b.size * 1.5)}px;font-weight:${b.bold ? 700 : 400}`;
  const body = doc.blocks
    .map((b) => {
      if (b.t === 'logo') return logoPng ? `<div class="c" style="margin-bottom:10px"><img src="data:image/png;base64,${logoPng.toString('base64')}"></div>` : '';
      if (b.t === 'text') return `<div class="${b.align === 'center' ? 'c' : ''}" style="${style(b)}">${esc(b.text)}</div>`;
      if (b.t === 'row') return `<div class="row" style="${style(b)}"><span>${esc(b.start)}</span><span class="end">${esc(b.end)}</span></div>`;
      if (b.t === 'banner') return `<div class="banner c" style="${style({ ...b, bold: true })}">${esc(b.text)}</div>`;
      if (b.t === 'rule') return `<div class="rule ${b.dashed ? 'dashed' : ''}"></div>`;
      if (b.t === 'feed') return `<div style="height:${b.dots}px"></div>`;
      return '';
    })
    .join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${faces}
html,body{margin:0;background:#fff;color:#000;overflow:hidden}
body{width:${W}px;padding:0 6px 4px;box-sizing:border-box;font-family:"VF Arabic","VF Latin","VF Latin Ext";-webkit-font-smoothing:none}
.c{text-align:center}.row{display:flex;gap:14px;justify-content:space-between;align-items:flex-start}
.end{white-space:nowrap}.banner{background:#000;color:#fff;margin:0 -6px 6px;padding:3px 0}
.rule{border-top:2px solid #000;margin:6px 0}.rule.dashed{border-top-style:dashed}
img{image-rendering:pixelated;display:inline-block}
</style></head><body>${body}</body></html>`;
}
