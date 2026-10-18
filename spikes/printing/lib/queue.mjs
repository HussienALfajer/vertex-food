// A durable print queue: one FIFO per printer, an append-only log flushed to disk before each send, and
// at-least-once printing. A job whose bytes may have reached the printer (cut off, not confirmed, or the app
// died while sending) is printed again marked "نسخة معادة" and never kicks the drawer twice. A job that never
// reached the printer (unreachable, not ready) is retried as it was. Nothing is dropped: failures raise alerts.
import { EventEmitter } from 'node:events';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { sendNetwork } from './network.mjs';
import { sendSpooler } from './spooler.mjs';

const MAYBE_PRINTED = new Set(['cut_off', 'not_confirmed']);

export class PrintQueue extends EventEmitter {
  constructor(file, { printers, render, backoffMs = [200, 400, 800, 1600, 3000] }) {
    super();
    Object.assign(this, { file, printers, render, backoffMs });
    this.jobs = new Map();
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) this.#apply(JSON.parse(line));
    }
    // A job that was being sent when the app stopped may have printed: it comes back as a reprint.
    for (const j of this.jobs.values()) if (j.state === 'sending') Object.assign(j, { state: 'queued', maybePrinted: true });
    this.fd = openSync(file, 'a');
    this.running = false;
    this.wakers = new Map();
  }

  #apply(e) {
    if (e.op === 'enqueue') this.jobs.set(e.job.id, { ...e.job, state: 'queued', attempts: 0, maybePrinted: false, seq: this.jobs.size });
    const j = this.jobs.get(e.id ?? e.job?.id);
    if (!j) return;
    if (e.op === 'sending') Object.assign(j, { state: 'sending', attempts: j.attempts + 1 });
    if (e.op === 'failed') Object.assign(j, { state: 'queued', maybePrinted: j.maybePrinted || MAYBE_PRINTED.has(e.code), lastError: e.code });
    if (e.op === 'printed') Object.assign(j, { state: 'printed', printedAt: e.at });
  }

  #log(e) {
    writeSync(this.fd, `${JSON.stringify(e)}\n`);
    fsyncSync(this.fd);
    this.#apply(e);
  }

  enqueue(job) {
    if (this.jobs.has(job.id)) return; // idempotent by job id (the ticket or payment id in the product)
    this.#log({ op: 'enqueue', job });
    this.wakers.get(job.printer)?.();
  }

  pending(printer) {
    return [...this.jobs.values()].filter((j) => j.printer === printer && j.state !== 'printed').sort((a, b) => a.seq - b.seq);
  }

  start() {
    this.running = true;
    this.loops = Object.keys(this.printers).map((name) => this.#loop(name));
  }

  async stop() {
    this.running = false;
    for (const w of this.wakers.values()) w();
    await Promise.all(this.loops ?? []);
    closeSync(this.fd);
  }

  async #loop(name) {
    let failures = 0;
    while (this.running) {
      const job = this.pending(name)[0];
      if (!job) {
        await new Promise((r) => this.wakers.set(name, r));
        continue;
      }
      const reprint = job.maybePrinted;
      // A reprint never opens the drawer again.
      const bytes = await this.render(job, { reprint, kick: job.kick && !reprint });
      this.#log({ op: 'sending', id: job.id, reprint });
      this.emit('sending', job, bytes.length);
      try {
        const p = this.printers[name];
        const result = p.type === 'network' ? await sendNetwork(p, bytes, p.options) : sendSpooler(p.name, bytes);
        this.#log({ op: 'printed', id: job.id, at: Date.now() });
        this.emit('printed', job, { reprint, ...result });
        failures = 0;
      } catch (e) {
        this.#log({ op: 'failed', id: job.id, code: e.code ?? 'error' });
        this.emit('alert', { printer: name, job: job.id, code: e.code, detail: e.detail });
        const wait = this.backoffMs[Math.min(failures++, this.backoffMs.length - 1)];
        await new Promise((r) => {
          const t = setTimeout(r, wait);
          this.wakers.set(name, () => {
            clearTimeout(t);
            r();
          });
        });
      }
    }
  }
}
