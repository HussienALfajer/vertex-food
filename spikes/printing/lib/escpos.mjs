// ESC/POS byte builders. Only commands common to Epson TM and the usual Chinese clones (Xprinter, Rongta,
// HPRT, Sunmi...) are used: ESC @, ESC a, ESC E, GS !, ESC t, GS v 0, GS V, ESC p, DLE EOT, GS r.

export const ESC = 0x1b;
export const GS = 0x1d;
export const DLE = 0x10;

export const init = () => Buffer.from([ESC, 0x40]);
export const align = (n) => Buffer.from([ESC, 0x61, n]); // 0 left, 1 centre, 2 right
export const bold = (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
export const size = (w, h) => Buffer.from([GS, 0x21, ((w - 1) << 4) | (h - 1)]);
export const codePage = (n) => Buffer.from([ESC, 0x74, n]);
export const feed = (lines) => Buffer.from([ESC, 0x64, lines]);
export const cut = () => Buffer.from([GS, 0x56, 66, 0]); // feed to the cutter, then partial cut
// Drawer kick on connector pin 2: on 2 × 25 ms, off 2 × 250 ms (ESC p m t1 t2).
export const drawerKick = (pin = 0, onMs = 50, offMs = 500) =>
  Buffer.from([ESC, 0x70, pin, Math.round(onMs / 2), Math.round(offMs / 2)]);
// Real-time status (answered on receipt, even while the buffer is full): 1 printer, 2 offline cause, 4 paper.
export const statusQuery = (n) => Buffer.from([DLE, 0x04, n]);
// Processed in order with the print data, so its answer arrives after the preceding lines have been handled:
// the spike's "job printed" acknowledgement.
export const transmitStatus = () => Buffer.from([GS, 0x72, 1]);

// GS v 0 in bands: cheap printers have small input buffers and some cap the image height per command.
export function raster(mono, bandRows = 256) {
  const parts = [];
  for (let y0 = 0; y0 < mono.height; y0 += bandRows) {
    const rows = Math.min(bandRows, mono.height - y0);
    const head = Buffer.from([GS, 0x76, 0x30, 0, mono.stride & 0xff, mono.stride >> 8, rows & 0xff, rows >> 8]);
    parts.push(head, Buffer.from(mono.bits.subarray(y0 * mono.stride, (y0 + rows) * mono.stride)));
  }
  return Buffer.concat(parts);
}

// A whole image job: optional drawer kick first (the drawer opens while the receipt prints), the page, cut.
export function imageJob(mono, { kick = false, bandRows } = {}) {
  return Buffer.concat([init(), kick ? drawerKick() : Buffer.alloc(0), align(1), raster(mono, bandRows), feed(3), cut()]);
}

export function parseStatus(n, byte) {
  if (n === 1) return { drawerHigh: !!(byte & 0x04), offline: !!(byte & 0x08) };
  if (n === 2) return { coverOpen: !!(byte & 0x04), feedButton: !!(byte & 0x08), paperStop: !!(byte & 0x20), error: !!(byte & 0x40) };
  if (n === 4) return { paperNearEnd: (byte & 0x0c) === 0x0c, paperEnd: (byte & 0x60) === 0x60 };
  return {};
}
