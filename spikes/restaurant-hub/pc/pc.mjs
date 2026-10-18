// A restaurant PC (Windows app, main process): encrypted local PowerSync database, the branch hub's LAN server,
// and the hub / standby roles. One process per PC; the scenarios start, cut and kill them. Throwaway code.
//
// The hub protocol in one paragraph: hub clients (waiter phones, kitchen displays, the PC's own cashier screen) send
// commands to the active hub. The hub serializes them, resolves what only it may decide (order number, price
// snapshot, kitchen tickets), appends the result to its journal with the next sequence number, sends the entry to
// the standby and waits for it ("mirror first"), applies it to its own database (optimistic rows + the upload queue),
// then answers. The standby applies the same entries in the same order, so both PCs hold the same orders and both
// upload the same commands; the server's idempotency by command id makes the double upload harmless. When the
// standby stops hearing the hub and holds everything the hub reported, it promotes itself with a higher epoch.
// A PC that meets a hub with a higher epoch demotes itself, catches up, and forwards what it took alone.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { PowerSyncDatabase, Schema, Table, column, createConsoleLogger, LogLevels } from '@powersync/node';
import { v7 as uuidv7 } from 'uuid';
import { createProxy } from './proxy.mjs';
import { lanFetch } from './lan-http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(process.env.PC_CONFIG, 'utf8'));
const HEARTBEAT_MS = 500;
const TAKEOVER_DEFAULT_MS = Number(cfg.takeoverMs ?? 3000);
const MIRROR_TIMEOUT_MS = 800;
const log = (...a) => process.stderr.write(`${new Date().toISOString()} [${cfg.name}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);

// --- Local database ------------------------------------------------------------------------------
const text = column.text;
const int = column.integer;
const schema = new Schema({
  menu_items: new Table({ tenant_id: text, branch_id: text, name: text, station: text }),
  prices: new Table({ tenant_id: text, branch_id: text, item_id: text, amount_minor: int, currency: text, effective_from: text }),
  dining_tables: new Table({ tenant_id: text, branch_id: text, label: text }),
  number_ranges: new Table({ tenant_id: text, branch_id: text, device_id: text, business_day: text, first_number: int, last_number: int }),
  orders: new Table({
    tenant_id: text, branch_id: text, business_day: text, number: int, channel: text, table_id: text, status: text, currency: text,
    subtotal_minor: int, paid_minor: int, opened_by_device_id: text, created_at: text,
  }),
  order_lines: new Table({
    tenant_id: text, branch_id: text, order_id: text, item_id: text, price_id: text, name: text, station: text, unit_minor: int,
    quantity: int, line_minor: int, currency: text, ticket_id: text, added_by_device_id: text,
  }),
  kitchen_tickets: new Table({ tenant_id: text, branch_id: text, order_id: text, order_number: int, station: text, status: text, created_at: text, updated_at: text }),
  payments: new Table({ tenant_id: text, branch_id: text, order_id: text, amount_minor: int, currency: text, method: text, command_id: text, taken_at: text }),
  command_log: new Table({ type: text, origin_device_id: text, outcome: text, outcome_detail: text, received_at: text }),
  // The upload queue of typed commands (insert-only: never stored locally, only queued).
  commands: new Table({
    type: text, user_id: text, origin_device_id: text, executed_by_device_id: text, hub_epoch: int, hub_seq: int, device_time: text, payload: text,
  }, { insertOnly: true }),
  // Local-only hub state: never uploaded, never replaced by a checkpoint. id = command id.
  hub_journal: new Table({ seq: int, epoch: int, type: text, entry: text, forked: int }, { localOnly: true }),
  hub_clients: new Table({ kind: text, name: text, token_hash: text, paired_at: text }, { localOnly: true }),
  hub_state: new Table({ role: text, epoch: int, applied_seq: int, hub_device_id: text, rejoin_pending: int }, { localOnly: true }),
  local_ranges: new Table({ business_day: text, first_number: int, last_number: int, last_used: int }, { localOnly: true }),
});

const syncProxy = await createProxy(cfg.syncPort);
const apiProxy = await createProxy(cfg.apiPort);
const api = `http://127.0.0.1:${apiProxy.port}`;
fs.mkdirSync(cfg.dir, { recursive: true });

const db = new PowerSyncDatabase({
  schema,
  logger: createConsoleLogger({ minLevel: LogLevels.error + 1 }),
  database: {
    dbFilename: `${cfg.name}.sqlite`,
    dbLocation: cfg.dir,
    openWorker: (_, options) => new Worker(new URL('./encrypted.worker.mjs', import.meta.url), { ...options, workerData: { hexKey: cfg.hexKey } }),
  },
});
await db.init();

const stats = {
  uploads: 0, replays: 0, replayMismatches: 0, mirrorFailures: 0, divergences: 0, payloadConflicts: 0, promotions: 0, demotions: 0, forwarded: 0,
  forwardedIn: 0, recoveredFromStandby: 0, preResolvedIn: 0, preResolvedRefused: 0, rejoinFailures: 0, startedAt: Date.now(),
};
// Spike-only knobs the scenarios set through the control port.
const faults = { crashAfterMirror: false, failRejoinForwardOnce: false, takeoverMs: TAKEOVER_DEFAULT_MS };
const sync = { token: null };

async function fetchToken() {
  const r = await fetch(`${api}/api/auth/device-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: cfg.deviceId }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  sync.token = (await r.json()).token;
  return sync.token;
}

const connector = {
  async fetchCredentials() {
    return { endpoint: `http://127.0.0.1:${syncProxy.port}`, token: await fetchToken() };
  },
  async uploadData(database) {
    const batch = await database.getCrudBatch(200);
    if (!batch) return;
    // Only commands travel; optimistic row writes stay local until the server's checkpoint replaces them.
    const commands = batch.crud.filter((op) => op.table === 'commands' && op.op === 'PUT').map((op) => ({
      id: op.id,
      type: op.opData.type,
      user_id: op.opData.user_id,
      origin_device_id: op.opData.origin_device_id,
      executed_by_device_id: op.opData.executed_by_device_id,
      hub_epoch: op.opData.hub_epoch,
      hub_seq: op.opData.hub_seq,
      device_time: op.opData.device_time,
      payload: JSON.parse(op.opData.payload),
    }));
    if (commands.length) {
      if (!sync.token) await fetchToken();
      const r = await fetch(`${api}/api/commands`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sync.token}` }, body: JSON.stringify({ commands }),
      });
      if (r.status === 401) sync.token = null;
      if (!r.ok) throw new Error(`upload ${r.status}`); // keeps the batch queued; the SDK retries
      const { results } = await r.json();
      stats.uploads += results.length;
      stats.replays += results.filter((x) => x.replay).length;
      stats.replayMismatches += results.filter((x) => x.replay_payload_mismatch).length;
    }
    await batch.complete();
  },
};

// --- Hub state -------------------------------------------------------------------------------------
const STATE_ID = '00000000-0000-7000-8000-000000000001';
let state;
{
  const row = await db.getOptional('SELECT * FROM hub_state WHERE id = ?', [STATE_ID]);
  if (row) state = { role: row.role, epoch: row.epoch, appliedSeq: row.applied_seq, hubDeviceId: row.hub_device_id, rejoinPending: Boolean(row.rejoin_pending) };
  else {
    state = { role: cfg.preferredRole, epoch: cfg.preferredRole === 'hub' ? 1 : 0, appliedSeq: 0, hubDeviceId: cfg.preferredRole === 'hub' ? cfg.deviceId : null, rejoinPending: false };
    await db.execute('INSERT INTO hub_state (id, role, epoch, applied_seq, hub_device_id, rejoin_pending) VALUES (?, ?, ?, ?, ?, 0)', [STATE_ID, state.role, state.epoch, 0, state.hubDeviceId]);
  }
}
const persistState = (tx = db) =>
  tx.execute('UPDATE hub_state SET role = ?, epoch = ?, applied_seq = ?, hub_device_id = ?, rejoin_pending = ? WHERE id = ?', [
    state.role, state.epoch, state.appliedSeq, state.hubDeviceId, state.rejoinPending ? 1 : 0, STATE_ID,
  ]);

let chain = Promise.resolve();
// One writer: every journal change on this PC runs through here, in order.
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

let lanOnline = true;
let lastHeartbeat = 0;
let hubSeq = 0;
let takeoverBlocked = null;
const peerState = new Map();
const self = { device_id: cfg.deviceId, name: cfg.name, url: `https://127.0.0.1:${cfg.lanPort}` };

// --- Applying journal entries (identical on hub and standby) --------------------------------------
const TICKET_RANK = { new: 0, preparing: 1, ready: 2, served: 3 };

async function insertIfMissing(tx, table, row) {
  if (await tx.getOptional(`SELECT id FROM ${table} WHERE id = ?`, [row.id])) return false;
  const cols = Object.keys(row);
  await tx.execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
  return true;
}

async function applyEffects(tx, e) {
  const p = e.payload;
  const base = { tenant_id: cfg.tenantId, branch_id: cfg.branchId };
  switch (e.type) {
    case 'HubClientPaired':
      await tx.execute('INSERT INTO hub_clients (id, kind, name, token_hash, paired_at) VALUES (?, ?, ?, ?, ?)', [p.client_id, p.kind, p.name, p.token_hash, e.device_time]);
      return;
    case 'OpenOrder':
      await insertIfMissing(tx, 'orders', {
        id: p.order_id, ...base, business_day: p.business_day, number: p.number, channel: p.channel, table_id: p.table_id, status: 'open',
        currency: p.currency, subtotal_minor: 0, paid_minor: 0, opened_by_device_id: e.origin_device_id, created_at: e.device_time,
      });
      // A local counter, so a number is never reused even if a checkpoint later removes the row.
      if (e.executed_by_device_id === cfg.deviceId) {
        await tx.execute('UPDATE local_ranges SET last_used = max(coalesce(last_used, 0), ?) WHERE business_day = ?', [p.number, p.business_day]);
      }
      return;
    case 'AddLines':
      for (const l of p.lines) {
        await insertIfMissing(tx, 'order_lines', {
          id: l.line_id, ...base, order_id: p.order_id, item_id: l.item_id, price_id: l.price_id, name: l.name, station: l.station,
          unit_minor: l.unit_minor, quantity: l.quantity, line_minor: l.unit_minor * l.quantity, currency: cfg.currency, ticket_id: null,
          added_by_device_id: e.origin_device_id,
        });
      }
      await tx.execute('UPDATE orders SET subtotal_minor = (SELECT coalesce(sum(line_minor), 0) FROM order_lines WHERE order_id = ?) WHERE id = ?', [p.order_id, p.order_id]);
      return;
    case 'SendToKitchen': {
      const order = await tx.getOptional('SELECT number FROM orders WHERE id = ?', [p.order_id]);
      for (const t of p.tickets) {
        await insertIfMissing(tx, 'kitchen_tickets', {
          id: t.ticket_id, ...base, order_id: p.order_id, order_number: order?.number ?? null, station: t.station, status: 'new', created_at: e.device_time, updated_at: e.device_time,
        });
        await tx.execute('UPDATE order_lines SET ticket_id = ? WHERE id IN (SELECT value FROM json_each(?))', [t.ticket_id, JSON.stringify(t.line_ids)]);
      }
      return;
    }
    case 'SetTicketStatus': {
      const t = await tx.getOptional('SELECT status FROM kitchen_tickets WHERE id = ?', [p.ticket_id]);
      if (t && TICKET_RANK[p.status] > TICKET_RANK[t.status]) {
        await tx.execute('UPDATE kitchen_tickets SET status = ?, updated_at = ? WHERE id = ?', [p.status, e.device_time, p.ticket_id]);
      }
      return;
    }
    case 'TakePayment':
      await insertIfMissing(tx, 'payments', {
        id: p.payment_id, ...base, order_id: p.order_id, amount_minor: p.amount_minor, currency: p.currency, method: p.method, command_id: e.command_id, taken_at: e.device_time,
      });
      await tx.execute(
        `UPDATE orders SET paid_minor = (SELECT coalesce(sum(amount_minor), 0) FROM payments WHERE order_id = ?),
           status = CASE WHEN (SELECT coalesce(sum(amount_minor), 0) FROM payments WHERE order_id = ?) >= subtotal_minor THEN 'paid' ELSE 'open' END
         WHERE id = ?`, [p.order_id, p.order_id, p.order_id]);
      return;
    default:
      throw new Error(`unknown entry type ${e.type}`);
  }
}

// One local transaction: the effects, the journal row, the upload-queue row and the applied sequence, or nothing.
async function applyEntry(entry, { forked = 0 } = {}) {
  let advanced = state.appliedSeq;
  await db.writeTransaction(async (tx) => {
    const seen = await tx.getOptional('SELECT id, entry FROM hub_journal WHERE id = ?', [entry.command_id]);
    if (seen) {
      // Already applied here (a forwarded entry coming back, or a retry): only its place in the hub's sequence changes.
      // A different resolved payload for the same id is a conflict this PC does not repair alone (report, finding 3).
      if (entryHash(JSON.parse(seen.entry)) !== entryHash(entry)) {
        stats.payloadConflicts++;
        log('payload conflict', { command_id: entry.command_id, type: entry.type });
      }
      await tx.execute('UPDATE hub_journal SET seq = ?, epoch = ?, forked = 0 WHERE id = ?', [entry.seq, entry.epoch, entry.command_id]);
    } else {
      await applyEffects(tx, entry);
      await tx.execute('INSERT INTO hub_journal (id, seq, epoch, type, entry, forked) VALUES (?, ?, ?, ?, ?, ?)', [entry.command_id, entry.seq, entry.epoch, entry.type, JSON.stringify(entry), forked]);
      if (entry.type !== 'HubClientPaired') {
        await tx.execute(
          `INSERT INTO commands (id, type, user_id, origin_device_id, executed_by_device_id, hub_epoch, hub_seq, device_time, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.command_id, entry.type, entry.user_id, entry.origin_device_id, entry.executed_by_device_id, entry.epoch, entry.seq, entry.device_time, JSON.stringify(entry.payload)]);
      }
    }
    if (!forked && entry.seq > advanced) {
      advanced = entry.seq;
      await tx.execute('UPDATE hub_state SET applied_seq = ? WHERE id = ?', [advanced, STATE_ID]);
    }
  });
  state.appliedSeq = advanced;
}

const entryHash = (e) => crypto.createHash('sha256').update(JSON.stringify([e.command_id, e.type, e.executed_by_device_id, e.payload])).digest('hex');

/** This PC's entry at a sequence number of the current lineage, as { command_id, hash }, or null. */
async function lineageAt(seq) {
  if (seq < 1) return null;
  const row = await db.getOptional('SELECT entry FROM hub_journal WHERE forked = 0 AND seq = ?', [seq]);
  if (!row) return null;
  const e = JSON.parse(row.entry);
  return { seq, command_id: e.command_id, hash: entryHash(e) };
}
const sameEntry = (a, b) => Boolean(a && b && a.command_id === b.command_id && a.hash === b.hash);

async function lineageAfter(after) {
  const rows = await db.getAll('SELECT seq, epoch, entry FROM hub_journal WHERE forked = 0 AND seq > ? ORDER BY seq', [after]);
  return rows.map((r) => ({ ...JSON.parse(r.entry), seq: r.seq, epoch: r.epoch }));
}

// --- Resolving client commands (active hub only) ----------------------------------------------------
const refuse = (reason) => ({ refused: reason });

async function nextNumber() {
  const range = await db.getOptional('SELECT * FROM local_ranges WHERE business_day = ?', [cfg.businessDay]);
  if (!range) return null;
  const { n } = await db.get('SELECT max(number) AS n FROM orders WHERE business_day = ? AND number BETWEEN ? AND ?', [cfg.businessDay, range.first_number, range.last_number]);
  const next = Math.max(n ?? 0, range.last_used ?? 0, range.first_number - 1) + 1;
  return next <= range.last_number ? next : null;
}

async function resolve(c) {
  const p = c.payload ?? {};
  switch (c.type) {
    case 'OpenOrder': {
      if (await db.getOptional('SELECT id FROM orders WHERE id = ?', [p.order_id])) return refuse('order_exists');
      const number = await nextNumber();
      if (!number) return refuse('no_number_range');
      return { payload: { order_id: p.order_id, number, business_day: cfg.businessDay, channel: p.channel, table_id: p.table_id ?? null, currency: cfg.currency } };
    }
    case 'AddLines': {
      const order = await db.getOptional('SELECT status FROM orders WHERE id = ?', [p.order_id]);
      if (!order) return refuse('order_not_found');
      if (order.status !== 'open') return refuse('order_closed');
      const lines = [];
      for (const l of p.lines) {
        const item = await db.getOptional(
          `SELECT m.name, m.station, p.id AS price_id, p.amount_minor FROM menu_items m JOIN prices p ON p.item_id = m.id
            WHERE m.id = ? AND julianday(p.effective_from) <= julianday('now') ORDER BY julianday(p.effective_from) DESC LIMIT 1`, [l.item_id]);
        if (!item) return refuse('item_not_found');
        lines.push({ line_id: l.line_id, item_id: l.item_id, price_id: item.price_id, quantity: l.quantity, name: item.name, station: item.station, unit_minor: item.amount_minor });
      }
      return { payload: { order_id: p.order_id, lines } };
    }
    case 'SendToKitchen': {
      const lines = await db.getAll('SELECT id, station FROM order_lines WHERE order_id = ? AND ticket_id IS NULL ORDER BY id', [p.order_id]);
      if (!lines.length) return refuse('nothing_to_send');
      const byStation = new Map();
      for (const l of lines) byStation.set(l.station, [...(byStation.get(l.station) ?? []), l.id]);
      return { payload: { order_id: p.order_id, tickets: [...byStation].map(([station, lineIds]) => ({ ticket_id: uuidv7(), station, line_ids: lineIds })) } };
    }
    case 'SetTicketStatus': {
      const t = await db.getOptional('SELECT status FROM kitchen_tickets WHERE id = ?', [p.ticket_id]);
      if (!t) return refuse('ticket_not_found');
      if (!(TICKET_RANK[p.status] > TICKET_RANK[t.status])) return refuse('invalid_transition');
      return { payload: { ticket_id: p.ticket_id, status: p.status } };
    }
    case 'TakePayment': {
      const order = await db.getOptional('SELECT currency FROM orders WHERE id = ?', [p.order_id]);
      if (!order) return refuse('order_not_found');
      return { payload: { payment_id: p.payment_id, order_id: p.order_id, amount_minor: p.amount_minor, currency: order.currency, method: p.method ?? 'cash' } };
    }
    default:
      return refuse('unknown_command');
  }
}

class NotHub extends Error {}

async function submitOne(c, originDeviceId, type = c.type, resolved = null, executedBy = cfg.deviceId) {
  if (state.role !== 'hub') throw new NotHub();
  const seen = await db.getOptional('SELECT seq FROM hub_journal WHERE id = ?', [c.id]);
  if (seen) return { id: c.id, status: 'duplicate', seq: seen.seq };
  const r = resolved ?? (await resolve(c));
  if (r.refused) return { id: c.id, status: 'refused', reason: r.refused };
  const entry = {
    command_id: c.id, seq: state.appliedSeq + 1, epoch: state.epoch, type, user_id: c.user_id, origin_device_id: originDeviceId,
    executed_by_device_id: executedBy, device_time: c.device_time ?? new Date().toISOString(), payload: r.payload,
  };
  const mirrored = await mirror(entry); // mirror first, then commit locally, then answer
  if (faults.crashAfterMirror) process.kill(process.pid, 'SIGKILL'); // spike fault: power lost between the two steps
  await applyEntry(entry);
  return { id: c.id, status: 'applied', seq: entry.seq, epoch: entry.epoch, mirrored, executed_by_device_id: executedBy, payload: r.payload };
}

// A client re-sends a command with the version another hub resolved and answered. It comes from a client, so the hub
// checks it against its own data before applying it; if any check fails, the hub resolves the command itself.
async function verifyResolved(c, r) {
  const p = r.payload ?? {};
  const asked = c.payload ?? {};
  const executor = r.executed_by_device_id;
  if (executor !== cfg.deviceId && !cfg.peers.some((peer) => peer.deviceId === executor)) return false;
  switch (c.type) {
    case 'OpenOrder': {
      if (p.order_id !== asked.order_id || p.business_day !== cfg.businessDay || p.currency !== cfg.currency || p.channel !== asked.channel || (p.table_id ?? null) !== (asked.table_id ?? null)) return false;
      if (await db.getOptional('SELECT id FROM orders WHERE id = ? OR (business_day = ? AND number = ?)', [p.order_id, p.business_day, p.number])) return false;
      // The number must come from the executing PC's own range, as the server allocated it.
      return Boolean(await db.getOptional(
        'SELECT id FROM number_ranges WHERE device_id = ? AND substr(business_day, 1, 10) = ? AND ? BETWEEN first_number AND last_number',
        [executor, p.business_day, p.number]));
    }
    case 'AddLines': {
      if (p.order_id !== asked.order_id || !Array.isArray(p.lines) || p.lines.length !== asked.lines?.length) return false;
      const order = await db.getOptional('SELECT status FROM orders WHERE id = ?', [p.order_id]);
      if (order?.status !== 'open') return false;
      for (const [i, l] of p.lines.entries()) {
        const a = asked.lines[i];
        if (l.line_id !== a.line_id || l.item_id !== a.item_id || l.quantity !== a.quantity) return false;
        if (await db.getOptional('SELECT id FROM order_lines WHERE id = ?', [l.line_id])) return false;
        // The same rule as resolve(): the newest price row in force for the item, with its amount, name and station.
        const row = await db.getOptional(
          `SELECT p.id, p.amount_minor, m.name, m.station FROM menu_items m JOIN prices p ON p.item_id = m.id
            WHERE m.id = ? AND julianday(p.effective_from) <= julianday('now') ORDER BY julianday(p.effective_from) DESC LIMIT 1`, [l.item_id]);
        if (!row || row.id !== l.price_id || row.amount_minor !== l.unit_minor || row.name !== l.name || row.station !== l.station) return false;
      }
      return true;
    }
    case 'SendToKitchen': {
      if (p.order_id !== asked.order_id || !Array.isArray(p.tickets) || !p.tickets.length) return false;
      for (const t of p.tickets) {
        if (await db.getOptional('SELECT id FROM kitchen_tickets WHERE id = ?', [t.ticket_id])) return false;
        const rows = await db.getAll('SELECT station, ticket_id FROM order_lines WHERE order_id = ? AND id IN (SELECT value FROM json_each(?))', [p.order_id, JSON.stringify(t.line_ids ?? [])]);
        if (!t.line_ids?.length || rows.length !== t.line_ids.length || rows.some((x) => x.ticket_id || x.station !== t.station)) return false;
      }
      return true;
    }
    default:
      return false; // the other commands resolve the same way on any hub
  }
}

function submit(commands, originDeviceId) {
  return serial(async () => {
    const results = [];
    for (const c of commands) {
      try {
        // A resend of a command another hub already resolved and answered: apply that version, never resolve it again.
        const r = c.resolved;
        const fresh = Boolean(r) && !(await db.getOptional('SELECT id FROM hub_journal WHERE id = ?', [c.id])); // else: a duplicate
        const known = fresh && (await verifyResolved(c, r));
        if (known) stats.preResolvedIn++;
        else if (fresh) stats.preResolvedRefused++;
        results.push(known
          ? await submitOne(c, originDeviceId, c.type, { payload: r.payload }, r.executed_by_device_id)
          : await submitOne(c, originDeviceId));
      } catch (e) {
        if (!(e instanceof NotHub)) throw e;
        results.push({ id: c.id, status: 'not_hub' });
      }
    }
    return results;
  });
}

// --- Peers (the other hub-capable PCs of the branch) -------------------------------------------------
async function peerCall(peer, route, body, timeout = MIRROR_TIMEOUT_MS) {
  if (!lanOnline) throw new Error('lan_offline');
  return lanFetch(`${peer.url}${route}`, { ca: cfg.caPem, method: 'POST', body: body ?? {}, headers: { 'x-peer-secret': cfg.peerSecret }, timeout });
}

async function pushEntries(peer, entries) {
  if (!entries.length) return true;
  const prev = await lineageAt(entries[0].seq - 1);
  const r = await peerCall(peer, '/peer/mirror', { epoch: state.epoch, from: cfg.deviceId, prev, entries });
  if (r.status === 409) {
    queueMicrotask(() => demote(r.body).catch((e) => log('demote failed', String(e))));
    throw new NotHub();
  }
  if (r.status === 503) return false; // the standby is rejoining
  if (r.status !== 200) throw new Error(`mirror ${r.status}`);
  if (r.body.diverged) {
    stats.divergences++;
    peerState.set(peer.deviceId, { ...peerState.get(peer.deviceId), reachable: true, role: 'standby', appliedSeq: r.body.applied_seq, diverged: true });
    return false;
  }
  if (r.body.need_from) {
    const missing = await lineageAfter(r.body.need_from - 1);
    const ids = new Set(missing.map((e) => e.command_id));
    return pushEntries(peer, [...missing, ...entries.filter((e) => !ids.has(e.command_id))]);
  }
  peerState.set(peer.deviceId, { ...peerState.get(peer.deviceId), reachable: true, role: 'standby', appliedSeq: r.body.applied_seq, lastSeen: Date.now() });
  return true;
}

async function mirror(entry, { except = null } = {}) {
  let mirrored = false;
  for (const peer of cfg.peers) {
    if (peer.deviceId === except) continue;
    const ps = peerState.get(peer.deviceId);
    if (!ps?.reachable || ps.role !== 'standby') continue;
    try {
      mirrored = (await pushEntries(peer, [entry])) || mirrored;
    } catch (e) {
      if (e instanceof NotHub) throw e;
      stats.mirrorFailures++;
      peerState.set(peer.deviceId, { ...ps, reachable: false });
    }
  }
  return mirrored;
}

async function promote(reason) {
  return serial(async () => {
    if (state.role === 'hub') return;
    // Only a manager may promote a PC whose rejoin has not finished (the hub is gone mid-rejoin).
    if (state.rejoinPending && reason !== 'manual') return;
    // Re-check under the writer lock: a demotion or a heartbeat may have arrived while this waited.
    if (reason === 'hub_silent' && (Date.now() - lastHeartbeat < faults.takeoverMs || state.appliedSeq < hubSeq)) return;
    state.role = 'hub';
    state.epoch += 1;
    state.hubDeviceId = cfg.deviceId;
    if (state.rejoinPending) {
      // The entries this PC took alone and never forwarded join its new lineage, after what it already caught up.
      const forked = await db.getAll('SELECT entry FROM hub_journal WHERE forked = 1 ORDER BY seq');
      for (const row of forked) await applyEntry({ ...JSON.parse(row.entry), seq: state.appliedSeq + 1, epoch: state.epoch });
      state.rejoinPending = false;
    }
    await persistState();
    stats.promotions++;
    stats.lastPromotion = { at: Date.now(), reason, epoch: state.epoch };
    log('promoted', reason, { epoch: state.epoch, seq: state.appliedSeq });
  });
}

// Catch up from the hub and forward what this PC took alone (entries the hub never received).
async function rejoin(peer) {
  const r = await peerCall(peer, '/peer/journal', { after: 0 }, 5000);
  if (r.status !== 200) throw new Error(`journal ${r.status}`);
  const theirs = r.body.entries;
  const mine = await lineageAfter(0);
  let k = 0;
  while (k < mine.length && k < theirs.length && mine[k].command_id === theirs[k].command_id) {
    if (entryHash(mine[k]) !== entryHash(theirs[k])) {
      stats.payloadConflicts++;
      log('payload conflict', { command_id: mine[k].command_id, type: mine[k].type });
    }
    k++;
  }
  const theirIds = new Set(theirs.map((e) => e.command_id));
  const newlyForked = mine.slice(k).filter((e) => !theirIds.has(e.command_id));
  if (newlyForked.length) {
    await db.writeTransaction(async (tx) => {
      for (const e of newlyForked) await tx.execute('UPDATE hub_journal SET forked = 1 WHERE id = ?', [e.command_id]);
    });
  }
  // Applying the hub's entries is idempotent by command id, so an interrupted rejoin simply runs again.
  for (const e of theirs.slice(k)) await applyEntry(e);
  // Everything still marked forked and unknown to the hub, including what an interrupted rejoin did not forward.
  const forked = (await db.getAll('SELECT entry FROM hub_journal WHERE forked = 1 ORDER BY seq'))
    .map((row) => JSON.parse(row.entry)).filter((e) => !theirIds.has(e.command_id));
  if (forked.length) {
    if (faults.failRejoinForwardOnce) {
      // Spike fault: the LAN drops (or the power goes) between the catch-up and the forward.
      faults.failRejoinForwardOnce = false;
      stats.rejoinFailures++;
      throw new Error('fault: forward lost');
    }
    const f = await peerCall(peer, '/peer/forward', { epoch: state.epoch, from: cfg.deviceId, entries: forked }, 5000);
    if (f.status !== 200) throw new Error(`forward ${f.status}`);
    stats.forwarded += forked.length;
  }
  // Only now is the rejoin complete: the sequence and the cleared flag are saved together.
  state.appliedSeq = theirs.at(-1)?.seq ?? 0;
  state.rejoinPending = false;
  await persistState();
  hubSeq = state.appliedSeq;
  lastHeartbeat = Date.now();
  log('rejoined', { hub: peer.name, caughtUp: theirs.length - k, forwarded: forked.length, seq: state.appliedSeq });
  return { caughtUp: theirs.length - k, forwarded: forked.length };
}

// The standby found that its journal and the hub's disagree, or a rejoin was cut short: rejoin again.
// Until it completes, the standby refuses mirrors and never promotes itself.
let rejoinInFlight = false;
function resumeRejoin(hubDeviceId, reason) {
  const peer = cfg.peers.find((p) => p.deviceId === hubDeviceId);
  if (!peer || rejoinInFlight) return;
  rejoinInFlight = true;
  serial(async () => {
    if (reason === 'pending' && !state.rejoinPending) return; // the rejoin it was waiting for has finished
    if (!state.rejoinPending) {
      state.rejoinPending = true;
      await persistState();
    }
    log('rejoin', reason);
    stats.lastRejoin = await rejoin(peer);
    stats.rejoins = (stats.rejoins ?? 0) + 1;
  }).catch((e) => log('rejoin failed, will retry', String(e))).finally(() => {
    rejoinInFlight = false;
  });
}

async function demote(peerStatus) {
  return serial(async () => {
    const peer = cfg.peers.find((p) => p.deviceId === peerStatus.device_id);
    const following = state.role === 'standby' && state.hubDeviceId === peer?.deviceId && state.epoch === peerStatus.epoch;
    if (!peer || peerStatus.epoch < state.epoch || (following && !state.rejoinPending)) return;
    const wasHub = state.role === 'hub';
    state.role = 'standby';
    state.epoch = peerStatus.epoch;
    state.hubDeviceId = peer.deviceId;
    state.rejoinPending = true; // saved with the role: a rejoin cut short resumes on the next heartbeat or start
    lastHeartbeat = Date.now();
    await persistState();
    if (wasHub) {
      stats.demotions++;
      for (const c of sseClients) c.destroy();
      log('demoted', { to: peer.name, epoch: state.epoch });
    }
    stats.lastRejoin = await rejoin(peer);
    stats.rejoins = (stats.rejoins ?? 0) + 1;
  });
}

async function heartbeatLoop() {
  if (state.role !== 'hub') return;
  for (const peer of cfg.peers) {
    try {
      const r = await peerCall(peer, '/peer/heartbeat', { epoch: state.epoch, from: cfg.deviceId, seq: state.appliedSeq, last: await lineageAt(state.appliedSeq) });
      if (r.status === 409 || (r.body.role === 'hub' && r.body.epoch > state.epoch)) {
        await demote(r.body);
        return;
      }
      const ps = { reachable: true, role: r.body.role, epoch: r.body.epoch, appliedSeq: r.body.applied_seq, lastSeen: Date.now() };
      peerState.set(peer.deviceId, ps);
      if (ps.role === 'standby' && ps.epoch === state.epoch && ps.appliedSeq > state.appliedSeq && !r.body.rejoining) {
        // Mirror first: the standby holds entries this hub sent but never committed (it lost power, or restarted alone).
        await serial(() => recoverFromStandby(peer));
      } else if (ps.role === 'standby' && ps.appliedSeq < state.appliedSeq) {
        await serial(async () => {
          try {
            await pushEntries(peer, await lineageAfter(ps.appliedSeq));
          } catch (e) {
            if (e instanceof NotHub) return;
            stats.mirrorFailures++;
          }
        });
      }
    } catch {
      const ps = peerState.get(peer.deviceId);
      if (ps) ps.reachable = false;
    }
  }
}

function watchdog() {
  if (state.role !== 'standby' || !state.hubDeviceId || !lastHeartbeat || state.rejoinPending) return;
  if (Date.now() - lastHeartbeat < faults.takeoverMs) {
    takeoverBlocked = null;
    return;
  }
  // Promote only when this PC holds every entry the hub reported; otherwise wait for a manager (manual promotion).
  if (state.appliedSeq >= hubSeq) promote('hub_silent').catch((e) => log('promote failed', String(e)));
  else takeoverBlocked = { reason: 'not_in_sync', appliedSeq: state.appliedSeq, hubSeq };
}

// Mirror first: the standby may hold entries this hub sent but did not commit before it lost power.
// Only a continuation of this PC's own lineage is recovered; anything else is a divergence the standby settles by rejoining.
async function recoverFromStandby(peer) {
  const r = await peerCall(peer, '/peer/journal', { after: Math.max(state.appliedSeq - 1, 0) }, 5000);
  let entries = r.body.entries;
  if (state.appliedSeq > 0) {
    const [first, ...rest] = entries;
    if (!first || !sameEntry({ command_id: first.command_id, hash: entryHash(first) }, await lineageAt(state.appliedSeq))) return 0;
    entries = rest;
  }
  for (const e of entries) await applyEntry(e);
  stats.recoveredFromStandby += entries.length;
  if (entries.length) log('recovered from standby', entries.length);
  return entries.length;
}

async function reconcileAtStart() {
  for (const peer of cfg.peers) {
    let s;
    try {
      s = (await peerCall(peer, '/peer/status', {}, 1500)).body;
    } catch {
      continue;
    }
    if (s.role === 'hub' && (state.role !== 'hub' || s.epoch > state.epoch)) {
      await demote(s);
    } else if (state.role === 'hub' && s.role === 'standby' && s.epoch === state.epoch) {
      if (s.applied_seq > state.appliedSeq) await serial(() => recoverFromStandby(peer));
      // Mirror from the first command after a restart, not only after the first heartbeat.
      peerState.set(peer.deviceId, { reachable: true, role: 'standby', epoch: s.epoch, appliedSeq: Math.max(s.applied_seq, state.appliedSeq), lastSeen: Date.now() });
    }
  }
}

// --- Snapshots for hub clients ----------------------------------------------------------------------
const sseClients = new Set();
let broadcastTimer = null;

async function snapshot() {
  const orders = await db.getAll(
    `SELECT * FROM orders WHERE status = 'open' OR id IN (SELECT order_id FROM kitchen_tickets WHERE status <> 'served') ORDER BY created_at`);
  const ids = JSON.stringify(orders.map((o) => o.id));
  const lines = await db.getAll('SELECT * FROM order_lines WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id', [ids]);
  const tickets = await db.getAll('SELECT * FROM kitchen_tickets WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id', [ids]);
  return {
    kind: 'snapshot', hub: cfg.deviceId, hub_name: cfg.name, epoch: state.epoch, seq: state.appliedSeq, at: Date.now(),
    orders: orders.map((o) => ({ ...o, lines: lines.filter((l) => l.order_id === o.id), tickets: tickets.filter((t) => t.order_id === o.id) })),
  };
}

function scheduleBroadcast() {
  if (broadcastTimer || !sseClients.size) return;
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    const data = `data: ${JSON.stringify(await snapshot())}\n\n`;
    for (const res of sseClients) res.write(data);
  }, 15);
}
db.onChange({ onChange: scheduleBroadcast }, { tables: ['orders', 'order_lines', 'kitchen_tickets', 'payments'], throttleMs: 10 });

// --- LAN server (hub clients and peers) ------------------------------------------------------------
// Pairing opens only when a manager asks for it on the hub, for 2 minutes and at most 5 wrong codes.
const PAIRING_WINDOW_MS = 120000;
const PAIRING_MAX_FAILURES = 5;
let pairing = { code: null, until: 0, failures: 0 };
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function readJson(req) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
async function clientAuth(req) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const cookie = /(?:^|;\s*)hub_client=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const token = bearer || cookie;
  if (!token) return null;
  return db.getOptional('SELECT id, kind, name FROM hub_clients WHERE token_hash = ?', [sha256(token)]);
}
const notHub = (res) => send(res, 409, { error: 'not_hub', role: state.role, epoch: state.epoch, hub_device_id: state.hubDeviceId });

const lanRoutes = {
  'GET /hub/hello': async () => [200, { device_id: cfg.deviceId, name: cfg.name, role: state.role, epoch: state.epoch, applied_seq: state.appliedSeq }],
  'GET /hub/ca': async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-pem-file' });
    res.end(cfg.caPem);
  },
  'POST /hub/pair': async (req, res) => {
    if (state.role !== 'hub') return notHub(res);
    const body = await readJson(req);
    if (!pairing.code || Date.now() > pairing.until) return [403, { error: 'pairing_closed' }];
    if (body.code !== pairing.code) {
      pairing.failures++;
      if (pairing.failures >= PAIRING_MAX_FAILURES) pairing = { code: null, until: 0, failures: 0 };
      return [403, { error: 'bad_code' }];
    }
    pairing = { code: null, until: 0, failures: 0 }; // single use
    const token = crypto.randomBytes(32).toString('base64url');
    const clientId = uuidv7();
    const c = { id: uuidv7(), user_id: cfg.cashierUserId, device_time: new Date().toISOString() };
    const payload = { client_id: clientId, kind: body.kind, name: body.name, token_hash: sha256(token) };
    const [result] = await serial(async () => [await submitOne(c, cfg.deviceId, 'HubClientPaired', { payload })]);
    const peers = [self, ...cfg.peers.map((p) => ({ device_id: p.deviceId, name: p.name, url: p.url }))];
    return [200, { client_id: clientId, token, peers, mirrored: result.mirrored }, { 'set-cookie': `hub_client=${token}; HttpOnly; Secure; SameSite=Strict; Path=/` }];
  },
  'GET /hub/events': async (req, res) => {
    if (!(await clientAuth(req))) return [401, { error: 'unpaired' }];
    if (state.role !== 'hub') return notHub(res);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(await snapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  },
  'POST /hub/commands': async (req, res) => {
    const client = await clientAuth(req);
    if (!client) return [401, { error: 'unpaired' }];
    if (state.role !== 'hub') return notHub(res);
    const { commands } = await readJson(req);
    const results = await submit(commands, client.id);
    return [results.some((r) => r.status === 'not_hub') ? 409 : 200, { results, hub: cfg.deviceId, epoch: state.epoch }];
  },
  'GET /hub/me': async (req) => {
    const client = await clientAuth(req);
    return client ? [200, { client_id: client.id, kind: client.kind, role: state.role }] : [401, { error: 'unpaired' }];
  },
  'GET /kds': async (req, res) => page(res, 'kds.html'),
  'GET /waiter': async (req, res) => page(res, 'waiter.html'),
  // Peers.
  'POST /peer/status': async () => [200, { device_id: cfg.deviceId, role: state.role, epoch: state.epoch, applied_seq: state.appliedSeq }],
  'POST /peer/heartbeat': async (req) => {
    const b = await readJson(req);
    const mine = { device_id: cfg.deviceId, role: state.role, epoch: state.epoch, applied_seq: state.appliedSeq };
    if (b.epoch < state.epoch) return [409, mine];
    if (state.role === 'hub') {
      if (b.epoch > state.epoch || cfg.deviceId > b.from) queueMicrotask(() => demote({ device_id: b.from, epoch: b.epoch }).catch((e) => log('demote failed', String(e))));
      else return [409, mine];
      return [200, { ...mine, role: 'standby' }];
    }
    lastHeartbeat = Date.now();
    hubSeq = b.seq;
    if (b.epoch > state.epoch || state.hubDeviceId !== b.from) {
      state.epoch = b.epoch;
      state.hubDeviceId = b.from;
      await persistState();
    }
    // The hub's latest entry must be the one this PC holds at that number; otherwise rejoin.
    if (state.rejoinPending) resumeRejoin(b.from, 'pending');
    else if (b.last && state.appliedSeq >= b.last.seq && !sameEntry(b.last, await lineageAt(b.last.seq))) {
      stats.divergences++;
      resumeRejoin(b.from, 'heartbeat_mismatch');
    }
    return [200, { ...mine, epoch: state.epoch, rejoining: state.rejoinPending }];
  },
  'POST /peer/mirror': async (req) => {
    const b = await readJson(req);
    if (b.epoch < state.epoch) return [409, { device_id: cfg.deviceId, role: state.role, epoch: state.epoch }];
    if (state.role === 'hub') {
      queueMicrotask(() => demote({ device_id: b.from, epoch: b.epoch }).catch((e) => log('demote failed', String(e))));
      return [503, { error: 'demoting' }];
    }
    if (state.rejoinPending) return [503, { error: 'rejoining' }];
    return serial(async () => {
      if (state.rejoinPending) return [503, { error: 'rejoining' }];
      if (b.epoch > state.epoch || state.hubDeviceId !== b.from) {
        state.epoch = b.epoch;
        state.hubDeviceId = b.from;
        await persistState();
      }
      lastHeartbeat = Date.now();
      const diverged = () => {
        stats.divergences++;
        queueMicrotask(() => resumeRejoin(b.from, 'mirror_mismatch'));
        return [200, { diverged: true, applied_seq: state.appliedSeq }];
      };
      const sorted = [...b.entries].sort((x, y) => x.seq - y.seq);
      for (const [i, e] of sorted.entries()) {
        // Never skip by number alone: the entry held at that number must be the same command with the same payload.
        if (e.seq <= state.appliedSeq) {
          if (!sameEntry({ command_id: e.command_id, hash: entryHash(e) }, await lineageAt(e.seq))) return diverged();
          continue;
        }
        if (e.seq !== state.appliedSeq + 1) return [200, { need_from: state.appliedSeq + 1, applied_seq: state.appliedSeq }];
        const before = i === 0 ? b.prev : { command_id: sorted[i - 1].command_id, hash: entryHash(sorted[i - 1]) };
        if (state.appliedSeq > 0 && !sameEntry(before, await lineageAt(state.appliedSeq))) return diverged();
        await applyEntry(e);
      }
      hubSeq = Math.max(hubSeq, state.appliedSeq);
      return [200, { ok: true, applied_seq: state.appliedSeq }];
    });
  },
  'POST /peer/journal': async (req) => {
    const { after } = await readJson(req);
    return [200, { entries: await lineageAfter(after ?? 0), epoch: state.epoch, role: state.role }];
  },
  'POST /peer/forward': async (req, res) => {
    const b = await readJson(req);
    if (state.role !== 'hub') return notHub(res);
    let applied = 0;
    await serial(async () => {
      for (const e of b.entries) {
        if (await db.getOptional('SELECT id FROM hub_journal WHERE id = ?', [e.command_id])) continue;
        const entry = { ...e, seq: state.appliedSeq + 1, epoch: state.epoch };
        // The forwarding PC already holds the entry; it learns the new sequence number at the next catch-up.
        await mirror(entry, { except: b.from });
        await applyEntry(entry);
        applied++;
      }
    });
    stats.forwardedIn += applied;
    return [200, { ok: true, applied }];
  },
};

function page(res, file) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(here, 'public', file)));
}

const lanSockets = new Set();
const lan = https.createServer({ cert: cfg.certPem, key: cfg.keyPem }, async (req, res) => {
  const url = new URL(req.url, 'https://hub');
  const route = lanRoutes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'not_found' });
  if (url.pathname.startsWith('/peer/') && req.headers['x-peer-secret'] !== cfg.peerSecret) return send(res, 401, { error: 'not_a_peer' });
  try {
    const out = await route(req, res);
    if (Array.isArray(out)) send(res, out[0], out[1], out[2]);
  } catch (e) {
    log('lan error', String(e?.stack ?? e));
    if (!res.headersSent) send(res, 500, { error: 'hub_error' });
  }
});
lan.on('connection', (socket) => {
  if (!lanOnline) return socket.destroy();
  lanSockets.add(socket);
  socket.on('close', () => lanSockets.delete(socket));
});
lan.on('tlsClientError', () => {});
await new Promise((resolve) => lan.listen(cfg.lanPort, cfg.lanHost ?? '127.0.0.1', resolve));

// --- Control port (spike only: what the scenarios do to this PC) ---------------------------------------
const ctlRoutes = {
  'GET /ctl/status': async () => {
    const queue = await db.getUploadQueueStats();
    const range = await db.getOptional('SELECT first_number, last_number FROM local_ranges WHERE business_day = ?', [cfg.businessDay]);
    return [200, {
      name: cfg.name, device_id: cfg.deviceId, runtime: process.versions.electron ? `electron ${process.versions.electron} (node ${process.versions.node})` : `node ${process.versions.node}`, role: state.role, epoch: state.epoch, applied_seq: state.appliedSeq, hub_seq: hubSeq,
      hub_device_id: state.hubDeviceId, takeover_blocked: takeoverBlocked, last_heartbeat_ms: lastHeartbeat ? Date.now() - lastHeartbeat : null,
      connected: db.currentStatus.connected, has_synced: db.currentStatus.hasSynced, pending_uploads: queue.count,
      internet: syncProxy.online, lan: lanOnline, pairing_code: state.role === 'hub' ? pairing.code : null, rejoin_pending: state.rejoinPending, range, sse_clients: sseClients.size,
      peers: Object.fromEntries(peerState), stats,
    }];
  },
  'POST /ctl/internet': async (req) => {
    const { online } = await readJson(req);
    if (online) { syncProxy.restore(); apiProxy.restore(); } else { syncProxy.cut(); apiProxy.cut(); }
    return [200, { online }];
  },
  'POST /ctl/lan': async (req) => {
    const { online } = await readJson(req);
    lanOnline = online;
    if (!online) {
      for (const s of lanSockets) s.destroy();
      for (const c of sseClients) c.destroy();
    }
    return [200, { online }];
  },
  'POST /ctl/sql': async (req) => {
    const { sql, params } = await readJson(req);
    return [200, await db.getAll(sql, params ?? [])];
  },
  // The cashier screen on this PC: the same path as a hub client, with this PC as the origin.
  'POST /ctl/submit': async (req) => {
    const { commands } = await readJson(req);
    return [200, { results: await submit(commands, cfg.deviceId) }];
  },
  // A manager opens pairing on the hub's screen; the code is shown with the QR data.
  'POST /ctl/open-pairing': async () => {
    if (state.role !== 'hub') return [409, { error: 'not_hub' }];
    pairing = { code: newCode(), until: Date.now() + PAIRING_WINDOW_MS, failures: 0 };
    return [200, { code: pairing.code, until: pairing.until }];
  },
  'POST /ctl/fault': async (req) => {
    Object.assign(faults, await readJson(req));
    return [200, faults];
  },
  'POST /ctl/promote': async () => {
    await promote('manual');
    return [200, { epoch: state.epoch }];
  },
};

http.createServer(async (req, res) => {
  const route = ctlRoutes[`${req.method} ${req.url}`];
  if (!route) return send(res, 404, { error: 'not_found' });
  try {
    const [status, body] = await route(req, res);
    send(res, status, body);
  } catch (e) {
    log('ctl error', String(e?.stack ?? e));
    send(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(cfg.ctlPort, '127.0.0.1');

// --- Start ----------------------------------------------------------------------------------------
async function ensureRange() {
  for (;;) {
    if (await db.getOptional('SELECT id FROM local_ranges WHERE business_day = ?', [cfg.businessDay])) return;
    try {
      const token = await fetchToken();
      const r = await fetch(`${api}/api/number-ranges`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ business_day: cfg.businessDay }),
      });
      if (r.ok) {
        const range = await r.json();
        await db.execute('INSERT INTO local_ranges (id, business_day, first_number, last_number) VALUES (?, ?, ?, ?)', [range.id, cfg.businessDay, range.first_number, range.last_number]);
        return;
      }
    } catch {
      // offline: try again later
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

await reconcileAtStart();
db.connect(connector, { retryDelayMs: 300, crudUploadThrottleMs: 50 });
ensureRange();
setInterval(() => heartbeatLoop().catch((e) => log('heartbeat', String(e))), HEARTBEAT_MS);
setInterval(watchdog, 250);
log('ready', { role: state.role, epoch: state.epoch, seq: state.appliedSeq });
process.stdout.write(`READY ${JSON.stringify({ role: state.role, epoch: state.epoch })}\n`);
