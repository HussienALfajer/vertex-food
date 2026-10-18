# Spike B — printing (throwaway)

Proves ADR 0008's local printing: Arabic receipts and kitchen tickets on 58 and 80 mm ESC/POS printers from Electron's main process, with a logo, Arabic shaping, right-to-left lines, a cash drawer kick, network (raw TCP) and USB (Windows spooler, RAW) transports, and a print queue that survives printer faults and power cuts. Compares rendering to an image with the printer's Arabic code page. Findings: [`docs/spikes/B-printing.md`](../../docs/spikes/B-printing.md). Not product code; do not import from here.

No printer is needed: a printer emulator (`emulator/printer.mjs`) listens on raw TCP, parses the ESC/POS commands, rebuilds the paper as an image, answers status, models the head speed, and fakes paper out, cover open, power off, a cut connection and a silent link.

## Run (Windows, Node 24, pnpm)

```bash
pnpm install
pnpm scenarios
```

```bash
pnpm scenarios:electron
```

```bash
pnpm compare
```

The Electron run executes every check in Electron's main process and adds the Chromium rendering comparison (an offscreen window). If pnpm skipped Electron's build script, run `node node_modules/electron/install.js`. Reports and printed pages (PNG) go to `out/<runtime>/`, side-by-side previews to `out/compare-*.png` (git-ignored).

To try a real USB printer installed as a Windows print queue (its maker's driver, or "Generic / Text Only" on its USB port), add `--spooler "<printer name>"` to `pnpm scenarios`: it sends one RAW job with a line of text and a cut.

## Layout

| Path | What |
|---|---|
| `lib/fixtures.mjs` | Synthetic receipt and kitchen ticket (integer minor units, SYP and USD) |
| `lib/documents.mjs` | The receipt and the ticket as a renderer-independent list of blocks; paper widths (384 and 576 dots) |
| `lib/fonts.mjs` | Bundled Noto Sans Arabic (Arabic, Latin and Latin Extended subsets) |
| `lib/render-canvas.mjs` | Image path: Skia (`@napi-rs/canvas`) with HarfBuzz shaping and bidi, wrapped lines, logo, banner; thresholded to 1 bit |
| `lib/logo.mjs`, `lib/mono.mjs` | A synthetic colour logo, its one-time dithering to 1 bit; 1-bit bitmaps |
| `lib/codepage.mjs` | Code-page path: a JavaScript Arabic shaper, a small bidi reordering, IBM 864 encoding with substitutions |
| `lib/escpos.mjs` | ESC/POS commands: raster in bands, cut, drawer kick, status |
| `lib/network.mjs` | Raw TCP transport: status first, the job, then `GS r` as the "printed" answer; typed errors and timeouts |
| `lib/spooler.mjs` | USB transport: a RAW job through `winspool.drv` with `koffi` |
| `lib/queue.mjs` | Durable per-printer FIFO, at-least-once, reprints marked "نسخة معادة", no second drawer kick |
| `lib/render-html.mjs`, `electron/render-electron.mjs` | Chromium comparison: the same document as HTML in an offscreen window |
| `emulator/printer.mjs` | The ESC/POS printer emulator |
| `scenarios/run.mjs` | All checks (37 in Node, 41 in Electron) and timings; `scenarios/queue-child.mjs` the queue process killed in the power-cut check; `scenarios/compare.mjs` the previews |
| `electron/main.mjs` | Runs the checks or the queue process in Electron's main process |
