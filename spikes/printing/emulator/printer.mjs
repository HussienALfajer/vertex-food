// A network ESC/POS printer on raw TCP (port 9100 style) for tests without hardware. It parses the commands the
// spike sends, rebuilds the paper as a 1-bit image, answers real-time status, kicks a virtual drawer and models
// the print head's speed and a small input buffer. Faults: paper out, cover open, switched off, connection cut
// after N bytes, a link that accepts and then stays silent.
import net from 'node:net';
import { ImageData, createCanvas } from '@napi-rs/canvas';
import iconv from 'iconv-lite';
import { FAMILY, registerCanvasFonts } from '../lib/fonts.mjs';
import { fromRgba, toRgba } from '../lib/mono.mjs';

const DOTS_PER_MM = 8; // 203 dpi
const LINE_DOTS = 30; // default line spacing for an empty line or ESC d

export class PrinterEmulator {
  constructor({ name = 'printer', widthDots = 576, mmPerSec = 150, codePages = { 0: 'cp437', 37: 'cp864' }, bufferMs = 400 } = {}) {
    Object.assign(this, { name, widthDots, mmPerSec, codePages, bufferMs });
    this.pages = [];
    this.kicks = [];
    this.fault = null; // 'paperOut' | 'coverOpen' | { dropAfter: n } | 'silent' | 'dropOnConnect'
    this.received = 0;
    this.droppedWhileNotReady = 0;
    this.unknown = [];
    this.connections = 0;
    this.headFreeAt = 0;
    this.active = null;
    this.waiting = [];
  }

  async start(port = 0) {
    await registerCanvasFonts();
    this.server = net.createServer((s) => this.#accept(s));
    await new Promise((r) => this.server.listen(port, '127.0.0.1', r));
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    for (const s of [this.active, ...this.waiting]) s?.destroy();
    if (this.server?.listening) await new Promise((r) => this.server.close(r));
  }

  // Like most cheap network printers: one job connection at a time; later ones wait in the backlog.
  #accept(socket) {
    this.connections++;
    socket.on('error', () => {});
    if (this.active) {
      socket.pause();
      this.waiting.push(socket);
      socket.on('close', () => (this.waiting = this.waiting.filter((s) => s !== socket)));
      return;
    }
    this.#serve(socket);
  }

