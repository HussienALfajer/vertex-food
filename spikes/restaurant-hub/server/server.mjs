// Spike API: device tokens, number ranges, the command endpoint that re-executes order commands, a cloud order.
// Throwaway code. Synthetic data only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as jose from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { seed } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT ?? 6070);
const PG_URL = 'postgres://%s:spike-only-password@127.0.0.1:54327/food';
const AUDIENCE = 'vertex-food-sync';
const RANGE_SIZE = 500;

// The API runs as food_app (RLS applies). Admin is used only for spike helpers and device lookup.
const app = new pg.Pool({ connectionString: PG_URL.replace('%s', 'food_app') });
const admin = new pg.Pool({ connectionString: PG_URL.replace('%s', 'postgres') });
// An idle connection reset (seen through Docker Desktop's port proxy) must not take the API down.
for (const pool of [app, admin]) pool.on('error', (e) => console.error('idle pg client error', e.code ?? e.message));

// --- Keys and device tokens (Vertex Shifa ADR 0021) ----------------------------------------
const keyFile = path.join(here, '..', '.data', 'jwt-key.json');
async function loadKeys() {
  if (fs.existsSync(keyFile)) {
    const jwk = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return { privateKey: await jose.importJWK(jwk.private, 'EdDSA'), publicJwk: jwk.public };
  }
  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', { extractable: true });
  const publicJwk = { ...(await jose.exportJWK(publicKey)), kid: 'spike-1', alg: 'EdDSA' };
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify({ private: await jose.exportJWK(privateKey), public: publicJwk }));
  return { privateKey, publicJwk };
}
const keys = await loadKeys();

const signDeviceToken = (device) =>
  new jose.SignJWT({ tenant_id: device.tenant_id, branch_id: device.branch_id, device_id: device.id })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'spike-1' })
    .setSubject(device.id)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);

async function verifyDeviceToken(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const { payload } = await jose.jwtVerify(token, jose.createLocalJWKSet({ keys: [keys.publicJwk] }), { audience: AUDIENCE });
  const { rows } = await admin.query('SELECT revoked_at FROM devices WHERE id = $1', [payload.device_id]);
  if (!rows[0] || rows[0].revoked_at) throw Object.assign(new Error('device_revoked'), { status: 403 });
  return payload;
}

