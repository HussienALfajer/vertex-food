// Spike C checks in Node: the driver app's queue against the server through a simulated weak network, the
// time base, ADR 0009's visibility rules, the wire format and the battery model. Run: `pnpm scenarios`.
// The Android side (background location, Doze, killed app, battery counters) is `pnpm emulator`.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Outbox } from '../core/outbox.js';
import { PROFILES as POLICY, profileFor } from '../core/policy.js';
import { sensitiveIn } from '../core/redact.js';
import { resolveTime } from '../core/timebase.js';
import { uuidv7 } from '../core/uuid7.js';
import { decodePoints, encodePoints } from '../core/wire.js';
import { PROFILES, weakNet } from '../net/weaknet.mjs';
import { startServer } from '../server/server.mjs';
import { makeDriver, nodeDb, route, testClock } from './driver.mjs';
import { model } from './energy.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out', 'node');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const results = [];
const measures = {};
const logs = [];
const log = (l) => logs.push(l);
const check = (section, name, ok, detail) => {
  results.push({ section, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${section}] ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newRun = () => uuidv7(Date.now(), randomBytes);
let dbn = 0;
const dbFile = () => path.join(outDir, `driver-${++dbn}.db`);
const customer = (n) => ({ name: `زبون تجريبي ${n}`, phone: `+963-000-000-${String(n).padStart(3, '0')}`, address: `عنوان تجريبي ${n}، قرب المعلم` });

const server = await startServer({ log });
const net = await weakNet({ targetPort: server.port });
const viaNet = `http://127.0.0.1:${net.port}`;
const q = (sql, ...p) => server.db.prepare(sql).all(...p);
let jobN = 0;
const job = (driver, fleet = 'fleet-r1', tenant = 'tenant-r1') => {
  const id = `job-${++jobN}`;
  server.createJob({ id, tenant, fleet, driver, customer: customer(jobN), totalMinor: 4_500_000, customerToken: `cust-${id}` });
  return id;
};
// Record a fix the way the app does: the OS gives points, the queue stamps the callback.
const fixes = (driver, pts, everyMs) => {
  for (const p of pts) {
    driver.clock.advance(everyMs);
    driver.outbox.addPoints([{ t: driver.clock.wallNow(), ...p }]);
  }
};
const lastFix = (driver, p) => ({ t: driver.clock.wallNow(), ...p });

try {
  // 1. The queue alone: durable across a reopen, ordered, ids from the device.
  {
    const file = dbFile();
    const clock = testClock();
    let db = nodeDb(file);
    let ob = new Outbox(db, { clock, newId: (ms) => uuidv7(ms, randomBytes) });
    const ids = ['duty_on', 'accepted', 'at_restaurant'].map((type) => ob.record({ type, jobId: 'job-x', fleet: 'fleet-r1' }));
    db.close();
    db = nodeDb(file);
    ob = new Outbox(db, { clock, newId: (ms) => uuidv7(ms, randomBytes) });
    const b = ob.nextBatch();
    check('queue', 'events survive a reopen, in recorded order, with their device ids', JSON.stringify(b.body.events.map((e) => e.id)) === JSON.stringify(ids), { ids });
    check('queue', 'ids are UUIDv7 carrying the device time (order comes from the queue, not the id)', ids.every((i) => i[14] === '7' && Math.abs(Number.parseInt(i.replace(/-/g, '').slice(0, 12), 16) - Date.now()) < 60_000), ids);
    db.close();
  }

  // 2. A whole delivery on a good link.
  {
    net.set(PROFILES.lan);
    const d = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock(), log });
    const j = job('d1');
    const r = route(12);
    d.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    fixes(d, r.slice(0, 3), 15_000);
    d.outbox.record({ type: 'accepted', jobId: j }, lastFix(d, r[2]));
    fixes(d, r.slice(3, 6), 15_000);
    d.outbox.record({ type: 'at_restaurant', jobId: j }, lastFix(d, r[5]));
    d.outbox.record({ type: 'picked_up', jobId: j }, lastFix(d, r[5]));
    fixes(d, r.slice(6, 12), 15_000);
    d.outbox.record({ type: 'delivered', jobId: j }, lastFix(d, r[11]));
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    d.clock.syncTo(Date.now());
    const s = await d.syncUntilEmpty();
    const ev = q("SELECT type, status FROM events WHERE driver_id = 'd1' ORDER BY arrival");
    check('lan', 'every event accepted once, in device order', s.ok && ev.map((e) => `${e.type}:${e.status}`).join() === 'duty_on:accepted,accepted:accepted,at_restaurant:accepted,picked_up:accepted,delivered:accepted,duty_off:accepted', ev);
    check('lan', 'the job ends delivered and every on-duty point is stored', q('SELECT state FROM jobs WHERE id = ?', j)[0].state === 'delivered' && q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1'")[0].n === 12, q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1'")[0]);
    check('lan', 'job events carry the location where they happened', q('SELECT COUNT(*) n FROM events WHERE job_id = ? AND lat IS NOT NULL', j)[0].n === 4, null);
    d.close();
  }

  // 3. EDGE with lost answers and resets: nothing lost, nothing applied twice, order kept.
  {
    net.set({ ...PROFILES.edge, answerLossProb: 0.3, resetProb: 0.1 });
    const d = makeDriver({ file: dbFile(), token: 'tok-d3', url: viaNet, clock: testClock({ startWall: Date.now() - 3_600_000 }), log, timeoutMs: 20_000 });
    const jobs = [job('d3'), job('d3')];
    const r = route(80);
    const recorded = [];
    const rec = (e, fix) => recorded.push(d.outbox.record(e, fix));
    rec({ type: 'duty_on', fleet: 'fleet-r1' });
    let i = 0;
    const t0 = performance.now();
    let drains = [];
    for (const j of jobs) {
      for (const type of ['accepted', 'at_restaurant', 'picked_up', 'delivered']) {
        fixes(d, r.slice(i, i + 10), 15_000);
        i += 10;
        rec({ type, jobId: j }, lastFix(d, r[i - 1]));
        drains.push(d.syncUntilEmpty({ maxAttempts: 3 }));
        await drains.at(-1);
      }
    }
    d.clock.syncTo(Date.now());
    rec({ type: 'duty_off', fleet: 'fleet-r1' });
    const s = await d.syncUntilEmpty({ maxAttempts: 100 });
    const ms = Math.round(performance.now() - t0);
    const ev = q("SELECT id, status FROM events WHERE driver_id = 'd3' ORDER BY arrival");
    const pts = q("SELECT COUNT(*) n, COUNT(DISTINCT device_t) u FROM points WHERE driver_id = 'd3'")[0];
    measures.edgeLossy = { ms, requests: d.requests, answersLost: net.stats.answersLost, resets: net.stats.resets, upBytes: net.stats.upBytes, downBytes: net.stats.downBytes };
    check('weak network', 'the queue empties on EDGE with 30 % of answers lost and 10 % of connections reset', s.ok && d.outbox.counts().events === 0 && d.outbox.counts().points === 0, { s, counts: d.outbox.counts() });
    check('weak network', 'the lossy path was exercised (answers lost and resent)', net.stats.answersLost > 0 && d.requests > 9, measures.edgeLossy);
    check('weak network', 'each event stored once, all accepted, in the order recorded', ev.length === recorded.length && ev.every((e, k) => e.id === recorded[k] && e.status === 'accepted'), ev.map((e) => e.status));
    check('weak network', 'every point stored exactly once although batches were resent', pts.n === 80 && pts.u === 80, pts);
    check('weak network', 'both jobs end delivered', jobs.every((j) => q('SELECT state FROM jobs WHERE id = ?', j)[0].state === 'delivered'), null);
    d.close();
  }

  // 4. A blackout during a delivery: the customer sees the newest position with the first request back.
  {
    net.set({ ...PROFILES.edge, offline: true });
    const startWall = Date.now() - 25 * 60_000;
    const d = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock({ startWall }), log, timeoutMs: 20_000 });
    const j = job('d1');
    const r = route(100);
    const pointsBefore = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1'")[0].n;
    d.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    d.outbox.record({ type: 'accepted', jobId: j });
    fixes(d, r.slice(0, 20), 15_000);
    d.outbox.record({ type: 'at_restaurant', jobId: j }, lastFix(d, r[19]));
    d.outbox.record({ type: 'picked_up', jobId: j }, lastFix(d, r[19]));
    fixes(d, r.slice(20, 100), 15_000); // 20 more minutes with no network
    const failed = await d.syncUntilEmpty({ maxAttempts: 3 });
    check('blackout', 'with no network every attempt fails fast and the queue keeps everything', !failed.ok && d.outbox.counts().points === 100 && d.outbox.counts().events === 4, { failed, c: d.outbox.counts() });
    d.clock.syncTo(Date.now());
    net.set(PROFILES.edge);
    const t0 = performance.now();
    const first = d.outbox.nextBatch({ maxPoints: 50 });
    const ans = await (await fetch(`${viaNet}/driver/sync`, { method: 'POST', headers: { authorization: 'Bearer tok-d1' }, body: JSON.stringify(first.body) })).json();
    d.outbox.settle(first, ans);
    const firstMs = Math.round(performance.now() - t0);
    const seen = server.customerTracking(j);
    const newestT = q("SELECT MAX(t) t FROM points WHERE driver_id = 'd1'")[0].t;
    check('blackout', 'after the first request the customer sees the newest position, not the oldest backlog', seen.visible && seen.position?.t === newestT && Math.abs(Date.now() - seen.position.t) < 30_000, { seen, firstMs });
    const rest = await d.syncUntilEmpty({ opts: { maxPoints: 50 } });
    const allMs = Math.round(performance.now() - t0);
    check('blackout', 'the backlog then drains in order and the job is picked_up', rest.ok && q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1'")[0].n - pointsBefore === 100 && q('SELECT state FROM jobs WHERE id = ?', j)[0].state === 'picked_up', rest);
    measures.blackout = { minutesOffline: 25, points: 100, firstLivePositionMs: firstMs, drainAllMs: allMs, requests: 1 + rest.attempts, bytes: JSON.stringify(first.body).length + rest.bytes };
    d.outbox.record({ type: 'delivered', jobId: j }, lastFix(d, r[99]));
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    await d.syncUntilEmpty();
    d.close();
  }

  // 5. A black hole: connections hang. The request timeout ends each attempt; nothing is lost.
  {
    net.set({ ...PROFILES.edge, blackhole: true });
    const d = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock(), log, timeoutMs: 2_000 });
    d.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    const t0 = performance.now();
    const r = await d.syncUntilEmpty({ maxAttempts: 2 });
    const ms = Math.round(performance.now() - t0);
    check('blackout', 'a hanging link ends each attempt at the request timeout and keeps the event', !r.ok && ms < 6_000 && d.outbox.counts().events === 1, { r, ms });
    net.set(PROFILES.poor3g);
    const r2 = await d.syncUntilEmpty();
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    await d.syncUntilEmpty();
    check('blackout', 'when the link comes back the event goes through', r2.ok, r2);
    d.close();
  }

  // 6. The app killed after the server applied a batch and before the answer arrived.
  {
    net.set(PROFILES.poor3g);
    const file = dbFile();
    const clock = testClock();
    const j = job('d2', 'fleet-r2', 'tenant-r2');
    {
      const db = nodeDb(file);
      const ob = new Outbox(db, { clock, newId: (ms) => uuidv7(ms, randomBytes) });
      ob.record({ type: 'duty_on', fleet: 'fleet-r2' });
      ob.record({ type: 'accepted', jobId: j });
      ob.record({ type: 'at_restaurant', jobId: j });
      for (const p of route(30)) {
        clock.advance(15_000);
        ob.addPoints([{ t: clock.wallNow(), ...p }]);
      }
      db.close();
    }
    const child = (run) =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [path.join(root, 'scenarios', 'driver-child.mjs'), file, viaNet, 'tok-d2', run], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        c.stdout.on('data', (b) => { out += b; });
        c.on('exit', (code, signal) => resolve({ code, signal, out: out.trim(), pid: c.pid, proc: c }));
        net.patch({
          onAnswer: () => {
            c.kill('SIGKILL');
            net.patch({ onAnswer: undefined });
            return 'drop';
          },
        });
      });
    const killed = await child(newRun());
    const applied = q("SELECT COUNT(*) n FROM events WHERE driver_id = 'd2'")[0].n;
    check('killed app', 'the app is killed after the server applied the batch, before the answer', killed.signal === 'SIGKILL' && applied === 3, { killed: { code: killed.code, signal: killed.signal }, applied });
    net.patch({ onAnswer: undefined });
    const again = await new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(root, 'scenarios', 'driver-child.mjs'), file, viaNet, 'tok-d2', newRun()], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      c.stdout.on('data', (b) => { out += b; });
      c.on('exit', () => resolve(JSON.parse(out.trim())));
    });
    const ev = q("SELECT type, status FROM events WHERE driver_id = 'd2' ORDER BY arrival");
    const pts = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd2'")[0].n;
    check('killed app', 'restarted, it resends the same batch: events once, points once, queue empty', again.ok && again.after.events === 0 && again.after.points === 0 && ev.length === 3 && ev.every((e) => e.status === 'accepted') && pts === 30, { again, ev, pts });
    const dupLines = logs.filter((l) => l.includes('driver=d2') && /duplicate=3\b/.test(l));
    check('killed app', 'the server answered the 3 resent events as duplicates', again.before.events === 3 && dupLines.length === 1, { dupLines: dupLines.length });
    const rows = q("SELECT basis FROM events WHERE driver_id = 'd2'");
    check('killed app', 'times recorded before the restart use the wall clock (the monotonic clock died with the process)', rows.every((r) => r.basis === 'wall'), rows);
    const d = makeDriver({ file, token: 'tok-d2', url: viaNet, clock: testClock(), log });
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r2' });
    await d.syncUntilEmpty();
    d.close();
  }

  // 7. The phone's clock: wrong, changed, or the app restarted.
  {
    const serverNow = 1_800_000_000_000;
    const run = 'run-a';
    const truth = serverNow - 600_000; // the event happened 10 minutes before the send
    const wrongBy = -3 * 3_600_000;
    const a = resolveTime({ wall: truth + wrongBy, mono: 1_000, run }, { wall: serverNow + wrongBy, mono: 601_000, run }, serverNow);
    check('clock', 'a phone 3 h behind, same run: the monotonic clock gives the true time', a.basis === 'monotonic' && a.t === truth, a);
    const b = resolveTime({ wall: truth, mono: 1_000, run }, { wall: serverNow + 7_200_000, mono: 601_000, run }, serverNow);
    check('clock', 'the clock changed by 2 h between the event and the send: the gaps disagree, so the time is marked estimated (a boot clock would make it exact)', b.basis === 'estimated', b);
    // The phone slept 20 minutes: the monotonic clock (performance.now) did not count them, the wall clock did.
    const slept = resolveTime({ wall: serverNow - 1_800_000, mono: 1_000, run }, { wall: serverNow, mono: 601_000, run }, serverNow);
    check('clock', 'the phone slept 20 min after the event (monotonic gap 10 min, wall gap 30 min): placed by the wall clock, marked estimated, not 20 min late', slept.basis === 'estimated' && slept.t === serverNow - 1_800_000, slept);
    const c = resolveTime({ wall: truth + wrongBy, mono: 1_000, run: 'old' }, { wall: serverNow + wrongBy, mono: 5, run: 'new' }, serverNow);
    check('clock', 'app restarted with the clock 3 h behind: time corrected by the measured offset and marked estimated', c.basis === 'estimated' && c.t === truth, c);
    const e = resolveTime({ wall: truth, mono: 1_000, run: 'old' }, { wall: serverNow + 7_200_000, mono: 5, run: 'new' }, serverNow);
    check('clock', 'restarted and the clock changed in between: the time is wrong but marked estimated (the known limit)', e.basis === 'estimated' && e.t !== truth, e);
    // End to end: a phone 3 h behind sends through the server.
    net.set(PROFILES.lan);
    const d = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock({ skewMs: wrongBy }), log });
    const before = Date.now();
    d.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    await d.syncUntilEmpty();
    const row = q("SELECT t, device_wall, server_time, basis FROM events WHERE driver_id = 'd1' ORDER BY arrival DESC LIMIT 1")[0];
    check('clock', 'the server keeps the device time and the server time, and places the event correctly', row.basis === 'monotonic' && Math.abs(row.t - before) < 2_000 && Math.abs(row.device_wall - (before + wrongBy)) < 2_000 && row.server_time >= before, row);
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    await d.syncUntilEmpty();
    d.close();
  }

  // 8. Late and impossible events are kept and flagged, never applied; the driver sees the outcome.
  {
    net.set(PROFILES.lan);
    const d1 = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock(), log });
    const ja = job('d1');
    d1.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    await d1.syncUntilEmpty();
    const late = d1.outbox.record({ type: 'accepted', jobId: ja }); // offline: not sent yet
    server.reassign(ja, 'd3'); // dispatch gives the job to another driver meanwhile
    await d1.syncUntilEmpty();
    const lateRow = q('SELECT status, reason FROM events WHERE id = ?', late)[0];
    check('sequence', 'an event on a job reassigned meanwhile is kept, flagged "reassigned" and not applied', lateRow.status === 'flagged' && lateRow.reason === 'reassigned' && q('SELECT state, driver_id FROM jobs WHERE id = ?', ja)[0].driver_id === 'd3', lateRow);
    check('sequence', "the flagged event is kept on the driver's phone to show, not dropped", d1.outbox.outcomes().some((o) => o.id === late && o.reason === 'reassigned'), d1.outbox.outcomes());
    const jr = job('d1');
    const lost = d1.outbox.record({ type: 'accepted', jobId: jr });
    server.reassign(jr, 'd3');
    net.patch({ onAnswer: () => { net.patch({ onAnswer: undefined }); return 'drop'; } });
    await d1.syncUntilEmpty();
    const lostOutcome = d1.outbox.outcomes().find((o) => o.id === lost);
    check('sequence', 'a flagged event whose answer was lost: the resend gets "duplicate" with the first outcome, and the phone keeps it', lostOutcome?.status === 'flagged' && lostOutcome.reason === 'reassigned' && q('SELECT COUNT(*) n FROM events WHERE id = ?', lost)[0].n === 1, lostOutcome);
    const jb = job('d1');
    const imp = d1.outbox.record({ type: 'delivered', jobId: jb });
    await d1.syncUntilEmpty();
    const impRow = q('SELECT status, reason FROM events WHERE id = ?', imp)[0];
    check('sequence', '"delivered" on a job never picked up is flagged "impossible_sequence" and not applied', impRow.reason === 'impossible_sequence' && q('SELECT state FROM jobs WHERE id = ?', jb)[0].state === 'offered', impRow);
    const d2 = makeDriver({ file: dbFile(), token: 'tok-d2', url: viaNet, clock: testClock(), log });
    const foreign = d2.outbox.record({ type: 'accepted', jobId: jb });
    await d2.syncUntilEmpty();
    check('sequence', "another restaurant's driver cannot act on the job: rejected", q('SELECT status, reason FROM events WHERE id = ?', foreign)[0].reason === 'not_your_job' && q('SELECT state FROM jobs WHERE id = ?', jb)[0].state === 'offered', null);
    d1.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    await d1.syncUntilEmpty();
    d1.close();
    d2.close();
  }

  // 9. Location only on duty.
  {
    net.set(PROFILES.lan);
    const d = makeDriver({ file: dbFile(), token: 'tok-d2', url: viaNet, clock: testClock({ startWall: Date.now() - 600_000 }), log });
    const r = route(9);
    const before = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd2'")[0].n;
    fixes(d, r.slice(0, 3), 15_000); // a bug or an old cached fix: points before duty_on
    d.clock.advance(1_000);
    d.outbox.record({ type: 'duty_on', fleet: 'fleet-r2' });
    fixes(d, r.slice(3, 6), 15_000);
    d.clock.advance(1_000);
    d.outbox.record({ type: 'duty_off', fleet: 'fleet-r2' });
    fixes(d, r.slice(6, 9), 15_000);
    d.clock.syncTo(Date.now());
    await d.syncUntilEmpty();
    const stored = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd2'")[0].n - before;
    const refused = q("SELECT SUM(n) n FROM refused_points WHERE driver_id = 'd2'")[0].n;
    check('duty', 'points outside a duty session are refused and counted, points inside are stored', stored === 3 && refused === 6, { stored, refused });
    check('duty', 'the app records nothing off duty (policy has no profile)', profileFor({ onDuty: false, activeJob: false }) === null && profileFor({ onDuty: true, activeJob: true }) === POLICY.active, null);
    d.close();
  }

  // 10. Visibility (ADR 0009).
  {
    net.set(PROFILES.lan);
    const d1 = makeDriver({ file: dbFile(), token: 'tok-d1', url: viaNet, clock: testClock(), log });
    const d3 = makeDriver({ file: dbFile(), token: 'tok-d3', url: viaNet, clock: testClock(), log, profile: POLICY.idle });
    const j = job('d1');
    const r = route(6);
    d1.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    d1.outbox.record({ type: 'accepted', jobId: j });
    fixes(d1, r.slice(0, 2), 1_000);
    d1.clock.syncTo(Date.now());
    await d1.syncUntilEmpty();
    const activeView = server.driverJobs('d1').active.find((x) => x.id === j);
    check('visibility', 'an active job shows the customer name, phone, address and total to its driver', activeView?.customer?.phone && activeView.total.minor === 4_500_000, activeView && { ...activeView, customer: '…' });
    check('visibility', 'the customer sees no driver location before pick-up', server.customerTracking(j).visible === false, server.customerTracking(j));
    d1.outbox.record({ type: 'at_restaurant', jobId: j });
    d1.outbox.record({ type: 'picked_up', jobId: j });
    d1.clock.syncTo(Date.now());
    fixes(d1, r.slice(2, 4), 1_000);
    await d1.syncUntilEmpty();
    const during = server.customerTracking(j);
    check('visibility', 'while picked_up the customer sees the driver, only from the pick-up on', during.visible && during.position && during.position.t >= q('SELECT picked_up_at p FROM jobs WHERE id = ?', j)[0].p, during);
    d1.outbox.record({ type: 'delivered', jobId: j });
    await d1.syncUntilEmpty();
    const after = server.driverJobs('d1');
    check('visibility', 'after delivery the driver keeps the job id and state, not the customer details', !after.active.some((x) => x.id === j) && after.past.some((x) => x.id === j && !('customer' in x)), after.past.find((x) => x.id === j));
    check('visibility', 'after delivery the customer sees no location', server.customerTracking(j).visible === false, null);
    // d3 on duty only in the Vertex fleet.
    d3.outbox.record({ type: 'duty_on', fleet: 'fleet-vx' });
    fixes(d3, r.slice(0, 2), 1_000);
    d3.clock.syncTo(Date.now());
    await d3.syncUntilEmpty();
    const r1 = server.dispatchDrivers('fleet-r1');
    const vx = server.dispatchDrivers('fleet-vx');
    check('visibility', "a driver on duty for Vertex only is off duty, without position, for the restaurant's dispatcher", r1.find((x) => x.driver === 'd3')?.onDuty === false && !('position' in r1.find((x) => x.driver === 'd3')), r1);
    check('visibility', "the Vertex dispatcher sees the same driver's position", vx.find((x) => x.driver === 'd3')?.position != null, vx.map((x) => ({ ...x, position: x.position ? '…' : null })));
    check('visibility', "a restaurant's dispatcher sees its on-duty driver's position", r1.find((x) => x.driver === 'd1')?.position != null, r1.map((x) => ({ ...x, position: x.position ? '…' : null })));
    const last = q("SELECT MAX(t) t FROM points WHERE driver_id = 'd3'")[0].t;
    // An idle driver's newest point can be a late fix (145 s gap seen on the emulator) plus a 120 s upload old.
    const idleOk = server.dispatchDrivers('fleet-vx', last + 265_000).find((x) => x.driver === 'd3');
    const stale = server.dispatchDrivers('fleet-vx', last + 310_000).find((x) => x.driver === 'd3');
    check('visibility', 'stale follows the profile: an idle driver (fix 60 s, sent 120 s) with a late fix is fresh at 265 s, stale at 310 s', idleOk.stale === false && stale.stale === true && stale.staleAfterMs === 300_000, { idleOk: idleOk.stale, stale: stale.stale, after: stale.staleAfterMs });
    // d3 now also on duty for restaurant R1, while carrying a Vertex job for restaurant R2's customer.
    const jv = job('d3', 'fleet-vx', 'tenant-r2');
    d3.outbox.record({ type: 'duty_on', fleet: 'fleet-r1' });
    d3.outbox.record({ type: 'accepted', jobId: jv });
    fixes(d3, r.slice(2, 4), 1_000);
    d3.clock.syncTo(Date.now());
    await d3.syncUntilEmpty();
    const r1Busy = server.dispatchDrivers('fleet-r1').find((x) => x.driver === 'd3');
    const vxBusy = server.dispatchDrivers('fleet-vx').find((x) => x.driver === 'd3');
    check('visibility', "on duty in two fleets with a Vertex job for another restaurant: R1's dispatcher sees the driver busy, not where; Vertex sees the position", r1Busy.onDuty && r1Busy.busyElsewhere && !('position' in r1Busy) && vxBusy.position != null, { r1: r1Busy, vx: vxBusy.position ? 'position' : null });
    // The Vertex job ends at R2's customer's door; the last points are from there.
    fixes(d3, r.slice(4, 6), 1_000);
    d3.outbox.record({ type: 'failed', jobId: jv, reason: 'test' });
    d3.clock.syncTo(Date.now());
    await d3.syncUntilEmpty();
    const r1After = server.dispatchDrivers('fleet-r1').find((x) => x.driver === 'd3');
    const doorPoints = q("SELECT t FROM points WHERE driver_id = 'd3' ORDER BY t DESC LIMIT 2").map((x) => x.t);
    check('visibility', "after the Vertex job ends, R1's dispatcher still gets no point taken during it (not the customer's door)", r1After.onDuty && !r1After.busyElsewhere && (r1After.position == null || !doorPoints.includes(r1After.position.t)), { position: r1After.position ? r1After.position.t : null });
    d3.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    d1.outbox.record({ type: 'duty_off', fleet: 'fleet-r1' });
    await d1.syncUntilEmpty();
    check('visibility', 'off duty, the dispatcher sees no position', !('position' in server.dispatchDrivers('fleet-r1').find((x) => x.driver === 'd1')), null);
    const authFail = await fetch(`${viaNet}/dispatch/drivers`, { headers: { authorization: 'Bearer tok-d1' } });
    check('visibility', 'a driver token cannot read the dispatch view', authFail.status === 404 || authFail.status === 403, authFail.status);
    d3.outbox.record({ type: 'duty_off', fleet: 'fleet-vx' });
    await d3.syncUntilEmpty();
    d1.close();
    d3.close();
  }

  // 11. Payload: compact batches.
  {
    const clock = testClock();
    const pts = route(240).map((p, i) => ({ t: clock.wallNow() + i * 15_000, ...p, cbWall: clock.wallNow() + Math.floor(i / 2) * 30_000, cbMono: Math.floor(i / 2) * 30_000 }));
    // The shape expo-location gives, sent as it is.
    const naive = JSON.stringify(pts.map((p) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc, speed: p.speed, heading: p.heading, altitude: 412.3, altitudeAccuracy: 3 }, timestamp: p.t, mocked: false })));
    const compact = JSON.stringify(encodePoints('run', pts));
    const back = decodePoints(JSON.parse(compact));
    const maxErrM = Math.max(...back.map((b, i) => Math.hypot((b.lat - pts[i].lat) * 111_320, (b.lng - pts[i].lng) * 89_000)));
    measures.payload = {
      points: 240,
      naiveBytesPerPoint: Math.round(naive.length / 240),
      compactBytesPerPoint: Math.round((compact.length / 240) * 10) / 10,
      naiveGzipBytesPerPoint: Math.round((gzipSync(naive).length / 240) * 10) / 10,
      compactGzipBytesPerPoint: Math.round((gzipSync(compact).length / 240) * 10) / 10,
      hourOfActiveJobKB: Math.round((compact.length / 1024) * 10) / 10,
      maxPositionErrorM: Math.round(maxErrM * 100) / 100,
    };
    check('payload', 'compact batches decode to the same points within 1 m, times exact', maxErrM < 1 && back.every((b, i) => b.t === pts[i].t && b.cbMono === pts[i].cbMono), measures.payload);
    check('payload', 'compact batches are at least 4 times smaller than the raw location objects', naive.length / compact.length >= 4, measures.payload);
  }

  // 12. Privacy: no coordinate or phone number in any log line or URL.
  {
    const hits = logs.map((l) => [l, sensitiveIn(l)]).filter(([, h]) => h);
    check('privacy', `no coordinate or phone in ${logs.length} server and client log lines`, hits.length === 0, hits.slice(0, 3));
    const urls = [...server.stats.urls, ...net.stats.requestLines];
    check('privacy', `no coordinate or phone in ${urls.length} request URLs; locations travel only in bodies`, urls.every((u) => !sensitiveIn(u)) && urls.length > 0, urls.filter((u) => sensitiveIn(u)).slice(0, 3));
    check('privacy', 'the redaction check catches a coordinate and a phone when present', sensitiveIn('lat=36.58712') === 'coordinate' && sensitiveIn('call +963-000-000-001') === 'phone', null);
  }

  measures.energy = model();
} finally {
  if (process.env.DEBUG) console.log(q("SELECT driver_id, fleet_id, on_at, off_at FROM duty"), q("SELECT driver_id, type, fleet_id, status, reason, basis, t FROM events WHERE type LIKE 'duty%' ORDER BY arrival"));
  await net.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ node: process.version, results, measures }, null, 2));
console.log(JSON.stringify(measures, null, 2));
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
