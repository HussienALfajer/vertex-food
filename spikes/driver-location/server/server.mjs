// Spike C server: the delivery side of the API, enough to test ADR 0009 against a real queue.
// - POST /driver/sync takes a batch from the driver app's queue: job events and duty changes in order, then a
//   compact location batch. Events are idempotent by id. Late events are accepted with device and server time;
//   impossible sequences and events on a job taken from the driver are kept and flagged, never applied.
// - Points are stored only when the driver was on duty in some fleet at the point's time; others are refused.
// - Reads apply the visibility rules: a driver sees customer details only while the job is active; a fleet's
//   dispatcher sees a driver's position only while the driver is on duty in that fleet; a customer sees the
//   driver only while the job is picked_up.
// Locations travel only in request bodies. Logs carry ids and counts, never coordinates or phones.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { resolveTime } from '../core/timebase.js';
import { decodePoints } from '../core/wire.js';

export const ACTIVE = ['offered', 'accepted', 'at_restaurant', 'picked_up'];
export const ON_ROUTE = ['accepted', 'at_restaurant', 'picked_up'];
const NEXT = {
  offered: { accepted: 'accepted', declined: 'unassigned' },
  accepted: { at_restaurant: 'at_restaurant', failed: 'failed' },
  at_restaurant: { picked_up: 'picked_up', failed: 'failed' },
  picked_up: { delivered: 'delivered', failed: 'failed', returned: 'returned' },
};
// Without a declared profile, a position older than this is stale. With one, the driver's own upload interval
// plus its fix interval plus a minute.
export const STALE_MS = 180_000;
export const STALE_MARGIN_MS = 60_000;

const SCHEMA = `
CREATE TABLE fleets (id TEXT PRIMARY KEY, kind TEXT NOT NULL, tenant_id TEXT);
CREATE TABLE memberships (driver_id TEXT NOT NULL, fleet_id TEXT NOT NULL, PRIMARY KEY (driver_id, fleet_id));
CREATE TABLE tokens (token TEXT PRIMARY KEY, role TEXT NOT NULL, subject TEXT NOT NULL);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, fleet_id TEXT NOT NULL, driver_id TEXT, state TEXT NOT NULL,
  customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_address TEXT NOT NULL,
  total_minor INTEGER NOT NULL, currency TEXT NOT NULL, picked_up_at INTEGER
);
CREATE TABLE assignments (job_id TEXT NOT NULL, driver_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE events (
  id TEXT PRIMARY KEY, arrival INTEGER NOT NULL, driver_id TEXT NOT NULL, type TEXT NOT NULL, job_id TEXT, fleet_id TEXT,
  status TEXT NOT NULL, reason TEXT, device_wall INTEGER NOT NULL, t INTEGER NOT NULL, basis TEXT NOT NULL,
  server_time INTEGER NOT NULL, lat REAL, lng REAL, acc REAL
);
CREATE TABLE duty (driver_id TEXT NOT NULL, fleet_id TEXT NOT NULL, on_at INTEGER NOT NULL, off_at INTEGER);
CREATE TABLE points (
  driver_id TEXT NOT NULL, device_t INTEGER NOT NULL, t INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, acc REAL, speed REAL,
  heading REAL, basis TEXT NOT NULL, received_at INTEGER NOT NULL,
  UNIQUE (driver_id, device_t)
);
CREATE TABLE diag (driver_id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE profiles (driver_id TEXT PRIMARY KEY, upload_ms INTEGER NOT NULL, fix_ms INTEGER NOT NULL);
CREATE TABLE refused_points (driver_id TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL);
`;