async function inTenant(tenantId, fn) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- Commands ---------------------------------------------------------------------------------
const Envelope = z.object({
  id: z.uuid(),
  type: z.string(),
  user_id: z.uuid(),
  origin_device_id: z.uuid(),
  executed_by_device_id: z.uuid(),
  hub_epoch: z.int().nonnegative(),
  hub_seq: z.int().positive(),
  device_time: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
const minor = z.int().nonnegative();
const OpenOrder = z.object({
  order_id: z.uuid(),
  number: z.int().positive(),
  business_day: z.iso.date(),
  channel: z.enum(['pos', 'waiter']),
  table_id: z.uuid().nullable(),
  currency: z.string().length(3),
});
const AddLines = z.object({
  order_id: z.uuid(),
  lines: z.array(z.object({
    line_id: z.uuid(), item_id: z.uuid(), price_id: z.uuid(), quantity: z.int().positive(),
    // The device's snapshot. The server checks it against the price row and never trusts the amounts.
    name: z.string(), station: z.string(), unit_minor: minor,
  })).min(1),
});
const SendToKitchen = z.object({
  order_id: z.uuid(),
  tickets: z.array(z.object({ ticket_id: z.uuid(), station: z.string(), line_ids: z.array(z.uuid()).min(1) })).min(1),
});
const SetTicketStatus = z.object({ ticket_id: z.uuid(), status: z.enum(['preparing', 'ready', 'served']) });
const TakePayment = z.object({
  payment_id: z.uuid(), order_id: z.uuid(), amount_minor: z.int().positive(), currency: z.string().length(3), method: z.enum(['cash']),
});

async function nextEventSeq(db, orderId) {
  const { rows: [r] } = await db.query('SELECT coalesce(max(seq), 0) + 1 AS seq FROM order_events WHERE order_id = $1', [orderId]);
  return r.seq;
}
async function addEvent(db, auth, cmd, orderId, type, payload) {
  await db.query(
    `INSERT INTO order_events (tenant_id, branch_id, order_id, seq, type, command_id, origin_device_id, device_time, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [auth.tenant_id, auth.branch_id, orderId, await nextEventSeq(db, orderId), type, cmd.id, cmd.origin_device_id, cmd.device_time, JSON.stringify(payload)],
  );
}
const lockOrder = async (db, auth, orderId) =>
  (await db.query('SELECT * FROM orders WHERE id = $1 AND branch_id = $2 FOR UPDATE', [orderId, auth.branch_id])).rows[0];

async function openOrder(db, auth, cmd, p) {
  if (await lockOrder(db, auth, p.order_id)) return { outcome: 'rejected', detail: { reason: 'order_exists' } };
  const { rows: [range] } = await db.query(
    'SELECT * FROM number_ranges WHERE branch_id = $1 AND device_id = $2 AND business_day = $3 AND $4 BETWEEN first_number AND last_number',
    [auth.branch_id, cmd.executed_by_device_id, p.business_day, p.number],
  );
  const detail = range ? {} : { warning: 'number_outside_range' };
  const insert = (number) => db.query(
    `INSERT INTO orders (id, tenant_id, branch_id, business_day, number, channel, table_id, status, currency, opened_by_device_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10)`,
    [p.order_id, auth.tenant_id, auth.branch_id, p.business_day, number, p.channel, p.table_id, p.currency, cmd.origin_device_id, cmd.device_time],
  );
  await db.query('SAVEPOINT num');
  try {
    await insert(p.number);
  } catch (e) {
    if (e.code !== '23505') throw e;
    // Never drop the order: keep it without a number and say so.
    await db.query('ROLLBACK TO SAVEPOINT num');
    await insert(null);
    await addEvent(db, auth, cmd, p.order_id, 'opened', p);
    return { outcome: 'adjusted', detail: { reason: 'number_taken', number: p.number } };
  }
  await addEvent(db, auth, cmd, p.order_id, 'opened', p);
  return { outcome: 'accepted', detail: { number: p.number, ...detail } };
}

async function addLines(db, auth, cmd, p) {
  const order = await lockOrder(db, auth, p.order_id);
  if (!order) return { outcome: 'rejected', detail: { reason: 'order_not_found' } };
  if (order.status !== 'open') return { outcome: 'rejected', detail: { reason: 'order_closed' } };
  const superseded = [];
  const corrected = [];
  for (const l of p.lines) {
    const { rows: [price] } = await db.query(
      `SELECT p.*, m.name, m.station FROM prices p JOIN menu_items m ON m.id = p.item_id
        WHERE p.id = $1 AND p.item_id = $2 AND p.branch_id = $3`, [l.price_id, l.item_id, auth.branch_id]);
    if (!price) return { outcome: 'rejected', detail: { reason: 'price_not_found', line_id: l.line_id } };
    if (price.currency !== order.currency) return { outcome: 'rejected', detail: { reason: 'currency_mismatch', line_id: l.line_id } };
    // The device used the price it held. A newer price it could not see (offline) is reported, not applied.
    const { rows: [newer] } = await db.query(
      'SELECT id FROM prices WHERE item_id = $1 AND effective_from > $2 AND effective_from <= $3 LIMIT 1',
      [l.item_id, price.effective_from, cmd.device_time]);
    if (newer) superseded.push(l.line_id);
    const unit = Number(price.amount_minor);
    if (unit !== l.unit_minor) corrected.push({ line_id: l.line_id, device_unit_minor: l.unit_minor, unit_minor: unit });
    await db.query(
      `INSERT INTO order_lines (id, tenant_id, branch_id, order_id, item_id, price_id, name, station, unit_minor, quantity, line_minor, currency, added_by_device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [l.line_id, auth.tenant_id, auth.branch_id, order.id, l.item_id, l.price_id, price.name, price.station, unit, l.quantity, unit * l.quantity, price.currency, cmd.origin_device_id]);
  }
  const { rows: [sum] } = await db.query('SELECT coalesce(sum(line_minor), 0)::bigint AS s FROM order_lines WHERE order_id = $1', [order.id]);
  await db.query('UPDATE orders SET subtotal_minor = $2 WHERE id = $1', [order.id, sum.s]);
  await addEvent(db, auth, cmd, order.id, 'lines_added', p);
  const detail = { subtotal_minor: Number(sum.s), ...(superseded.length ? { price_superseded: superseded } : {}) };
  if (corrected.length) return { outcome: 'adjusted', detail: { ...detail, reason: 'price_corrected', corrected } };
  return { outcome: 'accepted', detail };
}

async function sendToKitchen(db, auth, cmd, p) {
  const order = await lockOrder(db, auth, p.order_id);
  if (!order) return { outcome: 'rejected', detail: { reason: 'order_not_found' } };
  for (const t of p.tickets) {
    const { rows } = await db.query('SELECT id, station, ticket_id FROM order_lines WHERE order_id = $1 AND id = ANY($2)', [order.id, t.line_ids]);
    if (rows.length !== t.line_ids.length || rows.some((r) => r.ticket_id || r.station !== t.station)) {
      return { outcome: 'rejected', detail: { reason: 'invalid_ticket', ticket_id: t.ticket_id } };
    }
    await db.query(
      `INSERT INTO kitchen_tickets (id, tenant_id, branch_id, order_id, order_number, station, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'new',$7,$7)`,
      [t.ticket_id, auth.tenant_id, auth.branch_id, order.id, order.number, t.station, cmd.device_time]);
    await db.query('UPDATE order_lines SET ticket_id = $2 WHERE id = ANY($1)', [t.line_ids, t.ticket_id]);
  }
  await addEvent(db, auth, cmd, order.id, 'sent_to_kitchen', p);
  return { outcome: 'accepted', detail: {} };
}

const TICKET_RANK = { new: 0, preparing: 1, ready: 2, served: 3 };
async function setTicketStatus(db, auth, cmd, p) {
  const { rows: [ticket] } = await db.query('SELECT * FROM kitchen_tickets WHERE id = $1 AND branch_id = $2 FOR UPDATE', [p.ticket_id, auth.branch_id]);
  if (!ticket) return { outcome: 'rejected', detail: { reason: 'ticket_not_found' } };
  if (TICKET_RANK[p.status] < TICKET_RANK[ticket.status]) return { outcome: 'rejected', detail: { reason: 'invalid_transition', from: ticket.status, to: p.status } };
  await db.query('UPDATE kitchen_tickets SET status = $2, updated_at = $3 WHERE id = $1', [ticket.id, p.status, cmd.device_time]);
  await addEvent(db, auth, cmd, ticket.order_id, 'ticket_status', p);
  return { outcome: 'accepted', detail: {} };
}

async function takePayment(db, auth, cmd, p) {
  const order = await lockOrder(db, auth, p.order_id);
  if (!order) return { outcome: 'rejected', detail: { reason: 'order_not_found' } };
  if (p.currency !== order.currency) return { outcome: 'rejected', detail: { reason: 'currency_mismatch' } };
  // A payment is never lost (ADR 0008): it is recorded even if it overpays the order.
  await db.query(
    'INSERT INTO payments (id, tenant_id, branch_id, order_id, amount_minor, currency, method, command_id, taken_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [p.payment_id, auth.tenant_id, auth.branch_id, order.id, p.amount_minor, p.currency, p.method, cmd.id, cmd.device_time]);
  const paid = Number(order.paid_minor) + p.amount_minor;
  const subtotal = Number(order.subtotal_minor);
  await db.query('UPDATE orders SET paid_minor = $2, status = $3 WHERE id = $1', [order.id, paid, paid >= subtotal ? 'paid' : 'open']);
  await addEvent(db, auth, cmd, order.id, 'payment_taken', p);
  if (paid > subtotal) return { outcome: 'adjusted', detail: { reason: 'overpaid', overpaid_minor: paid - subtotal } };
  return { outcome: 'accepted', detail: { paid_minor: paid } };
}

const handlers = {
  OpenOrder: { schema: OpenOrder, run: openOrder },
  AddLines: { schema: AddLines, run: addLines },
  SendToKitchen: { schema: SendToKitchen, run: sendToKitchen },
  SetTicketStatus: { schema: SetTicketStatus, run: setTicketStatus },
  TakePayment: { schema: TakePayment, run: takePayment },
};

const sha256 = (cmd) => crypto.createHash('sha256').update(JSON.stringify([cmd.type, cmd.origin_device_id, cmd.executed_by_device_id, cmd.payload])).digest('hex');
const stats = { executed: 0, replays: 0, replayMismatches: 0 };

// Idempotent by command id, whichever PC uploads it. Always answers with an outcome (Vertex Shifa ADR 0021).
async function executeCommand(auth, raw) {
  const parsed = Envelope.safeParse(raw);
  if (!parsed.success) return { id: raw?.id ?? null, outcome: 'rejected', detail: { reason: 'invalid_envelope' } };
  const cmd = parsed.data;
  const hash = sha256(cmd);
  return inTenant(auth.tenant_id, async (db) => {
    // The hub and its standby both upload the same commands; serialize them on the command id.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [cmd.id]);
    const { rows: [seen] } = await db.query('SELECT outcome, outcome_detail, payload_sha256 FROM command_log WHERE id = $1', [cmd.id]);
    if (seen) {
      stats.replays++;
      const mismatch = seen.payload_sha256 !== hash;
      if (mismatch) stats.replayMismatches++;
      return { id: cmd.id, outcome: seen.outcome, detail: seen.outcome_detail, replay: true, ...(mismatch ? { replay_payload_mismatch: true } : {}) };
    }
    const { rows: [executor] } = await db.query('SELECT id FROM devices WHERE id = $1 AND branch_id = $2 AND revoked_at IS NULL', [cmd.executed_by_device_id, auth.branch_id]);
    const handler = handlers[cmd.type];
    const payload = handler?.schema.safeParse(cmd.payload);
    let result;
    if (!executor) result = { outcome: 'rejected', detail: { reason: 'executor_not_in_branch' } };
    else if (!handler) result = { outcome: 'rejected', detail: { reason: 'unknown_command' } };
    else if (!payload.success) result = { outcome: 'rejected', detail: { reason: 'invalid_payload', issues: payload.error.issues.slice(0, 3) } };
    else {
      await db.query('SAVEPOINT cmd');
      try {
        result = await handler.run(db, auth, cmd, payload.data);
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT cmd');
        console.error(e);
        result = { outcome: 'rejected', detail: { reason: 'server_error', code: e.code ?? null } };
      }
    }
    await db.query(
      `INSERT INTO command_log (id, tenant_id, branch_id, uploaded_by_device_id, executed_by_device_id, origin_device_id, user_id, type, payload,
         payload_sha256, hub_epoch, hub_seq, device_time, outcome, outcome_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [cmd.id, auth.tenant_id, auth.branch_id, auth.device_id, cmd.executed_by_device_id, cmd.origin_device_id, cmd.user_id, cmd.type,
        JSON.stringify(cmd.payload), hash, cmd.hub_epoch, cmd.hub_seq, cmd.device_time, result.outcome, JSON.stringify(result.detail)]);
    stats.executed++;
    return { id: cmd.id, ...result };
  });
}

// A daily block of order numbers per device, allocated while online (ADR 0008).
async function numberRange(auth, businessDay) {
  return inTenant(auth.tenant_id, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [auth.branch_id + businessDay]);
    const { rows: [mine] } = await db.query('SELECT * FROM number_ranges WHERE branch_id = $1 AND device_id = $2 AND business_day = $3', [auth.branch_id, auth.device_id, businessDay]);
    if (mine) return mine;
    const { rows: [last] } = await db.query('SELECT coalesce(max(last_number), 0) AS n FROM number_ranges WHERE branch_id = $1 AND business_day = $2', [auth.branch_id, businessDay]);
    const { rows: [created] } = await db.query(
      `INSERT INTO number_ranges (id, tenant_id, branch_id, device_id, business_day, first_number, last_number) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uuidv7(), auth.tenant_id, auth.branch_id, auth.device_id, businessDay, last.n + 1, last.n + RANGE_SIZE]);
    return created;
  });
}

// An order that arrives through the cloud (marketplace), to show the hub forwards synced orders to the kitchen.
async function cloudOrder(body) {
  return inTenant(body.tenant_id, async (db) => {
    const orderId = uuidv7();
    const { rows: [n] } = await db.query("SELECT 9000 + count(*)::int + 1 AS n FROM orders WHERE branch_id = $1 AND channel = 'marketplace'", [body.branch_id]);
    const { rows: [item] } = await db.query(
      `SELECT m.*, p.id AS price_id, p.amount_minor, p.currency FROM menu_items m JOIN prices p ON p.item_id = m.id
        WHERE m.id = $1 ORDER BY p.effective_from DESC LIMIT 1`, [body.item_id]);
    await db.query(
      `INSERT INTO orders (id, tenant_id, branch_id, business_day, number, channel, status, currency, subtotal_minor, created_at)
       VALUES ($1,$2,$3,$4,$5,'marketplace','open',$6,$7, now())`,
      [orderId, body.tenant_id, body.branch_id, body.business_day, n.n, item.currency, item.amount_minor]);
    const ticketId = uuidv7();
    await db.query(
      `INSERT INTO kitchen_tickets (id, tenant_id, branch_id, order_id, order_number, station, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'new', now(), now())`, [ticketId, body.tenant_id, body.branch_id, orderId, n.n, item.station]);
    await db.query(
      `INSERT INTO order_lines (id, tenant_id, branch_id, order_id, item_id, price_id, name, station, unit_minor, quantity, line_minor, currency, ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$9,$10,$11)`,
      [uuidv7(), body.tenant_id, body.branch_id, orderId, item.id, item.price_id, item.name, item.station, item.amount_minor, item.currency, ticketId]);
    return { order_id: orderId, ticket_id: ticketId, number: n.n };
  });
}

// --- HTTP -------------------------------------------------------------------------------------
async function readJson(req) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const routes = {
  'GET /api/auth/keys': async () => [200, { keys: [keys.publicJwk] }],
  'POST /api/auth/device-token': async (req) => {
    const { device_id } = await readJson(req);
    const { rows: [device] } = await admin.query('SELECT * FROM devices WHERE id = $1', [device_id]);
    if (!device) return [404, { error: 'unknown_device' }];
    if (device.revoked_at) return [403, { error: 'device_revoked' }];
    return [200, { token: await signDeviceToken(device), expires_in: 300 }];
  },
  'POST /api/number-ranges': async (req) => {
    const auth = await verifyDeviceToken(req);
    const { business_day } = await readJson(req);
    return [200, await numberRange(auth, business_day)];
  },
  'POST /api/commands': async (req) => {
    const auth = await verifyDeviceToken(req);
    const { commands } = await readJson(req);
    const results = [];
    for (const c of commands) results.push(await executeCommand(auth, c));
    return [200, { results }];
  },
  'POST /api/cloud/order': async (req) => [201, await cloudOrder(await readJson(req))],
  // Spike-only helpers.
  'POST /api/spike/reset': async () => {
    Object.assign(stats, { executed: 0, replays: 0, replayMismatches: 0 });
    return [200, await seed(admin)];
  },
  'GET /api/spike/stats': async () => [200, stats],
  'POST /api/spike/price': async (req) => {
    const b = await readJson(req);
    await admin.query('INSERT INTO prices SELECT $1, tenant_id, branch_id, id, $3, $4, now() FROM menu_items WHERE id = $2', [uuidv7(), b.item_id, b.amount_minor, b.currency]);
    return [200, {}];
  },
  'POST /api/spike/sql': async (req) => {
    const { sql, params } = await readJson(req);
    const r = await admin.query(sql, params ?? []);
    return [200, Array.isArray(r) ? r.map((x) => x.rows) : r.rows];
  },
};

http.createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url}`];
  if (!route) return send(res, 404, { error: 'not_found' });
  try {
    const [status, body] = await route(req);
    send(res, status, body);
  } catch (e) {
    const status = e.status ?? (e.code?.startsWith?.('ERR_JW') ? 401 : 500);
    if (status === 500) console.error(e);
    send(res, status, { error: e.message });
  }
  // Loopback only: the spike-only helpers (`/api/spike/*`) run SQL as the superuser.
}).listen(PORT, '127.0.0.1', () => console.log(`spike api on 127.0.0.1:${PORT}`));
