// Network printers: raw TCP (port 9100). Ask the status first, send the job, then wait for GS r's answer,
// which a printer sends after the preceding data has been printed. Every failure is a typed error the
// queue can retry or show; nothing waits forever.
import net from 'node:net';
import * as P from './escpos.mjs';

export class PrintError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `: ${JSON.stringify(detail)}` : ''}`);
    this.code = code; // unreachable | no_answer | not_ready | cut_off | not_confirmed
    this.detail = detail;
  }
}

export async function sendNetwork({ host, port }, job, { connectMs = 2000, answerMs = 1500, printMsMax = 20_000 } = {}) {
  const t0 = performance.now();
  const socket = new net.Socket();
  const inbox = [];
  let wake = null;
  let closed = null;
  socket.setNoDelay(true);
  socket.on('data', (d) => {
    inbox.push(...d);
    wake?.();
  });
  socket.on('error', (e) => (closed ??= e));
  socket.on('close', () => {
    closed ??= new Error('closed');
    wake?.();
  });
  const read = (n, ms, code) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new PrintError(code, { waitedMs: ms })), ms);
      wake = () => {
        if (inbox.length >= n) {
          clearTimeout(timer);
          resolve(inbox.splice(0, n));
        } else if (closed) {
          clearTimeout(timer);
          reject(new PrintError('cut_off', { message: closed.message }));
        }
      };
      wake();
    });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new PrintError('unreachable', { timeoutMs: connectMs })), connectMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (e) => {
        clearTimeout(timer);
        reject(new PrintError('unreachable', { code: e.code }));
      });
      socket.connect(port, host);
    });
    const tConnect = performance.now();
    socket.write(Buffer.concat([P.statusQuery(1), P.statusQuery(2), P.statusQuery(4)]));
    const [s1, s2, s4] = await read(3, answerMs, 'no_answer');
    const status = { ...P.parseStatus(1, s1), ...P.parseStatus(2, s2), ...P.parseStatus(4, s4) };
    if (status.offline || status.coverOpen || status.paperEnd) throw new PrintError('not_ready', status);
    const tStatus = performance.now();
    await new Promise((resolve, reject) => socket.write(Buffer.concat([job, P.transmitStatus()]), (e) => (e ? reject(new PrintError('cut_off', { message: e.message })) : resolve())));
    const tSent = performance.now();
    await read(1, printMsMax, 'not_confirmed');
    const tDone = performance.now();
    return {
      status,
      bytes: job.length,
      ms: { connect: tConnect - t0, status: tStatus - tConnect, send: tSent - tStatus, untilPrinted: tDone - tSent, total: tDone - t0 },
    };
  } finally {
    socket.end();
    socket.destroy();
  }
}
