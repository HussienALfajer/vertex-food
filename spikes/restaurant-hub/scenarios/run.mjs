// Spike A scenarios: two restaurant PCs (hub and standby), a waiter phone and a kitchen display on the LAN.
// Needs: docker compose up -d, and the API (`pnpm server`). Run: `pnpm scenarios` or `pnpm scenarios:electron`.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { v7 as uuidv7 } from 'uuid';
import { IDS, BUSINESS_DAY, CURRENCY } from '../server/seed.mjs';
import { createBranchCa, issueHubCert, selfSignedCert, fingerprint } from '../pc/tls.mjs';
import { lanFetch } from '../pc/lan-http.mjs';
import { pair, createHubClient } from '../clients/hub-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const runtime = process.argv.includes('--runtime') ? process.argv[process.argv.indexOf('--runtime') + 1] : 'node';
const label = runtime;
const API = 'http://127.0.0.1:6070';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(route, body) {
  const r = await fetch(`${API}${route}`, body === undefined && route.startsWith('/api/spike/stats')
    ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return r.json();
}
const sql = (q, params) => api('/api/spike/sql', { sql: q, params });

async function waitFor(fn, { timeout = 20000, every = 100, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return { value, ms: Date.now() - start };
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

// --- Restaurant PCs as child processes ---------------------------------------------------------------
const dataDir = path.join(root, '.data', `run-${label}`);
const outDir = path.join(root, 'out', label);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
const exec = runtime === 'electron' ? require('electron') : process.execPath;
const entry = runtime === 'electron' ? path.join(root, 'electron', 'pc-main.mjs') : path.join(root, 'pc', 'pc.mjs');

function startPc(pc) {
  const logFd = fs.openSync(path.join(outDir, `${pc.cfg.name}.log`), 'a');
  const child = spawn(exec, [entry], { env: { ...process.env, PC_CONFIG: pc.cfgPath }, stdio: ['ignore', 'pipe', logFd] });
  pc.child = child;
  pc.exited = new Promise((resolve) => child.on('exit', resolve));
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${pc.cfg.name} did not start`)), 60000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`${pc.cfg.name} exited ${code}`)));
  });
}

function makePc(name, deviceId, lanPort, ctlPort, preferredRole, ca, peerSecret) {
  const cert = issueHubCert(ca, name);
  const cfg = {
    name, deviceId, tenantId: IDS.tenantA, branchId: IDS.branchA, dir: dataDir, hexKey: crypto.randomBytes(32).toString('hex'),
    lanPort, ctlPort, apiPort: 6070, syncPort: 8095, preferredRole, businessDay: BUSINESS_DAY, currency: CURRENCY,
    caPem: ca.certPem, certPem: cert.certPem, keyPem: cert.keyPem, peerSecret, cashierUserId: IDS.cashier, peers: [],
  };
  const cfgPath = path.join(dataDir, `${name}.json`);
  const pc = {
    cfg, cfgPath, url: `https://127.0.0.1:${lanPort}`,
    async ctl(route, body) {
      const r = await fetch(`http://127.0.0.1:${ctlPort}${route}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.json();
    },
    status() { return this.ctl('/ctl/status'); },
    sql(q, params) { return this.ctl('/ctl/sql', { sql: q, params }); },
    internet(online) { return this.ctl('/ctl/internet', { online }); },
    lan(online) { return this.ctl('/ctl/lan', { online }); },
    submit(commands) { return this.ctl('/ctl/submit', { commands }); },
    start() { return startPc(this); },
    kill() { this.child.kill('SIGKILL'); return this.exited; },
    save() { fs.writeFileSync(cfgPath, JSON.stringify(cfg)); },
  };
  return pc;
}

const cmd = (type, payload, userId = IDS.cashier) => ({ id: uuidv7(), type, payload, user_id: userId, device_time: new Date().toISOString() });

// --- Run --------------------------------------------------------------------------------------------
const results = [];
const timings = {};
const check = (scenario, name, ok, detail) => {
  results.push({ scenario, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
};
const run = async (scenario, fn) => {
  const t = Date.now();
  try {
    await fn();
  } catch (e) {
    check(scenario, 'scenario ran to the end', false, String(e?.stack ?? e));
  }
  timings[`scenario:${scenario}`] = Date.now() - t;
};

await api('/api/spike/reset');
const ca = createBranchCa('Vertex Food branch CA (spike, synthetic branch A)');
const peerSecret = crypto.randomBytes(24).toString('hex');
const pc1 = makePc('cashier-1', IDS.pc1, 7443, 7543, 'hub', ca, peerSecret);
const pc2 = makePc('cashier-2', IDS.pc2, 7444, 7544, 'standby', ca, peerSecret);
pc1.cfg.peers = [{ name: pc2.cfg.name, deviceId: pc2.cfg.deviceId, url: pc2.url }];
pc2.cfg.peers = [{ name: pc1.cfg.name, deviceId: pc1.cfg.deviceId, url: pc1.url }];
pc1.save();
pc2.save();

let waiter;
let waiterToken;
let kds;
const o1 = uuidv7();
const o2 = uuidv7();
const o3 = uuidv7();
const o4 = uuidv7();
const o5 = uuidv7();
const SUBTOTAL_O1 = 2 * 3500000 + 1500000 + 1200000;
const ticketsOf = (snap, orderId) => snap?.orders.find((o) => o.id === orderId)?.tickets ?? [];
const orderOf = (snap, orderId) => snap?.orders.find((o) => o.id === orderId);

// Normalized order state, to compare a PC with the server.
const ORDER_STATE_SQL = {
  orders: 'SELECT id, number, channel, status, subtotal_minor, paid_minor FROM orders ORDER BY id',
  lines: 'SELECT id, order_id, price_id, unit_minor, quantity, line_minor, ticket_id FROM order_lines ORDER BY id',
  tickets: 'SELECT id, order_id, order_number, station, status FROM kitchen_tickets ORDER BY id',
  payments: 'SELECT id, order_id, amount_minor, currency FROM payments ORDER BY id',
};
async function stateOf(source) {
  const out = {};
  for (const [k, q] of Object.entries(ORDER_STATE_SQL)) {
    const rows = await source(q);
    out[k] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v])));
  }
  return JSON.stringify(out);
}
const serverState = () => stateOf((q) => sql(q.replace('FROM orders', "FROM orders WHERE channel <> 'marketplace'").replace('FROM order_lines', "FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE channel <> 'marketplace')").replace('FROM kitchen_tickets', "FROM kitchen_tickets WHERE order_id IN (SELECT id FROM orders WHERE channel <> 'marketplace')")));
const pcState = (pc) => stateOf((q) => pc.sql(q.replace('FROM orders', "FROM orders WHERE channel <> 'marketplace'").replace('FROM order_lines', "FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE channel <> 'marketplace')").replace('FROM kitchen_tickets', "FROM kitchen_tickets WHERE order_id IN (SELECT id FROM orders WHERE channel <> 'marketplace')")));
// The hub and the standby agree and the standby is not in the middle of a rejoin.
const inSync = async () => {
  const [a, b] = [await pc1.status(), await pc2.status()];
  const hub = a.role === 'hub' ? a : b;
  const standby = a.role === 'hub' ? b : a;
  return hub.role === 'hub' && standby.role === 'standby' && !standby.rejoin_pending && hub.applied_seq === standby.applied_seq && hub.peers[standby.device_id]?.reachable;
};
const journalIds = async (pc) => (await pc.sql('SELECT id FROM hub_journal WHERE forked = 0 ORDER BY seq')).map((r) => r.id);

await run('setup', async () => {
  let t = Date.now();
  await pc1.start();
  timings.start_pc1 = Date.now() - t;
  t = Date.now();
  await pc2.start();
  timings.start_pc2 = Date.now() - t;
  const ready = async (pc) => {
    const s = await pc.status();
    const menu = await pc.sql('SELECT count(*) AS n FROM menu_items');
    return s.has_synced && s.range && menu[0].n === 4 && s;
  };
  const r1 = await waitFor(() => ready(pc1), { label: 'pc1 synced' });
  const r2 = await waitFor(() => ready(pc2), { label: 'pc2 synced' });
  timings.first_sync_both = Date.now() - t;
  timings.pc_runtime = r1.value.runtime;
  check('setup', 'both PCs synced the branch menu and hold a daily number range', true, { pc1: r1.value.range, pc2: r2.value.range, runtime: r1.value.runtime });
  const [a, b] = [r1.value.range, r2.value.range];
  check('setup', 'the two ranges are 500 numbers each and do not overlap', a.last_number - a.first_number === 499 && b.last_number - b.first_number === 499 && (a.last_number < b.first_number || b.last_number < a.first_number), { a, b });
  const other = await pc1.sql('SELECT count(*) AS n FROM menu_items WHERE tenant_id = ?', [IDS.tenantB]);
  check('setup', "a PC holds no row of another tenant's menu", other[0].n === 0, other);
  await waitFor(async () => {
    const [s1, s2] = [await pc1.status(), await pc2.status()];
    return s1.peers[IDS.pc2]?.role === 'standby' && s1.peers[IDS.pc2]?.reachable && s2.hub_device_id === IDS.pc1 && s2.epoch === 1;
  }, { label: 'standby follows hub' });
  check('setup', 'cashier-2 follows cashier-1 as its standby (epoch 1)', true);
});

await run('pairing', async () => {
  await pc1.internet(false);
  await pc2.internet(false);
  await waitFor(async () => !(await pc1.status()).connected && !(await pc2.status()).connected, { label: 'PCs offline' });
  check('pairing', 'both PCs lost the internet (sync and API unreachable)', true);
  const caFingerprint = fingerprint(ca.certPem);
  const openPairing = async () => (await pc1.ctl('/ctl/open-pairing', {})).code;
  const closed = await pair({ url: pc1.url, caFingerprint, code: '123456', kind: 'waiter', name: 'probe' }).catch((e) => e.status);
  check('pairing', 'pairing is closed until a manager opens it on the hub (403)', closed === 403 && (await pc1.status()).pairing_code === null, closed);
  const code = await openPairing();
  const wrongCa = await pair({ url: pc1.url, caFingerprint: fingerprint(selfSignedCert('x').certPem), code, kind: 'waiter', name: 'waiter-1' }).catch((e) => e.code);
  check('pairing', 'pairing refuses a hub whose CA does not match the fingerprint in the QR code', wrongCa === 'ca_fingerprint_mismatch', wrongCa);
  const wrong = code === '000000' ? '111111' : '000000';
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await pair({ url: pc1.url, caFingerprint, code: wrong, kind: 'waiter', name: 'guess' }).catch((e) => e.status));
  const afterGuesses = await pair({ url: pc1.url, caFingerprint, code, kind: 'waiter', name: 'waiter-1' }).catch((e) => e.status);
  check('pairing', 'five wrong codes close pairing: even the right code is then refused', tries.every((s) => s === 403) && afterGuesses === 403, { tries, afterGuesses });
  let t = Date.now();
  const code1 = await openPairing();
  const w = await pair({ url: pc1.url, caFingerprint, code: code1, kind: 'waiter', name: 'waiter-1' });
  timings.pair_waiter = Date.now() - t;
  const reuse = await pair({ url: pc1.url, caFingerprint, code: code1, kind: 'kitchen', name: 'kds-grill' }).catch((e) => e.status);
  check('pairing', 'the pairing code is single-use', reuse === 403, reuse);
  const k = await pair({ url: pc1.url, caFingerprint, code: await openPairing(), kind: 'kitchen', name: 'kds-grill' });
  check('pairing', 'a waiter phone and a kitchen display pair with the hub while the internet is down', Boolean(w.token && k.token), { peers: w.peers.map((p) => p.name) });
  check('pairing', 'pairing returns both hub-capable PCs and was mirrored to the standby', w.peers.length === 2 && w.mirrored && k.mirrored, { mirrored: [w.mirrored, k.mirrored] });
  const onStandby = await pc2.sql('SELECT count(*) AS n FROM hub_clients');
  check('pairing', 'the standby holds both pairings, so clients need no second pairing to use it', onStandby[0].n === 2, onStandby);
  waiter = createHubClient({ ...w, name: 'waiter-1', userId: IDS.waiter });
  waiterToken = w.token;
  kds = createHubClient({ ...k, name: 'kds', userId: IDS.cook });

  // A rogue PC on the LAN with a certificate the branch CA did not sign.
  const rogueCert = selfSignedCert('rogue');
  const rogue = https.createServer({ cert: rogueCert.certPem, key: rogueCert.keyPem }, (req, res) => res.end('{}'));
  await new Promise((r) => rogue.listen(0, '127.0.0.1', r));
  const rogueErr = await lanFetch(`https://127.0.0.1:${rogue.address().port}/hub/hello`, { ca: w.caPem }).then(() => null, (e) => e.code);
  rogue.close();
  check('pairing', 'a paired client refuses a LAN server whose certificate the branch CA did not sign', Boolean(rogueErr), rogueErr);
  const unauth = await lanFetch(`${pc1.url}/hub/commands`, { ca: w.caPem, method: 'POST', body: { commands: [] } });
  check('pairing', 'the hub refuses commands from an unpaired client (401)', unauth.status === 401, unauth.status);
  const toStandby = await lanFetch(`${pc2.url}/hub/commands`, { ca: w.caPem, method: 'POST', body: { commands: [] }, headers: { authorization: `Bearer ${w.token}` } });
  check('pairing', 'the standby refuses client commands while a hub is active (409 not_hub)', toStandby.status === 409, toStandby.body);
});

await run('lan-order-offline', async () => {
  // A price change in the cloud that the offline branch cannot see.
  await api('/api/spike/price', { item_id: IDS.itemShawarma, amount_minor: 4000000, currency: CURRENCY });
  waiter.subscribe();
  kds.subscribe();
  await kds.waitFor((s) => s.kind === 'snapshot', { label: 'kds first snapshot' });
  const lines = [{ line_id: uuidv7(), item_id: IDS.itemShawarma, quantity: 2 }, { line_id: uuidv7(), item_id: IDS.itemJuice, quantity: 1 }];
  const t0 = Date.now();
  const sent = await waiter.send([
    waiter.command('OpenOrder', { order_id: o1, channel: 'waiter', table_id: IDS.tables[0] }),
    waiter.command('AddLines', { order_id: o1, lines }),
    waiter.command('SendToKitchen', { order_id: o1 }),
  ]);
  timings.waiter_send_3_commands = sent.ms;
  check('lan-order-offline', 'the waiter opens table T1, adds lines and sends to the kitchen through the hub, offline', sent.results.every((r) => r.status === 'applied'), sent.results.map((r) => r.status));
  check('lan-order-offline', 'each command was on the standby before the waiter got the answer (mirror first)', sent.results.every((r) => r.mirrored), sent.results.map((r) => r.mirrored));
  const seen = await kds.waitFor((s) => ticketsOf(s, o1).length === 2, { label: 'kds tickets o1' });
  timings.waiter_to_kds_ms = seen.at - t0;
  check('lan-order-offline', 'the kitchen display shows the two station tickets (grill, juice)', true, { ms: seen.at - t0 });

  const c1 = await pc1.submit([cmd('AddLines', { order_id: o1, lines: [{ line_id: uuidv7(), item_id: IDS.itemFries, quantity: 1 }] }), cmd('SendToKitchen', { order_id: o1 })]);
  check('lan-order-offline', 'the cashier adds a line to the same order on the hub PC', c1.results.every((r) => r.status === 'applied'), c1.results.map((r) => r.status));
  await kds.waitFor((s) => ticketsOf(s, o1).length === 3, { label: 'kds third ticket' });
  const grill = ticketsOf(kds.snapshot, o1).find((t) => t.station === 'grill');
  await kds.send([kds.command('SetTicketStatus', { ticket_id: grill.id, status: 'preparing' })]);
  const t1 = Date.now();
  await kds.send([kds.command('SetTicketStatus', { ticket_id: grill.id, status: 'ready' })]);
  const ready = await waiter.waitFor((s) => ticketsOf(s, o1).find((t) => t.id === grill.id)?.status === 'ready', { label: 'waiter sees ready' });
  timings.kds_to_waiter_ms = ready.at - t1;
  check('lan-order-offline', 'the kitchen marks the grill ticket ready and the waiter sees it', true, { ms: ready.at - t1 });
  const back = await kds.send([kds.command('SetTicketStatus', { ticket_id: grill.id, status: 'preparing' })]);
  check('lan-order-offline', 'the hub refuses a backward ticket status locally', back.results[0].status === 'refused', back.results[0]);

  const local = orderOf(waiter.snapshot, o1);
  check('lan-order-offline', 'the hub computed the subtotal from the prices it holds (the old shawarma price)', local.subtotal_minor === SUBTOTAL_O1, { subtotal: local.subtotal_minor, expected: SUBTOTAL_O1 });
  const pay = await pc1.submit([cmd('TakePayment', { payment_id: uuidv7(), order_id: o1, amount_minor: local.subtotal_minor, method: 'cash' })]);
  check('lan-order-offline', 'the cashier takes a cash payment offline and the order is paid locally', pay.results[0].status === 'applied' && (await pc1.sql('SELECT status FROM orders WHERE id = ?', [o1]))[0].status === 'paid', pay.results[0].status);
  const [s1, s2] = [await pc1.status(), await pc2.status()];
  check('lan-order-offline', 'both PCs hold the same commands in their upload queues', s1.pending_uploads > 0 && s1.pending_uploads === s2.pending_uploads, { pc1: s1.pending_uploads, pc2: s2.pending_uploads });
  const [j1, j2] = [await journalIds(pc1), await journalIds(pc2)];
  check('lan-order-offline', 'the standby journal equals the hub journal, in the same order', JSON.stringify(j1) === JSON.stringify(j2), { pc1: j1.length, pc2: j2.length });
});

await run('replay', async () => {
  const t = Date.now();
  await pc1.internet(true);
  await pc2.internet(true);
  await waitFor(async () => (await pc1.status()).pending_uploads === 0 && (await pc2.status()).pending_uploads === 0, { label: 'queues empty', timeout: 30000 });
  timings.replay_queues_empty_ms = Date.now() - t;
  const [order] = await sql('SELECT number, status, subtotal_minor, paid_minor FROM orders WHERE id = $1', [o1]);
  check('replay', 'the server re-executed the order: paid, with the subtotal it recomputed from the line snapshots', order?.status === 'paid' && Number(order.subtotal_minor) === SUBTOTAL_O1 && Number(order.paid_minor) === SUBTOTAL_O1, order);
  const events = await sql('SELECT command_id, type FROM order_events WHERE order_id = $1 ORDER BY seq', [o1]);
  const j1 = await journalIds(pc1);
  const eventIds = events.map((e) => e.command_id);
  const inJournalOrder = j1.filter((id) => eventIds.includes(id));
  check('replay', "the server's order events follow the hub's order (waiter and cashier commands interleaved)", JSON.stringify(eventIds) === JSON.stringify(inJournalOrder) && events.length === 8, events.map((e) => e.type));
  const log = await sql("SELECT type, outcome, outcome_detail FROM command_log WHERE type <> 'HubClientPaired' ORDER BY hub_seq");
  check('replay', 'every command was accepted', log.length === 8 && log.every((l) => l.outcome === 'accepted'), log.map((l) => `${l.type}:${l.outcome}`));
  const waiterLines = log.find((l) => l.type === 'AddLines');
  check('replay', 'the server kept the price the branch used and reported the newer cloud price it could not see', waiterLines?.outcome_detail?.price_superseded?.length === 1, waiterLines?.outcome_detail);
  const stats = await api('/api/spike/stats');
  check('replay', 'both PCs uploaded every command; the second upload of each was a replay with the same payload', stats.executed === 8 && stats.replays === 8 && stats.replayMismatches === 0, stats);
  const srv = await serverState();
  const conv = await waitFor(async () => (await pcState(pc1)) === srv && (await pcState(pc2)) === srv, { label: 'PCs converge with server', timeout: 15000 });
  timings.replay_converged_ms = Date.now() - t;
  check('replay', 'both PCs converge to the server state (orders, lines, tickets, payments)', conv.value, {});
  // Equal rows can come before the checkpoint (the optimistic rows already matched), so wait for the outcomes themselves.
  const outcomes = await waitFor(async () => (await pc2.sql('SELECT count(*) AS n FROM command_log'))[0].n === 8, { label: 'outcomes on standby', timeout: 15000 }).catch((e) => ({ error: String(e) }));
  timings.replay_outcomes_on_standby_ms = Date.now() - t;
  check('replay', 'the outcomes reached the standby too', outcomes.value, outcomes);
});

await run('cloud-order', async () => {
  const t = Date.now();
  const created = await api('/api/cloud/order', { tenant_id: IDS.tenantA, branch_id: IDS.branchA, business_day: BUSINESS_DAY, item_id: IDS.itemBurger });
  const seen = await kds.waitFor((s) => ticketsOf(s, created.order_id).length === 1, { label: 'cloud ticket on kds', timeout: 15000 });
  timings.cloud_order_to_kds_ms = seen.at - t;
  check('cloud-order', 'an order created in the cloud reaches the kitchen display through the hub', true, { ms: seen.at - t });
});

await run('crash-after-mirror', async () => {
  // The hub copies a command to the standby, then loses power before committing it or answering.
  await pc1.internet(false);
  await pc2.internet(false);
  await waitFor(inSync, { label: 'standby in sync' });
  await pc2.ctl('/ctl/fault', { takeoverMs: 15000 }); // this scenario is about a quick restart, not a takeover
  await pc1.ctl('/ctl/fault', { crashAfterMirror: true });
  const o0 = uuidv7();
  const c = waiter.command('OpenOrder', { order_id: o0, channel: 'waiter', table_id: IDS.tables[0] });
  const pending = waiter.send([c], { timeout: 20000 });
  await pc1.exited;
  const onStandby = await pc2.sql('SELECT entry FROM hub_journal WHERE id = ?', [c.id]);
  check('crash-after-mirror', 'the hub died after the standby received the command and before it answered', onStandby.length === 1, {});
  const t = Date.now();
  await pc1.start(); // back within the 3 s takeover delay
  const answer = await pending;
  timings.crash_after_mirror_answer_ms = Date.now() - t;
  const s1 = await pc1.status();
  const s2 = await pc2.status();
  check('crash-after-mirror', 'the restarted hub recovers the command from the standby and stays hub (epoch 1)', s1.role === 'hub' && s1.epoch === 1 && s1.stats.recoveredFromStandby === 1 && s2.role === 'standby', { recovered: s1.stats.recoveredFromStandby, roles: [s1.role, s2.role] });
  check('crash-after-mirror', "the waiter's retry is answered as a duplicate: one version, resolved once", answer.results[0].status === 'duplicate', answer.results[0]);
  const [n1, n2] = [await pc1.sql('SELECT number FROM orders WHERE id = ?', [o0]), await pc2.sql('SELECT number FROM orders WHERE id = ?', [o0])];
  check('crash-after-mirror', 'both PCs hold the order once, with the same number', n1.length === 1 && n2.length === 1 && n1[0].number === n2[0].number, { n1, n2 });
  await pc2.ctl('/ctl/fault', { takeoverMs: 3000 });
});

await run('failover', async () => {
  await pc1.internet(false);
  await pc2.internet(false);
  const opened = await waiter.send([waiter.command('OpenOrder', { order_id: o2, channel: 'waiter', table_id: IDS.tables[1] })]);
  check('failover', 'the waiter opens table T2 on the hub, offline, with a standby copy', opened.results[0].status === 'applied' && opened.results[0].mirrored, opened.results[0]);
  await waitFor(async () => (await pc1.status()).applied_seq === (await pc2.status()).applied_seq, { label: 'standby in sync before the cut' });
  const acked = [];
  let killedAt = 0;
  let firstAfterKill = null;
  const killer = (async () => {
    await sleep(400);
    killedAt = Date.now();
    await pc1.kill(); // power cut on the hub PC, in the middle of a stream of writes
  })();
  const burstStart = Date.now();
  while (Date.now() - burstStart < 25000 && (killedAt === 0 || acked.filter((a) => a.at > killedAt).length < 20)) {
    const c = waiter.command('AddLines', { order_id: o2, lines: [{ line_id: uuidv7(), item_id: IDS.itemBurger, quantity: 1 }] });
    const r = await waiter.send([c], { timeout: 20000 });
    const res = r.results[0];
    acked.push({ id: c.id, line: c.payload.lines[0].line_id, hub: r.hub, status: res.status, at: Date.now() });
    if (killedAt && !firstAfterKill && r.hub === pc2.cfg.name) firstAfterKill = Date.now();
  }
  await killer;
  timings.failover_gap_ms = firstAfterKill - killedAt;
  timings.failover_burst_before_kill = acked.filter((a) => a.at <= killedAt).length;
  const s2 = await pc2.status();
  check('failover', 'cashier-2 took over as hub (epoch 2) after the hub PC lost power', s2.role === 'hub' && s2.epoch === 2, { role: s2.role, epoch: s2.epoch, gap_ms: firstAfterKill - killedAt });
  check('failover', 'the waiter kept working through the takeover, retrying the same command ids', waiter.failovers >= 1 && acked.every((a) => a.status === 'applied' || a.status === 'duplicate'), { failovers: waiter.failovers, statuses: [...new Set(acked.map((a) => a.status))] });
  const j2 = new Set(await journalIds(pc2));
  const lost = acked.filter((a) => !j2.has(a.id));
  check('failover', 'no acknowledged command is missing on the new hub', lost.length === 0, { acked: acked.length, lost });
  const lines2 = await pc2.sql('SELECT id FROM order_lines WHERE order_id = ?', [o2]);
  const ackedLines = new Set(acked.map((a) => a.line));
  check('failover', 'each acknowledged line is on the order exactly once (no duplicate after the retry)', lines2.length === ackedLines.size && lines2.every((l) => ackedLines.has(l.id)), { lines: lines2.length, acked: ackedLines.size });

  const sent = await waiter.send([waiter.command('SendToKitchen', { order_id: o2 })]);
  const seen = await kds.waitFor((s) => s.hub === IDS.pc2 && ticketsOf(s, o2).length === 1, { label: 'kds on new hub', timeout: 15000 });
  check('failover', 'the kitchen display moved to the new hub and shows the ticket sent after the takeover', sent.results[0].status === 'applied' && kds.failovers >= 1, { kds_failovers: kds.failovers, lines: ticketsOf(seen.snap, o2).length });
  const o3open = await waiter.send([
    waiter.command('OpenOrder', { order_id: o3, channel: 'waiter', table_id: IDS.tables[2] }),
    waiter.command('AddLines', { order_id: o3, lines: [{ line_id: uuidv7(), item_id: IDS.itemShawarma, quantity: 1 }] }),
    waiter.command('SendToKitchen', { order_id: o3 }),
  ]);
  const range2 = s2.range;
  const n3 = o3open.results[0].payload?.number;
  check('failover', "a new order on the new hub takes its number from cashier-2's own range", n3 >= range2.first_number && n3 <= range2.last_number, { number: n3, range2 });
  check('failover', 'with no standby running, the new hub still answers, reporting the commands as not mirrored', o3open.results.every((r) => r.status === 'applied' && r.mirrored === false), o3open.results.map((r) => r.mirrored));

  const t = Date.now();
  await pc1.start(); // power back: the PC reopens its encrypted database
  timings.restart_pc1_ms = Date.now() - t;
  const integrity = await pc1.sql('PRAGMA integrity_check');
  check('failover', 'after the power cut the encrypted database reopens and passes integrity_check', integrity[0]?.integrity_check === 'ok', integrity);
  const back = await waitFor(async () => {
    const [a, b] = [await pc1.status(), await pc2.status()];
    return a.role === 'standby' && a.epoch === 2 && a.applied_seq === b.applied_seq && { a, b };
  }, { label: 'pc1 rejoins as standby' });
  check('failover', 'the old hub sees the higher epoch, becomes the standby and catches up', true, { applied: back.value.a.applied_seq, rejoin: back.value.a.stats.lastRejoin });
  const forked = await pc1.sql('SELECT count(*) AS n FROM hub_journal WHERE forked = 1');
  check('failover', 'the old hub held nothing the new hub lacked (nothing to forward, thanks to mirror first)', forked[0].n === 0 && back.value.a.stats.lastRejoin?.forwarded === 0, forked);
  // Atomicity: every journal entry has its rows and every row has its journal entry.
  const orphanLines = await pc1.sql(
    `SELECT count(*) AS n FROM order_lines l WHERE l.order_id = ? AND NOT EXISTS
       (SELECT 1 FROM hub_journal j, json_each(json_extract(j.entry, '$.payload.lines')) x WHERE j.type = 'AddLines' AND json_extract(x.value, '$.line_id') = l.id)`, [o2]);
  const missingLines = await pc1.sql(
    `SELECT count(*) AS n FROM hub_journal j, json_each(json_extract(j.entry, '$.payload.lines')) x
      WHERE j.type = 'AddLines' AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.id = json_extract(x.value, '$.line_id'))`);
  check('failover', 'on the restarted PC every journal entry has its rows and every row has its entry (no half-written command)', orphanLines[0].n === 0 && missingLines[0].n === 0, { orphanLines, missingLines });
  const [j1b, j2b] = [await journalIds(pc1), await journalIds(pc2)];
  check('failover', 'both journals are identical again', JSON.stringify(j1b) === JSON.stringify(j2b), { pc1: j1b.length, pc2: j2b.length });
});

await run('split-brain', async () => {
  // The hub (cashier-2) is cut from the LAN but keeps running: its own cashier screen goes on working.
  const t = Date.now();
  await pc2.lan(false);
  const promoted = await waitFor(async () => {
    const s = await pc1.status();
    return s.role === 'hub' && s.epoch === 3 && s;
  }, { label: 'pc1 promotes', timeout: 15000 });
  timings.split_promotion_ms = Date.now() - t;
  check('split-brain', 'cashier-1 stops hearing the hub and promotes itself (epoch 3)', true, { ms: Date.now() - t });
  const s2 = await pc2.status();
  check('split-brain', 'the isolated PC still believes it is the hub (two hubs for a while)', s2.role === 'hub' && s2.epoch === 2, { role: s2.role, epoch: s2.epoch });
  const o3total = (await pc1.sql('SELECT subtotal_minor FROM orders WHERE id = ?', [o3]))[0].subtotal_minor;
  const wpay = await waiter.send([
    waiter.command('TakePayment', { payment_id: uuidv7(), order_id: o3, amount_minor: o3total, method: 'cash' }),
    waiter.command('OpenOrder', { order_id: o5, channel: 'waiter', table_id: IDS.tables[3] }),
  ]);
  check('split-brain', 'the waiter fails over to cashier-1, takes payment for T3 and opens T4', wpay.hub === pc1.cfg.name && wpay.results.every((r) => r.status === 'applied'), { hub: wpay.hub, results: wpay.results.map((r) => r.status) });
  const isolated = await pc2.submit([
    cmd('TakePayment', { payment_id: uuidv7(), order_id: o3, amount_minor: o3total, method: 'cash' }),
    cmd('OpenOrder', { order_id: o4, channel: 'pos', table_id: null }),
    cmd('AddLines', { order_id: o4, lines: [{ line_id: uuidv7(), item_id: IDS.itemJuice, quantity: 2 }] }),
    cmd('SendToKitchen', { order_id: o4 }),
  ]);
  check('split-brain', 'meanwhile the isolated PC takes the same payment again and a takeaway order', isolated.results.every((r) => r.status === 'applied' && !r.mirrored), isolated.results.map((r) => `${r.status}:${r.mirrored}`));
  const nums = { o5: wpay.results[1].payload.number, o4: isolated.results[1].payload.number };
  check('split-brain', 'the two hubs number orders from different ranges (no duplicate number)', nums.o4 !== nums.o5, nums);

  const t2 = Date.now();
  const rejoinsBefore = s2.stats.rejoins ?? 0;
  const forwardedBefore = s2.stats.forwarded;
  await pc2.ctl('/ctl/fault', { failRejoinForwardOnce: true }); // the first rejoin is cut short before it forwards
  await pc2.lan(true);
  const rejoined = await waitFor(async () => {
    const [a, b] = [await pc1.status(), await pc2.status()];
    return b.role === 'standby' && b.epoch === 3 && (b.stats.rejoins ?? 0) > rejoinsBefore && a.applied_seq === b.applied_seq && { a, b };
  }, { label: 'pc2 demotes and rejoins', timeout: 15000 });
  timings.split_heal_ms = Date.now() - t2;
  check('split-brain', 'when the LAN returns, the lower epoch demotes itself and forwards the 4 commands it took alone', rejoined.value.b.stats.forwarded - forwardedBefore === 4, { forwarded: rejoined.value.b.stats.forwarded - forwardedBefore, rejoins: rejoined.value.b.stats.rejoins - rejoinsBefore });
  check('split-brain', 'a rejoin cut short before forwarding stays pending and resumes on the next heartbeat', rejoined.value.b.stats.rejoinFailures === 1 && !rejoined.value.b.rejoin_pending, { failures: rejoined.value.b.stats.rejoinFailures, pending: rejoined.value.b.rejoin_pending });
  const seen = await kds.waitFor((s) => ticketsOf(s, o4).length === 1, { label: 'kds sees forwarded ticket', timeout: 10000 });
  check('split-brain', "the kitchen display shows the isolated PC's takeaway ticket after the heal", Boolean(seen), {});
  const [j1, j2] = [await journalIds(pc1), await journalIds(pc2)];
  check('split-brain', 'both journals hold the union, in the same order', JSON.stringify(j1) === JSON.stringify(j2), { pc1: j1.length, pc2: j2.length });
  const pays = await pc1.sql('SELECT count(*) AS n FROM payments WHERE order_id = ?', [o3]);
  check('split-brain', 'both payments of T3 are kept locally (a payment is never lost)', pays[0].n === 2, pays);

  const t3 = Date.now();
  await pc1.internet(true);
  await pc2.internet(true);
  await waitFor(async () => (await pc1.status()).pending_uploads === 0 && (await pc2.status()).pending_uploads === 0, { label: 'queues empty', timeout: 30000 });
  timings.split_replay_ms = Date.now() - t3;
  // Whichever upload the server ran second is the overpayment (received_at is the transaction start, not the order of execution).
  const payLog = await sql("SELECT outcome, outcome_detail FROM command_log WHERE type = 'TakePayment' AND payload->>'order_id' = $1", [o3]);
  const outcomes = payLog.map((p) => `${p.outcome}:${p.outcome_detail.reason ?? ''}`).sort();
  check('split-brain', 'the server records both payments; one is adjusted as an overpayment for a person to resolve', JSON.stringify(outcomes) === JSON.stringify(['accepted:', 'adjusted:overpaid']), outcomes);
  const dup = await sql("SELECT count(*)::int AS n FROM command_log WHERE outcome_detail->>'reason' = 'number_taken'");
  const numbers = await sql("SELECT number FROM orders WHERE channel <> 'marketplace' ORDER BY number");
  check('split-brain', 'no order lost its number on the server', dup[0].n === 0 && numbers.every((r) => r.number !== null), numbers.map((r) => r.number));
  const rejected = await sql("SELECT type, outcome_detail FROM command_log WHERE outcome = 'rejected'");
  check('split-brain', 'no command was rejected', rejected.length === 0, rejected);
  const stats = await api('/api/spike/stats');
  check('split-brain', 'no replay carried a different payload for the same command id', stats.replayMismatches === 0, stats);
  const srv = await serverState();
  await waitFor(async () => (await pcState(pc1)) === srv && (await pcState(pc2)) === srv, { label: 'converge', timeout: 20000 });
  check('split-brain', 'both PCs converge to the server state', true, {});
});

await run('isolated-standby', async () => {
  // Now the standby (cashier-2) is the PC cut from the LAN: it cannot tell, and promotes itself to a higher epoch.
  await pc1.internet(false);
  await pc2.internet(false);
  const pc1Before = (await pc1.status()).stats;
  const before = pc1Before.rejoins ?? 0;
  await pc2.lan(false);
  const o7 = uuidv7();
  const sent = await waiter.send([
    waiter.command('OpenOrder', { order_id: o7, channel: 'waiter', table_id: IDS.tables[1] }),
    waiter.command('AddLines', { order_id: o7, lines: [{ line_id: uuidv7(), item_id: IDS.itemBurger, quantity: 2 }] }),
    waiter.command('SendToKitchen', { order_id: o7 }),
  ]);
  check('isolated-standby', 'the hub that serves the branch keeps taking orders, reported as not mirrored', sent.hub === pc1.cfg.name && sent.results.every((r) => r.status === 'applied' && !r.mirrored), sent.results.map((r) => `${r.status}:${r.mirrored}`));
  const promoted = await waitFor(async () => {
    const s = await pc2.status();
    return s.role === 'hub' && s.epoch === 4 && s;
  }, { label: 'isolated standby promotes', timeout: 15000 });
  check('isolated-standby', 'the isolated standby promotes itself to epoch 4, above the real hub', Boolean(promoted.value), {});
  const t = Date.now();
  await pc2.lan(true);
  const healed = await waitFor(async () => {
    const [a, b] = [await pc1.status(), await pc2.status()];
    return a.role === 'standby' && a.epoch === 4 && (a.stats.rejoins ?? 0) > before && a.applied_seq === b.applied_seq && { a, b };
  }, { label: 'real hub hands over', timeout: 15000 });
  timings.isolated_standby_heal_ms = Date.now() - t;
  check('isolated-standby', 'on heal the higher epoch wins: the hub that served the branch demotes itself and forwards its 3 commands', healed.value.a.stats.forwarded - pc1Before.forwarded === 3, { forwarded: healed.value.a.stats.forwarded - pc1Before.forwarded });
  await kds.waitFor((s) => s.hub === IDS.pc2 && ticketsOf(s, o7).length === 1, { label: 'kds follows to cashier-2', timeout: 10000 });
  check('isolated-standby', 'the kitchen display follows the new hub and still shows the order', true, {});
  const next = await waiter.send([waiter.command('AddLines', { order_id: o7, lines: [{ line_id: uuidv7(), item_id: IDS.itemJuice, quantity: 1 }] })]);
  const resentIds = new Set((waiter.lastResent ?? []).map((r) => r.id));
  check('isolated-standby', "the waiter re-sends every unmirrored command (these 3 and older ones); all are recognised as duplicates", next.hub === pc2.cfg.name && sent.results.every((r) => resentIds.has(r.id)) && waiter.lastResent.every((r) => r.status === 'duplicate'), waiter.lastResent);
  const [j1, j2] = [await journalIds(pc1), await journalIds(pc2)];
  check('isolated-standby', 'both journals are identical again', JSON.stringify(j1) === JSON.stringify(j2), { pc1: j1.length, pc2: j2.length });
});

await run('unmirrored-resend', async () => {
  // A LAN blip on the standby: the hub answers three commands without a standby copy, then loses power.
  const o8 = uuidv7();
  await pc1.lan(false);
  const sent = await waiter.send([
    waiter.command('OpenOrder', { order_id: o8, channel: 'waiter', table_id: IDS.tables[2] }),
    waiter.command('AddLines', { order_id: o8, lines: [{ line_id: uuidv7(), item_id: IDS.itemShawarma, quantity: 1 }] }),
    waiter.command('SendToKitchen', { order_id: o8 }),
  ]);
  await pc2.kill();
  await pc1.lan(true);
  check('unmirrored-resend', 'the hub answered the three commands as not mirrored before it lost power', sent.hub === pc2.cfg.name && sent.results.every((r) => r.status === 'applied' && !r.mirrored), sent.results.map((r) => `${r.status}:${r.mirrored}`));
  const promoted = await waitFor(async () => {
    const s = await pc1.status();
    return s.role === 'hub' && s.epoch === 5 && s;
  }, { label: 'standby promotes', timeout: 15000 });
  const missing = await pc1.sql('SELECT count(*) AS n FROM hub_journal WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(sent.results.map((r) => r.id))]);
  check('unmirrored-resend', 'cashier-1 had heard nothing newer, so it promoted itself (epoch 5) without the three commands', Boolean(promoted.value) && missing[0].n === 0, missing);
  const next = await waiter.send([waiter.command('AddLines', { order_id: o8, lines: [{ line_id: uuidv7(), item_id: IDS.itemJuice, quantity: 1 }] })]);
  check('unmirrored-resend', 'the waiter re-sends them to the new hub, which applies the version the old hub resolved', next.hub === pc1.cfg.name && waiter.lastResent?.length === 3 && waiter.lastResent.every((r) => r.status === 'applied'), waiter.lastResent);
  const [order] = await pc1.sql('SELECT number FROM orders WHERE id = ?', [o8]);
  const tickets = await pc1.sql('SELECT id FROM kitchen_tickets WHERE order_id = ?', [o8]);
  const answered = sent.results.find((r) => r.payload?.number)?.payload;
  const answeredTickets = sent.results[2].payload.tickets.map((x) => x.ticket_id);
  check('unmirrored-resend', "the new hub keeps the old hub's order number and ticket ids (no second resolution)", order?.number === answered.number && JSON.stringify(tickets.map((x) => x.id).sort()) === JSON.stringify(answeredTickets.sort()), { local: order?.number, answered: answered.number });
  const checked = (await pc1.status()).stats;
  check('unmirrored-resend', 'the new hub checked the three versions against its own data before applying them', checked.preResolvedIn === 3 && checked.preResolvedRefused === 0, { in: checked.preResolvedIn, refused: checked.preResolvedRefused });
  // A paired client cannot slip in its own "resolved" version: a zero price is refused and the hub resolves the line itself.
  const forged = waiter.command('AddLines', { order_id: o8, lines: [{ line_id: uuidv7(), item_id: IDS.itemShawarma, quantity: 3 }] });
  const priceRow = (await pc1.sql("SELECT id FROM prices WHERE item_id = ? AND julianday(effective_from) <= julianday('now') ORDER BY julianday(effective_from) DESC LIMIT 1", [IDS.itemShawarma]))[0].id;
  forged.resolved = { executed_by_device_id: IDS.pc2, payload: { order_id: o8, lines: [{ ...forged.payload.lines[0], price_id: priceRow, name: 'Synthetic shawarma', station: 'grill', unit_minor: 0 }] } };
  const forgedAnswer = await lanFetch(`${pc1.url}/hub/commands`, { ca: ca.certPem, method: 'POST', body: { commands: [forged] }, headers: { authorization: `Bearer ${waiterToken}` } });
  const forgedLine = (await pc1.sql('SELECT unit_minor FROM order_lines WHERE id = ?', [forged.payload.lines[0].line_id]))[0];
  check('unmirrored-resend', "a forged resolved version (price 0) is refused: the hub resolves the line at the menu's price", forgedAnswer.body.results[0].status === 'applied' && forgedLine?.unit_minor > 0 && (await pc1.status()).stats.preResolvedRefused === 1, { unit: forgedLine?.unit_minor });
  await pc2.start();
  const back = await waitFor(async () => {
    const [a, b] = [await pc1.status(), await pc2.status()];
    return b.role === 'standby' && b.epoch === 5 && !b.rejoin_pending && a.applied_seq === b.applied_seq && { a, b };
  }, { label: 'old hub rejoins', timeout: 15000 });
  check('unmirrored-resend', 'the old hub rejoins with no payload conflict and nothing to forward', back.value.b.stats.payloadConflicts === 0 && back.value.b.stats.forwarded === 0, back.value.b.stats.lastRejoin);
  const [j1, j2] = [await journalIds(pc1), await journalIds(pc2)];
  check('unmirrored-resend', 'both journals are identical again', JSON.stringify(j1) === JSON.stringify(j2), { pc1: j1.length, pc2: j2.length });
  await pc1.internet(true);
  await pc2.internet(true);
  await waitFor(async () => (await pc1.status()).pending_uploads === 0 && (await pc2.status()).pending_uploads === 0, { label: 'queues empty', timeout: 30000 });
  const stats = await api('/api/spike/stats');
  const rejected = await sql("SELECT type, outcome_detail FROM command_log WHERE outcome = 'rejected'");
  check('unmirrored-resend', 'online, the server saw no payload mismatch and rejected nothing', stats.replayMismatches === 0 && rejected.length === 0, { stats, rejected });
  const srv = await serverState();
  await waitFor(async () => (await pcState(pc1)) === srv && (await pcState(pc2)) === srv, { label: 'converge', timeout: 20000 });
  check('unmirrored-resend', 'both PCs converge to the server state', true, {});
});

await run('divergence', async () => {
  // The residual case: the hub copies a command, loses power, and restarts while its standby is unreachable.
  // The waiter's retry has no answer to carry, so the hub resolves the same command id again, differently.
  await pc1.internet(false);
  await pc2.internet(false);
  await pc2.ctl('/ctl/fault', { takeoverMs: 15000 }); // keep the standby from promoting during the test
  const o9 = uuidv7();
  await waiter.send([
    waiter.command('OpenOrder', { order_id: o9, channel: 'waiter', table_id: IDS.tables[3] }),
    waiter.command('AddLines', { order_id: o9, lines: [{ line_id: uuidv7(), item_id: IDS.itemBurger, quantity: 1 }] }),
  ]);
  await waitFor(inSync, { label: 'standby in sync' });
  await pc1.ctl('/ctl/fault', { crashAfterMirror: true });
  const x = waiter.command('SendToKitchen', { order_id: o9 });
  const pending = waiter.send([x], { timeout: 20000 });
  await pc1.exited;
  const xOnStandby = await pc2.sql('SELECT id FROM hub_journal WHERE id = ?', [x.id]);
  check('divergence', 'the standby holds the command the hub copied before it died', xOnStandby.length === 1, {});
  await pc2.lan(false);
  await pc1.start(); // cannot reach the standby at start, so it serves alone
  const answer = await pending;
  const before = (await pc2.status()).stats;
  await pc2.lan(true);
  const seen = await waitFor(async () => {
    const s = await pc2.status();
    return s.stats.payloadConflicts > before.payloadConflicts && !s.rejoin_pending && s;
  }, { label: 'standby detects the divergence', timeout: 15000 });
  const [t1, t2] = [await pc1.sql('SELECT id FROM kitchen_tickets WHERE order_id = ?', [o9]), await pc2.sql('SELECT id FROM kitchen_tickets WHERE order_id = ?', [o9])];
  check('divergence', 'the hub resolved the retried command again: the two PCs hold different ticket ids for it', answer.results[0].status === 'applied' && t1[0]?.id !== t2[0]?.id, { status: answer.results[0].status });
  check('divergence', 'the standby detects it (heartbeat mismatch), rejoins and counts a payload conflict', seen.value.stats.divergences > before.divergences && seen.value.stats.payloadConflicts === before.payloadConflicts + 1, { divergences: seen.value.stats.divergences, conflicts: seen.value.stats.payloadConflicts });
  await pc2.ctl('/ctl/fault', { takeoverMs: 3000 });
  const statsBefore = await api('/api/spike/stats');
  await pc1.internet(true);
  await pc2.internet(true);
  await waitFor(async () => (await pc1.status()).pending_uploads === 0 && (await pc2.status()).pending_uploads === 0, { label: 'queues empty', timeout: 30000 });
  const statsAfter = await api('/api/spike/stats');
  check('divergence', 'online, the server keeps the first version it receives and flags the other as a payload mismatch', statsAfter.replayMismatches === statsBefore.replayMismatches + 1, { before: statsBefore.replayMismatches, after: statsAfter.replayMismatches });
  const srv = await serverState();
  await waitFor(async () => (await pcState(pc1)) === srv && (await pcState(pc2)) === srv, { label: 'converge', timeout: 20000 });
  check('divergence', "the checkpoint replaces the losing PC's version: both PCs converge to the server state", true, {});
});

await run('crash-loop', async () => {
  // A branch with one PC: the standby is switched off, then the hub loses power 10 times in the middle of writes.
  await pc2.kill();
  await pc1.internet(false);
  const o6 = uuidv7();
  const opened = await waiter.send([waiter.command('OpenOrder', { order_id: o6, channel: 'waiter', table_id: IDS.tables[0] })]);
  check('crash-loop', 'a lone hub keeps taking orders with its standby switched off', opened.results[0].status === 'applied' && opened.results[0].mirrored === false, opened.results[0]);
  const acked = new Map();
  const rounds = [];
  for (let round = 0; round < 10; round++) {
    let stop = false;
    const killer = (async () => {
      await sleep(100 + Math.floor(Math.random() * 400));
      stop = true;
      await pc1.kill();
    })();
    while (!stop) {
      const c = waiter.command('AddLines', { order_id: o6, lines: [{ line_id: uuidv7(), item_id: IDS.itemFries, quantity: 1 }] });
      try {
        const r = await waiter.send([c], { timeout: 300 });
        if (r.results[0].status === 'applied' || r.results[0].status === 'duplicate') acked.set(c.id, c.payload.lines[0].line_id);
      } catch {
        // the hub went down mid-request: the waiter does not count it as sent
      }
    }
    await killer;
    const t = Date.now();
    await pc1.start();
    const integrity = (await pc1.sql('PRAGMA integrity_check'))[0]?.integrity_check;
    const lines = new Set((await pc1.sql('SELECT id FROM order_lines WHERE order_id = ?', [o6])).map((r) => r.id));
    const queued = (await pc1.status()).pending_uploads;
    rounds.push({ round, restart_ms: Date.now() - t, integrity, acked: acked.size, lines: lines.size, lost: [...acked.values()].filter((l) => !lines.has(l)).length, queued });
  }
  timings.crash_loop_restart_ms_max = Math.max(...rounds.map((r) => r.restart_ms));
  check('crash-loop', 'after each of 10 power cuts the encrypted database reopens and passes integrity_check', rounds.every((r) => r.integrity === 'ok'), rounds);
  check('crash-loop', 'no command the waiter saw acknowledged was lost', rounds.every((r) => r.lost === 0), rounds.map((r) => `${r.acked}/${r.lines}/${r.lost}`));
  const orphan = await pc1.sql(
    `SELECT (SELECT count(*) FROM order_lines l WHERE l.order_id = ? AND NOT EXISTS (SELECT 1 FROM hub_journal j, json_each(json_extract(j.entry, '$.payload.lines')) x WHERE json_extract(x.value, '$.line_id') = l.id)) AS rows_without_entry,
            (SELECT count(*) FROM hub_journal j, json_each(json_extract(j.entry, '$.payload.lines')) x WHERE NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.id = json_extract(x.value, '$.line_id'))) AS entries_without_rows`, [o6]);
  check('crash-loop', 'no half-written command: rows and journal entries match after the cuts', orphan[0].rows_without_entry === 0 && orphan[0].entries_without_rows === 0, orphan[0]);
  const local = (await pc1.sql('SELECT count(*) AS n FROM order_lines WHERE order_id = ?', [o6]))[0].n;
  const t = Date.now();
  await pc1.internet(true);
  await waitFor(async () => (await pc1.status()).pending_uploads === 0, { label: 'queue empty', timeout: 30000 });
  timings.crash_loop_replay_ms = Date.now() - t;
  const [srv] = await sql('SELECT count(*)::int AS n FROM order_lines WHERE order_id = $1', [o6]);
  check('crash-loop', 'the server received every line the PC holds, once', srv.n === local && local >= acked.size, { server: srv.n, local, acked: acked.size });
});

waiter?.close();
kds?.close();
for (const pc of [pc1, pc2]) {
  if (pc.child && pc.child.exitCode === null) await pc.kill();
}
const failed = results.filter((r) => !r.ok).length;
const report = { label, runtime, node: process.versions.node, date: new Date().toISOString(), passed: results.length - failed, failed, timings, results };
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${failed} failed. Timings:`, JSON.stringify(timings));
process.exit(failed ? 1 : 0);