  #serve(socket) {
    this.active = socket;
    const st = { buf: Buffer.alloc(0), page: [], line: [], align: 0, bold: false, sw: 1, sh: 1, invert: false, table: 0, jobBytes: 0 };
    if (this.fault === 'dropOnConnect') {
      // Accepts, then loses the connection before answering anything (a flaky Wi-Fi link).
      this.fault = null;
      socket.on('close', () => {
        this.active = null;
        const next = this.waiting.shift();
        if (next) this.#serve(next);
      });
      socket.destroy();
      return;
    }
    if (this.fault === 'silent') {
      socket.on('data', () => {}); // reads and drops everything, never answers
    } else {
      socket.on('data', (chunk) => {
        st.jobBytes += chunk.length;
        this.received += chunk.length;
        const drop = this.fault?.dropAfter;
        if (drop !== undefined && st.jobBytes > drop) {
          st.buf = Buffer.concat([st.buf, chunk.subarray(0, chunk.length - (st.jobBytes - drop))]);
          this.#parse(socket, st);
          this.#finishPage(st, { torn: true });
          this.fault = null;
          socket.destroy();
          return;
        }
        st.buf = Buffer.concat([st.buf, chunk]);
        this.#parse(socket, st);
        // Input buffer: when the head is far behind, stop reading so TCP pushes back on the sender.
        const behind = this.headFreeAt - Date.now();
        if (behind > this.bufferMs) {
          socket.pause();
          setTimeout(() => socket.resume(), behind - this.bufferMs / 2);
        }
      });
    }
    socket.resume();
    socket.on('close', () => {
      if (st.page.length || st.line.length) this.#finishPage(st, { torn: true });
      this.active = null;
      const next = this.waiting.shift();
      if (next) this.#serve(next);
    });
  }

  get ready() {
    return this.fault !== 'paperOut' && this.fault !== 'coverOpen';
  }

  #status(n) {
    let b = 0x12;
    if (n === 1 && !this.ready) b |= 0x08;
    if (n === 2 && this.fault === 'coverOpen') b |= 0x04;
    if (n === 2 && this.fault === 'paperOut') b |= 0x20;
    if (n === 4 && this.fault === 'paperOut') b |= 0x60;
    return b;
  }

  #print(st, strip) {
    if (!this.ready) {
      this.droppedWhileNotReady += strip.height;
      return;
    }
    st.page.push(strip);
    const ms = (strip.height / DOTS_PER_MM / this.mmPerSec) * 1000;
    this.headFreeAt = Math.max(Date.now(), this.headFreeAt) + ms;
  }

  #parse(socket, st) {
    const b = st.buf;
    let i = 0;
    const need = (n) => i + n <= b.length;
    while (i < b.length) {
      const c = b[i];
      if (c === 0x10) {
        if (!need(3)) break;
        if (b[i + 1] === 0x04) socket.write(Buffer.from([this.#status(b[i + 2])]));
        i += 3;
      } else if (c === 0x1b) {
        if (!need(2)) break;
        const op = b[i + 1];
        if (op === 0x40) {
          Object.assign(st, { align: 0, bold: false, sw: 1, sh: 1, invert: false, table: 0 });
          i += 2;
        } else if (op === 0x70) {
          if (!need(5)) break;
          this.kicks.push({ pin: b[i + 2], onMs: b[i + 3] * 2, offMs: b[i + 4] * 2, at: Date.now() });
          i += 5;
        } else if ([0x61, 0x45, 0x74, 0x64, 0x4a].includes(op)) {
          if (!need(3)) break;
          const n = b[i + 2];
          if (op === 0x61) st.align = n % 48;
          if (op === 0x45) st.bold = !!(n & 1);
          if (op === 0x74) st.table = n;
          if (op === 0x64) this.#print(st, blank(this.widthDots, n * LINE_DOTS));
          if (op === 0x4a) this.#print(st, blank(this.widthDots, n));
          i += 3;
        } else {
          this.unknown.push(`ESC ${op}`);
          i += 2;
        }
      } else if (c === 0x1d) {
        if (!need(2)) break;
        const op = b[i + 1];
        if (op === 0x76) {
          if (!need(8)) break;
          const xb = b[i + 4] | (b[i + 5] << 8);
          const rows = b[i + 6] | (b[i + 7] << 8);
          if (!need(8 + xb * rows)) break;
          const img = { width: xb * 8, height: rows, stride: xb, bits: Uint8Array.from(b.subarray(i + 8, i + 8 + xb * rows)) };
          this.#print(st, place(img, this.widthDots, st.align));
          i += 8 + xb * rows;
        } else if (op === 0x56) {
          if (!need(3)) break;
          const m = b[i + 2];
          const len = m === 65 || m === 66 ? 4 : 3;
          if (!need(len)) break;
          this.#flushLine(st);
          this.#finishPage(st, { torn: false });
          i += len;
        } else if (op === 0x72) {
          if (!need(3)) break;
          // Answered in order, once the head has printed everything before it (never while not ready).
          const wait = Math.max(0, this.headFreeAt - Date.now());
          if (this.ready) setTimeout(() => socket.writable && socket.write(Buffer.from([0x00])), wait);
          i += 3;
        } else if (op === 0x21 || op === 0x42) {
          if (!need(3)) break;
          if (op === 0x21) {
            st.sw = (b[i + 2] >> 4) + 1;
            st.sh = (b[i + 2] & 7) + 1;
          } else st.invert = !!(b[i + 2] & 1);
          i += 3;
        } else {
          this.unknown.push(`GS ${op}`);
          i += 2;
        }
      } else if (c === 0x0a) {
        this.#flushLine(st, true);
        i++;
      } else {
        st.line.push({ byte: c, sw: st.sw, sh: st.sh, bold: st.bold, invert: st.invert, table: st.table });
        st.lineAlign = st.align;
        i++;
      }
    }
    st.buf = b.subarray(i);
  }

  // Text mode: each byte is a cell of the printer's font A (12 × 24 dots), decoded through the selected code
  // page and drawn with the bundled font. This only simulates the printer's own glyphs, which differ by model.
  #flushLine(st, lf = false) {
    if (!st.line.length) {
      if (lf) this.#print(st, blank(this.widthDots, LINE_DOTS));
      return;
    }
    const cells = st.line;
    const h = Math.max(...cells.map((c) => c.sh)) * 24 + 6;
    const w = cells.reduce((s, c) => s + c.sw * 12, 0);
    const cv = createCanvas(this.widthDots, h);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.widthDots, h);
    let x = st.lineAlign === 1 ? (this.widthDots - w) / 2 : st.lineAlign === 2 ? this.widthDots - w : 0;
    for (const c of cells) {
      const cw = c.sw * 12;
      const ch = iconv.decode(Buffer.from([c.byte]), this.codePages[c.table] ?? 'cp437');
      if (c.invert) {
        g.fillStyle = '#000';
        g.fillRect(x, 0, cw, h);
      }
      g.fillStyle = c.invert ? '#fff' : '#000';
      g.font = `${c.bold ? 'bold ' : ''}${20 * c.sh}px ${FAMILY}`;
      g.save();
      g.translate(x + cw / 2, h - 7 * c.sh);
      const mw = g.measureText(ch).width;
      if (mw > cw) g.scale(cw / mw, 1);
      g.textAlign = 'center';
      g.fillText(ch, 0, 0);
      g.restore();
      x += cw;
    }
    st.line = [];
    this.#print(st, fromRgba(g.getImageData(0, 0, this.widthDots, h).data, this.widthDots, h));
  }

  #finishPage(st, { torn }) {
    if (!st.page.length) return;
    const H = st.page.reduce((s, p) => s + p.height, 0);
    const stride = this.widthDots / 8;
    const bits = new Uint8Array(stride * H);
    let y = 0;
    for (const p of st.page) {
      bits.set(p.bits, y * stride);
      y += p.height;
    }
    this.pages.push({ mono: { width: this.widthDots, height: H, stride, bits }, torn, printedBy: Math.max(Date.now(), this.headFreeAt) });
    st.page = [];
  }
}

function blank(width, height) {
  return { width, height, stride: width / 8, bits: new Uint8Array((width / 8) * height) };
}

function place(img, width, alignN) {
  if (img.width === width) return img;
  const out = blank(width, img.height);
  const off = alignN === 1 ? Math.floor((width - img.width) / 2) : alignN === 2 ? width - img.width : 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width && x + off < width; x++) {
      if (img.bits[y * img.stride + (x >> 3)] & (0x80 >> (x & 7))) out.bits[y * out.stride + ((x + off) >> 3)] |= 0x80 >> ((x + off) & 7);
    }
  }
  return out;
}

export async function monoToPng(mono) {
  const c = createCanvas(mono.width, mono.height);
  c.getContext('2d').putImageData(new ImageData(toRgba(mono), mono.width, mono.height), 0, 0);
  return c.encode('png');
}