// Synthetic fixtures: two restaurant fleets and the Vertex fleet. d3 is in R1's fleet and the Vertex fleet.
export function seed(db) {
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  run("INSERT INTO fleets VALUES ('fleet-r1', 'restaurant', 'tenant-r1'), ('fleet-r2', 'restaurant', 'tenant-r2'), ('fleet-vx', 'vertex', NULL)");
  run("INSERT INTO memberships VALUES ('d1', 'fleet-r1'), ('d2', 'fleet-r2'), ('d3', 'fleet-r1'), ('d3', 'fleet-vx')");
  run(`INSERT INTO tokens VALUES ('tok-d1', 'driver', 'd1'), ('tok-d2', 'driver', 'd2'), ('tok-d3', 'driver', 'd3'),
       ('disp-r1', 'dispatch', 'fleet-r1'), ('disp-r2', 'dispatch', 'fleet-r2'), ('disp-vx', 'dispatch', 'fleet-vx')`);
}

export function startServer({ port = 0, host = '127.0.0.1', log = () => {}, now = () => Date.now() } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  seed(db);
  const q = (sql) => db.prepare(sql);
  const stats = { requests: 0, urls: [] };

  function createJob({ id, tenant, fleet, driver, customer, totalMinor, currency = 'SYP', customerToken }) {
    q('INSERT INTO jobs (id, tenant_id, fleet_id, driver_id, state, customer_name, customer_phone, customer_address, total_minor, currency) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      id, tenant, fleet, driver, 'offered', customer.name, customer.phone, customer.address, totalMinor, currency,
    );
    q('INSERT INTO assignments VALUES (?,?,?)').run(id, driver, now());
    if (customerToken) q("INSERT INTO tokens VALUES (?, 'customer', ?)").run(customerToken, id);
  }

  function reassign(jobId, driver) {
    q("UPDATE jobs SET driver_id = ?, state = 'offered' WHERE id = ?").run(driver, jobId);
    q('INSERT INTO assignments VALUES (?,?,?)').run(jobId, driver, now());
  }

  let arrival = 0;
  function applyEvent(driverId, ev, device, serverNow) {
    const seen = q('SELECT status, reason FROM events WHERE id = ?').get(ev.id);
    // A resent event gets its first answer back, so a flagged or rejected outcome survives a lost answer.
    if (seen) return { id: ev.id, status: 'duplicate', original: seen.status, ...(seen.reason ? { reason: seen.reason } : {}) };
    const time = resolveTime(ev, device, serverNow);
    let status = 'accepted';
    let reason = null;
    let jobId = null;
    let fleetId = null;
    if (ev.type === 'duty_on' || ev.type === 'duty_off') {
      fleetId = ev.fleet;
      const member = q('SELECT 1 FROM memberships WHERE driver_id = ? AND fleet_id = ?').get(driverId, fleetId);
      const open = q('SELECT rowid, on_at FROM duty WHERE driver_id = ? AND fleet_id = ? AND off_at IS NULL').get(driverId, fleetId);
      if (!member) [status, reason] = ['rejected', 'not_member'];
      else if (ev.type === 'duty_on' && open) [status, reason] = ['flagged', 'already_on_duty'];
      else if (ev.type === 'duty_off' && !open) [status, reason] = ['flagged', 'not_on_duty'];
      else if (ev.type === 'duty_on') q('INSERT INTO duty VALUES (?,?,?,NULL)').run(driverId, fleetId, time.t);
      else {
        // A session never ends before it starts; a clock that says so is flagged on the event.
        if (time.t < open.on_at) reason = 'time_backwards';
        q('UPDATE duty SET off_at = ? WHERE rowid = ?').run(Math.max(time.t, open.on_at), open.rowid);
      }
    } else {
      jobId = ev.jobId;
      const job = q('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) [status, reason] = ['rejected', 'unknown_job'];
      else if (job.driver_id !== driverId) {
        const had = q('SELECT 1 FROM assignments WHERE job_id = ? AND driver_id = ?').get(jobId, driverId);
        [status, reason] = had ? ['flagged', 'reassigned'] : ['rejected', 'not_your_job'];
      } else {
        fleetId = job.fleet_id;
        const to = NEXT[job.state]?.[ev.type];
        if (!to) [status, reason] = ['flagged', 'impossible_sequence'];
        else {
          const last = q("SELECT MAX(t) AS t FROM events WHERE job_id = ? AND status = 'accepted'").get(jobId);
          if (last.t != null && time.t < last.t) reason = 'time_backwards';
          q('UPDATE jobs SET state = ?, driver_id = ?, picked_up_at = COALESCE(?, picked_up_at) WHERE id = ?').run(
            to, to === 'unassigned' ? null : driverId, to === 'picked_up' ? time.t : null, jobId,
          );
        }
      }
    }
    if (status === 'accepted' && time.basis === 'estimated') reason = reason ?? 'time_estimated';
    q('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      ev.id, ++arrival, driverId, ev.type, jobId, fleetId, status, reason, ev.wall, time.t, time.basis, serverNow,
      ev.fix?.lat ?? null, ev.fix?.lng ?? null, ev.fix?.acc ?? null,
    );
    return { id: ev.id, status, ...(reason ? { reason } : {}) };
  }

  function applyPoints(driverId, batch, device, serverNow) {
    if (!batch) return { accepted: 0, refused: 0, duplicate: 0 };
    let accepted = 0;
    let refused = 0;
    let duplicate = 0;
    const onDuty = q('SELECT 1 FROM duty WHERE driver_id = ? AND on_at <= ? AND (off_at IS NULL OR off_at >= ?) LIMIT 1');
    // A point has no id: the device's fix time is its key, so a batch sent again stores nothing twice.
    const ins = q('INSERT OR IGNORE INTO points VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const p of decodePoints(batch)) {
      const cb = resolveTime({ wall: p.cbWall, mono: p.cbMono, run: p.run }, device, serverNow);
      const t = cb.t - (p.cbWall - p.t);
      if (!onDuty.get(driverId, t, t)) {
        refused++;
        continue;
      }
      if (ins.run(driverId, p.t, t, p.lat, p.lng, p.acc, p.speed, p.heading, cb.basis, serverNow).changes) accepted++;
      else duplicate++;
    }
    if (refused) q("INSERT INTO refused_points VALUES (?, 'off_duty', ?, ?)").run(driverId, refused, serverNow);
    return { accepted, refused, duplicate };
  }

  function sync(driverId, body) {
    const serverNow = now();
    db.exec('BEGIN');
    try {
      const events = body.events.map((ev) => applyEvent(driverId, ev, body.device, serverNow));
      const points = applyPoints(driverId, body.points, body.device, serverNow);
      // The sampling profile the app is on, so dispatch knows when its silence means trouble.
      if (body.profile) q('INSERT OR REPLACE INTO profiles VALUES (?,?,?)').run(driverId, body.profile.uploadEveryMs, body.profile.timeIntervalMs);
      // The spike app's own counters (battery, app state, queue length): no locations.
      if (body.diag) q('INSERT INTO diag VALUES (?,?,?)').run(driverId, serverNow, JSON.stringify(body.diag));
      db.exec('COMMIT');
      return { serverNow, events, points };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function driverJobs(driverId) {
    const active = q(`SELECT * FROM jobs WHERE driver_id = ? AND state IN (${ACTIVE.map(() => '?').join(',')})`).all(driverId, ...ACTIVE);
    const past = q(`SELECT DISTINCT j.id, j.state FROM jobs j JOIN assignments a ON a.job_id = j.id
                    WHERE a.driver_id = ? AND NOT (j.driver_id IS ? AND j.state IN (${ACTIVE.map(() => '?').join(',')}))`).all(driverId, driverId, ...ACTIVE);
    return {
      active: active.map((j) => ({
        id: j.id, state: j.state, total: { minor: j.total_minor, currency: j.currency },
        customer: { name: j.customer_name, phone: j.customer_phone, address: j.customer_address },
      })),
      past: past.map((j) => ({ id: j.id, state: j.state })),
    };
  }

  function dispatchDrivers(fleetId, at = now()) {
    return q('SELECT driver_id FROM memberships WHERE fleet_id = ?').all(fleetId).map(({ driver_id }) => {
      const session = q('SELECT on_at FROM duty WHERE driver_id = ? AND fleet_id = ? AND off_at IS NULL').get(driver_id, fleetId);
      if (!session) return { driver: driver_id, onDuty: false };
      // On duty here, but carrying another fleet's job (a person in two fleets): the route leads to another
      // restaurant and its customer, so this fleet sees that the driver is busy, not where.
      const elsewhere = q(`SELECT 1 FROM jobs WHERE driver_id = ? AND fleet_id <> ? AND state IN (${ON_ROUTE.map(() => '?').join(',')}) LIMIT 1`).get(driver_id, fleetId, ...ON_ROUTE);
      if (elsewhere) return { driver: driver_id, onDuty: true, busyElsewhere: true };
      const p = q('SELECT t, lat, lng, acc FROM points WHERE driver_id = ? AND t >= ? ORDER BY t DESC LIMIT 1').get(driver_id, session.on_at);
      const prof = q('SELECT upload_ms, fix_ms FROM profiles WHERE driver_id = ?').get(driver_id);
      const staleAfterMs = prof ? prof.upload_ms + prof.fix_ms + STALE_MARGIN_MS : STALE_MS;
      return { driver: driver_id, onDuty: true, position: p ?? null, stale: !p || at - p.t > staleAfterMs, staleAfterMs };
    });
  }

  function customerTracking(jobId) {
    const job = q('SELECT state, driver_id, picked_up_at FROM jobs WHERE id = ?').get(jobId);
    if (!job || job.state !== 'picked_up') return { visible: false };
    const p = q('SELECT t, lat, lng FROM points WHERE driver_id = ? AND t >= ? ORDER BY t DESC LIMIT 1').get(job.driver_id, job.picked_up_at);
    return { visible: true, position: p ?? null };
  }

  const server = http.createServer((req, res) => {
    const started = performance.now();
    stats.requests++;
    stats.urls.push(`${req.method} ${req.url}`);
    const send = (code, obj, note = '') => {
      const s = JSON.stringify(obj);
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
      res.end(s);
      log(`${req.method} ${req.url} ${code}${note} ${Math.round(performance.now() - started)}ms`);
    };
    const tok = q('SELECT role, subject FROM tokens WHERE token = ?').get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!tok) return send(401, { error: 'unauthenticated' });
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        if (req.method === 'POST' && req.url === '/driver/sync' && tok.role === 'driver') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const r = sync(tok.subject, body);
          const acc = r.events.filter((e) => e.status === 'accepted').length;
          const dup = r.events.filter((e) => e.status === 'duplicate').length;
          const other = r.events.length - acc - dup;
          return send(200, r, ` driver=${tok.subject} events=${r.events.length} accepted=${acc} duplicate=${dup} other=${other} points=${r.points.accepted} refused=${r.points.refused} bytes=${size}`);
        }
        if (req.method === 'GET' && req.url === '/driver/jobs' && tok.role === 'driver') return send(200, driverJobs(tok.subject), ` driver=${tok.subject}`);
        if (req.method === 'GET' && req.url === '/dispatch/drivers' && tok.role === 'dispatch') return send(200, dispatchDrivers(tok.subject), ` fleet=${tok.subject}`);
        if (req.method === 'GET' && req.url === '/customer/tracking' && tok.role === 'customer') return send(200, customerTracking(tok.subject), ` job=${tok.subject}`);
        return send(404, { error: 'not_found' });
      } catch (e) {
        return send(400, { error: 'bad_request' }, ` error=${e.name}`);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        url: `http://${host}:${server.address().port}`,
        port: server.address().port,
        db,
        stats,
        createJob,
        reassign,
        driverJobs,
        dispatchDrivers,
        customerTracking,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

// `node server/server.mjs [port] [host]`: a standalone server, for a manual run against a phone.
if (import.meta.main) {
  const s = await startServer({ port: Number(process.argv[2] ?? 8787), host: process.argv[3] ?? '0.0.0.0', log: (l) => console.log(new Date().toISOString(), l) });
  console.log(`spike server on ${s.url}`);
}
