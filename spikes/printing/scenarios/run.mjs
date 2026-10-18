// Spike B checks and measurements. Run: `pnpm scenarios` (Node) or `pnpm scenarios:electron` (Electron's main
// process, plus the Chromium rendering comparison). Options: --spooler "<Windows printer name>" sends one small
// RAW job through the Windows spooler to that printer (USB path) and reports it.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { PrinterEmulator, monoToPng } from '../emulator/printer.mjs';
import { codePageJob, shape, visual } from '../lib/codepage.mjs';
import { PAPER } from '../lib/documents.mjs';
import * as P from '../lib/escpos.mjs';
import { FAMILY, registerCanvasFonts } from '../lib/fonts.mjs';
import { kitchenTicket } from '../lib/fixtures.mjs';
import { PC864_TABLE, docFor, logoFor, renderJob } from '../lib/jobs.mjs';
import { blackRatio, diffDots } from '../lib/mono.mjs';
import { PrintError, sendNetwork } from '../lib/network.mjs';
import { PrintQueue } from '../lib/queue.mjs';
import { renderCanvas } from '../lib/render-canvas.mjs';
import { sendSpooler } from '../lib/spooler.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

if (!process.versions.electron && opt('--runtime') === 'electron') {
  const electron = createRequire(import.meta.url)('electron');
  const child = spawn(electron, [path.join(root, 'electron', 'main.mjs'), ...argv.filter((a, i) => a !== '--runtime' && argv[i - 1] !== '--runtime')], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  await main();
}

async function main() {
  const runtime = process.versions.electron ? 'electron' : 'node';
  const outDir = path.join(root, 'out', runtime);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const timings = {};
  const check = (section, name, ok, detail) => {
    results.push({ section, name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} [${section}] ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(20);
    }
    return false;
  };
  const bench = async (fn, n = 15) => {
    for (let i = 0; i < 2; i++) await fn();
    const t = [];
    for (let i = 0; i < n; i++) {
      const s = performance.now();
      await fn();
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    return { median: +t[n >> 1].toFixed(2), max: +t[n - 1].toFixed(2) };
  };
  const save = async (name, mono) => writeFileSync(path.join(outDir, `${name}.png`), await monoToPng(mono));
  const expect = async (fn, code) => {
    const s = performance.now();
    try {
      await fn();
      return { ok: false, got: 'success' };
    } catch (e) {
      return { ok: e instanceof PrintError ? e.code === code : e.code === code, got: e.code, detail: e.detail, win32: e.win32, ms: +(performance.now() - s).toFixed(1) };
    }
  };

  // ---------------------------------------------------------------- shaping and direction
  await registerCanvasFonts();
  const g = createCanvas(10, 10).getContext('2d');
  g.font = `bold 24px ${FAMILY}`;
  const joined = g.measureText('بببب').width;
  const isolated = g.measureText('ب‌ب‌ب‌ب').width;
  check('shaping', 'image path: Skia joins Arabic letters (a joined word is narrower than its letters kept apart)', joined < isolated * 0.8, { joined, isolated });
  check('shaping', 'code-page path: the JavaScript shaper picks contextual forms and the lam-alef ligature', shape('بيت لا') === 'ﺑﻴﺖ ﻻ', [...shape('بيت لا')].map((c) => c.codePointAt(0).toString(16)));
  const v = visual(shape('فاتورة رقم 1042'));
  check('shaping', 'code-page path: a line is reordered for a left-to-right printer, numbers kept in reading order', v.startsWith('1042 ') && v.endsWith([...shape('فاتورة')].reverse().join('')), v);

  // ---------------------------------------------------------------- rendering, both paths
  const docs = {};
  for (const paper of [58, 80]) {
    const logo = await logoFor(paper);
    for (const kind of ['receipt', 'kitchen']) {
      const job = { kind, paper };
      const doc = docFor(job);
      const lg = kind === 'receipt' ? logo : undefined;
      const s = performance.now();
      const mono = await renderCanvas(doc, paper, { logo: lg });
      const first = performance.now() - s;
      docs[`${kind}-${paper}`] = { doc, mono, logo: lg };
      check('render', `image ${kind} ${paper} mm: ${mono.width} dots wide, ${(mono.height / 8).toFixed(0)} mm long`, mono.width === PAPER[paper].dots && blackRatio(mono) > 0.03, { h: mono.height, black: blackRatio(mono) });
      await save(`image-${kind}-${paper}`, mono);
      const render = await bench(() => renderCanvas(doc, paper, { logo: lg }));
      const encode = await bench(() => P.imageJob(mono, { kick: true }));
      const cp = codePageJob(doc, paper, { logo: lg, table: PC864_TABLE });
      const cpBench = await bench(() => codePageJob(doc, paper, { logo: lg, table: PC864_TABLE }));
      timings[`${kind}-${paper}`] = {
        lengthMm: +(mono.height / 8).toFixed(1),
        image: { firstRenderMs: +first.toFixed(1), renderMs: render, encodeMs: encode, bytes: P.imageJob(mono).length },
        codepage: { buildMs: cpBench, bytes: cp.bytes.length, logoBytes: lg ? lg.stride * lg.height : 0, ...cp.stats },
      };
    }
  }
  const cpStats = timings['receipt-80'].codepage;
  check('codepage', `IBM 864 substitutes a nearer form for ${cpStats.substituted} of ${cpStats.chars} characters on the receipt (missing medial and final forms)`, cpStats.substituted > 0, cpStats);
  check('codepage', `IBM 864 cannot print ${cpStats.missing.length} characters of the receipt at all (Turkish letters)`, cpStats.missing.length > 0, cpStats.missing);

  // ---------------------------------------------------------------- the printer round trip (network)
  const em = { 80: new PrinterEmulator({ name: 'em80', widthDots: 576, mmPerSec: 150 }), 58: new PrinterEmulator({ name: 'em58', widthDots: 384, mmPerSec: 90 }) };
  for (const e of Object.values(em)) await e.start();
  const target = (e, options = {}) => ({ host: '127.0.0.1', port: e.port, ...options });
  timings.network = {};
  for (const paper of [58, 80]) {
    for (const kind of ['receipt', 'kitchen']) {
      const { mono, doc, logo } = docs[`${kind}-${paper}`];
      const e = em[paper];
      const kicksBefore = e.kicks.length;
      const r = await sendNetwork(target(e), P.imageJob(mono, { kick: kind === 'receipt' }));
      const page = e.pages.at(-1);
      const d = diffDots({ ...page.mono, height: mono.height }, mono);
      check('network', `image ${kind} ${paper} mm: the printer's paper matches the rendered page dot for dot`, !page.torn && d.diff === 0 && page.mono.height >= mono.height, d);
      const printMs = ((page.mono.height / 8) / e.mmPerSec) * 1000;
      timings.network[`image-${kind}-${paper}`] = { bytes: r.bytes, ...Object.fromEntries(Object.entries(r.ms).map(([k, x]) => [k, +x.toFixed(1)])), modelPrintMs: +printMs.toFixed(0), mmPerSec: e.mmPerSec };
      check('network', `image ${kind} ${paper} mm: "printed" is confirmed only after the head finished (${r.ms.untilPrinted.toFixed(0)} ms for ${printMs.toFixed(0)} ms of printing)`, r.ms.total >= printMs * 0.8, r.ms);
      check('drawer', `${kind} ${paper} mm: ${kind === 'receipt' ? 'the cash receipt kicks the drawer once (pin 2, 50 ms on)' : 'a kitchen ticket never kicks a drawer'}`, kind === 'receipt' ? e.kicks.length === kicksBefore + 1 && e.kicks.at(-1).pin === 0 && e.kicks.at(-1).onMs === 50 : e.kicks.length === kicksBefore, e.kicks.slice(kicksBefore));
      const cp = codePageJob(doc, paper, { logo, table: PC864_TABLE });
      await sendNetwork(target(e), cp.bytes);
      await save(`codepage-${kind}-${paper}`, e.pages.at(-1).mono);
    }
  }
  check('network', 'the emulator met no command it does not know', em[80].unknown.length === 0 && em[58].unknown.length === 0, [...em[80].unknown, ...em[58].unknown]);
  {
    const { mono } = docs['receipt-80'];
    await sendNetwork(target(em[80]), P.imageJob(mono, { bandRows: 24 }));
    const d = diffDots({ ...em[80].pages.at(-1).mono, height: mono.height }, mono);
    check('network', 'the same page in 24-row bands (for printers with small buffers) prints identically', d.diff === 0, d);
  }

  // ---------------------------------------------------------------- printer states
  const e80 = em[80];
  const { mono: kMono } = docs['kitchen-80'];
  const kJob = P.imageJob(kMono);
  for (const [fault, flag] of [['paperOut', 'paperEnd'], ['coverOpen', 'coverOpen']]) {
    e80.fault = fault;
    const pages = e80.pages.length;
    const r = await expect(() => sendNetwork(target(e80), kJob), 'not_ready');
    check('status', `${fault}: the status asked first refuses the job (${flag}) and nothing is sent`, r.ok && r.detail?.[flag] && e80.pages.length === pages && e80.droppedWhileNotReady === 0, r);
    e80.fault = null;
  }
  {
    const off = new PrinterEmulator();
    const port = await off.start();
    await off.stop();
    const r = await expect(() => sendNetwork({ host: '127.0.0.1', port }, kJob), 'unreachable');
    check('status', `a switched-off printer fails fast (${r.ms} ms on the LAN when the host answers; 2 s when it does not)`, r.ok, r);
    e80.fault = 'silent';
    const r2 = await expect(() => sendNetwork(target(e80, { options: undefined }), kJob, { answerMs: 800 }), 'no_answer');
    check('status', `a printer that accepts the connection and never answers fails after the answer timeout (${r2.ms} ms), not never`, r2.ok && r2.ms < 2000, r2);
    e80.fault = null;
    await sleep(50);
  }
  {
    const before = e80.pages.length;
    const tk = () => P.imageJob(kMono);
    // The second PC's status question waits until the first job is done, so its answer timeout must cover a job.
    const [a, b] = await Promise.all([sendNetwork(target(e80), tk()), sendNetwork(target(e80), tk(), { answerMs: 5000 })]);
    const two = e80.pages.slice(before);
    const ok = two.length === 2 && two.every((p) => diffDots({ ...p.mono, height: kMono.height }, kMono).diff === 0);
    check('network', `two PCs printing to one printer at once: the printer serves one connection at a time, so pages never interleave (second waited ${Math.max(a.ms.total, b.ms.total).toFixed(0)} ms)`, ok, { pages: two.length });
  }

  // ---------------------------------------------------------------- the durable queue
  const expected = async (job, reprint = false) => renderCanvas(docFor(job, { reprint }), job.paper, { logo: job.kind === 'receipt' ? await logoFor(job.paper) : undefined });
  const which = (page, cands) => cands.findIndex((c) => page.mono.height >= c.height && diffDots({ ...page.mono, height: c.height }, c).diff === 0);
  {
    const kitchen = new PrinterEmulator({ name: 'kitchen', widthDots: 576, mmPerSec: 150 });
    const port = await kitchen.start();
    await kitchen.stop(); // the kitchen printer is off when the tickets arrive
    const q = new PrintQueue(path.join(outDir, 'queue-kitchen.jsonl'), {
      printers: { kitchen: { type: 'network', host: '127.0.0.1', port, options: { answerMs: 800 } } },
      render: renderJob,
      backoffMs: [100, 200, 400],
    });
    const alerts = [];
    const printed = [];
    q.on('alert', (a) => alerts.push(a));
    q.on('printed', (j, r) => printed.push({ id: j.id, reprint: r.reprint }));
    const tickets = [2001, 2002, 2003].map((n) => ({ id: `t-${n}`, printer: 'kitchen', kind: 'kitchen', paper: 80, data: { ...kitchenTicket, orderNumber: n } }));
    q.start();
    for (const t of tickets) q.enqueue(t);
    q.enqueue(tickets[0]); // the same ticket twice: kept once
    await until(() => alerts.length >= 2);
    const tOn = Date.now();
    await kitchen.start(port);
    await until(() => printed.length === 3);
    const exp = await Promise.all(tickets.map((t) => expected(t)));
    const order = kitchen.pages.map((p) => which(p, exp));
    check('queue', 'printer off: tickets wait, every failed attempt raises an alert ("unreachable"), nothing is dropped', alerts.every((a) => a.code === 'unreachable') && q.pending('kitchen').length === 0, { alerts: alerts.length });
    check('queue', `printer back: the three tickets print once each, in order, without a reprint mark (${Date.now() - tOn} ms after power on)`, JSON.stringify(order) === '[0,1,2]' && printed.every((p) => !p.reprint), { order, printed });
    alerts.length = 0;
    kitchen.fault = 'paperOut';
    const t4 = { id: 't-2004', printer: 'kitchen', kind: 'kitchen', paper: 80, data: { ...kitchenTicket, orderNumber: 2004 } };
    q.enqueue(t4);
    await until(() => alerts.length >= 1);
    kitchen.fault = null;
    await until(() => printed.length === 4);
    check('queue', 'paper out: the ticket waits with a "not_ready / paperEnd" alert and prints as new once paper is loaded', alerts[0]?.code === 'not_ready' && alerts[0]?.detail?.paperEnd && printed[3]?.reprint === false && which(kitchen.pages.at(-1), [await expected(t4)]) === 0, alerts[0]);
    await q.stop();
    await kitchen.stop();
  }
  {
    const cashier = new PrinterEmulator({ name: 'cashier', widthDots: 576, mmPerSec: 150 });
    const port = await cashier.start();
    cashier.fault = { dropAfter: 20_000 };
    const q = new PrintQueue(path.join(outDir, 'queue-cut.jsonl'), {
      printers: { cashier: { type: 'network', host: '127.0.0.1', port, options: { answerMs: 800 } } },
      render: renderJob,
      backoffMs: [100],
    });
    const printed = [];
    const alerts = [];
    q.on('printed', (j, r) => printed.push(r.reprint));
    q.on('alert', (a) => alerts.push(a.code));
    const job = { id: 'pay-1', printer: 'cashier', kind: 'receipt', paper: 80, kick: true };
    q.start();
    q.enqueue(job);
    await until(() => printed.length === 1);
    await q.stop();
    const [torn, again] = cashier.pages;
    check('queue', 'connection cut in the middle of a receipt: the half page stays, the receipt prints again whole, marked "نسخة معادة"', alerts[0] === 'cut_off' && torn?.torn && again && !again.torn && which(again, [await expected(job, true)]) === 0 && printed[0] === true, { alerts, pages: cashier.pages.map((p) => p.torn) });
    check('drawer', 'the reprint does not open the cash drawer a second time', cashier.kicks.length === 1, cashier.kicks);
    await cashier.stop();
  }
  {
    // The app dies while sending: TerminateProcess on the queue process, then a restart.
    const printer = new PrinterEmulator({ name: 'cashier-slow', widthDots: 576, mmPerSec: 40, bufferMs: 150 });
    const port = await printer.start();
    const file = path.join(outDir, 'queue-kill.jsonl');
    const job = { id: 'pay-2', printer: 'cashier', kind: 'receipt', paper: 80, kick: true };
    const base = { file, printers: { cashier: { type: 'network', host: '127.0.0.1', port, options: { answerMs: 800, printMsMax: 60_000 } } }, exitWhenDone: true };
    const runChild = (cfg) => {
      const args = process.versions.electron ? [path.join(root, 'electron', 'main.mjs')] : [path.join(root, 'scenarios', 'queue-child.mjs')];
      const child = spawn(process.execPath, args, { env: { ...process.env, QUEUE_CONFIG: JSON.stringify(cfg) }, stdio: ['ignore', 'pipe', 'inherit'] });
      child.events = [];
      child.stdout.on('data', (d) => child.events.push(...d.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
      child.exited = new Promise((r) => child.on('exit', r));
      return child;
    };
    const c1 = runChild({ ...base, enqueue: [job] });
    await until(() => printer.received > 8_000, 20_000);
    const killedAt = printer.received;
    c1.kill('SIGKILL');
    await c1.exited;
    await until(() => printer.pages.length === 1, 3000);
    const c2 = runChild(base);
    const tStart = Date.now();
    await c2.exited;
    const ready = c2.events.find((e) => e.ev === 'ready');
    const done = c2.events.find((e) => e.ev === 'printed');
    check('queue', 'power cut of the app while sending: after restart the receipt is pending as "maybe printed"', ready?.pending?.[0]?.maybePrinted === true, ready);
    check('queue', `it prints again whole with the reprint mark (killed after ${killedAt} bytes; restart to confirmed print ${Date.now() - tStart} ms on a 40 mm/s printer)`, done?.reprint === true && printer.pages[0]?.torn && which(printer.pages.at(-1), [await expected(job, true)]) === 0, { pages: printer.pages.map((p) => p.torn), killedAt });
    check('drawer', 'the drawer opened once across the cut and the restart', printer.kicks.length === 1, printer.kicks.length);
    await printer.stop();
  }

  // ---------------------------------------------------------------- USB through the Windows spooler
  {
    const r = await expect(() => sendSpooler('Vertex Food spike — no such printer', P.init()), 'open_failed');
    check('usb', `koffi loads winspool.drv in ${runtime}; an unknown printer fails with Win32 error ${r.win32}`, r.ok && r.win32 === 1801, r);
    const name = opt('--spooler');
    if (name) {
      try {
        const res = sendSpooler(name, Buffer.concat([P.init(), Buffer.from('Vertex Food spike B\n'), P.feed(3), P.cut()]));
        check('usb', `RAW job accepted by the spooler for "${name}"`, res.jobId > 0, res);
      } catch (e) {
        check('usb', `RAW job to "${name}"`, false, { code: e.code, win32: e.win32 });
      }
    }
  }

  // ---------------------------------------------------------------- Chromium rendering (Electron only)
  if (runtime === 'electron') {
    const { openRenderer, renderElectron, closeRenderer } = await import('../electron/render-electron.mjs');
    const { syntheticLogoPng } = await import('../lib/logo.mjs');
    const cold = await openRenderer();
    timings.chromium = { windowOpenMs: +cold.toFixed(1) };
    for (const paper of [58, 80]) {
      for (const kind of ['receipt', 'kitchen']) {
        const { doc, mono, logo } = docs[`${kind}-${paper}`];
        const logoPng = logo ? await monoToPng(logo) : undefined;
        const r = await renderElectron(doc, paper, { logoPng, tmpDir: outDir });
        await save(`chromium-${kind}-${paper}`, r.mono);
        const t = await bench(() => renderElectron(doc, paper, { logoPng, tmpDir: outDir }), 5);
        const d = diffDots(r.mono, mono);
        timings.chromium[`${kind}-${paper}`] = { renderMs: t, displayScale: r.scale, heightDots: r.mono.height, canvasHeightDots: mono.height, diffRatio: +(d.ratio ?? 0).toFixed(4) };
        check('chromium', `Chromium renders the ${kind} ${paper} mm at ${r.mono.width} dots (the canvas page differs on ${((d.ratio ?? 0) * 100).toFixed(1)} % of dots: line breaks and font hinting)`, r.mono.width === PAPER[paper].dots, timings.chromium[`${kind}-${paper}`]);
      }
    }
    closeRenderer();
    void syntheticLogoPng;
  }

  for (const e of Object.values(em)) await e.stop();
  const failed = results.filter((r) => !r.ok).length;
  const report = { runtime, node: process.versions.node, electron: process.versions.electron, date: new Date().toISOString(), passed: results.length - failed, failed, timings, results };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${failed} failed (${runtime}). Report: out/${runtime}/report.json`);
  process.exit(failed ? 1 : 0);
}
