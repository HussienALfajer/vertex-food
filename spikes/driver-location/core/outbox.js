// The driver app's durable queue (ADR 0009 "weak network", v1-scope F32).
// - Job events and duty changes are written to SQLite before the screen shows them, with a UUIDv7 id and the
//   device's time stamp (timebase.js). They are sent in the order they were recorded, never reordered.
// - Location points go to a separate table and travel in compact batches (wire.js).
// - A batch is removed only when the server has answered for it. An event's answer is final whatever it says
//   (accepted, duplicate, flagged, rejected); a rejected or flagged event is kept in `outcomes` for the driver to
//   see, never dropped silently. A lost answer means the same batch, with the same ids, is sent again.
//
// `db` is a synchronous adapter: { run(sql, params), all(sql, params), tx(fn) }. node:sqlite in Node,
// expo-sqlite's sync API in the app. The queue itself is plain JavaScript shared by both.

import { encodePoints } from './wire.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     body TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS track (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     run TEXT NOT NULL,
     t INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
     acc REAL, speed REAL, heading REAL,
     cb_wall INTEGER NOT NULL, cb_mono INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS outcomes (
     id TEXT PRIMARY KEY, status TEXT NOT NULL, reason TEXT, body TEXT NOT NULL
   )`,
];

export class Outbox {
  constructor(db, { clock, newId }) {
    this.db = db;
    this.clock = clock;
    this.newId = newId;
    for (const s of SCHEMA) db.run(s, []);
  }

  // A job event ({ type, jobId, reason? }) or a duty change ({ type: 'duty_on' | 'duty_off', fleet }).
  // `fix` is the latest location when the event is a job event and the driver is on duty, else null.
  record(event, fix = null) {
    const stamp = this.clock.stamp();
    const id = this.newId(stamp.wall);
    const body = { id, ...event, ...stamp, fix: fix ? roundFix(fix) : null };
    this.db.run('INSERT INTO outbox (id, body) VALUES (?, ?)', [id, JSON.stringify(body)]);
    return id;
  }

  // Locations from the OS: [{ t, lat, lng, acc, speed, heading }]. They share the stamp of the callback that
  // delivered them, which lets the server place a deferred batch in time.
  addPoints(points) {
    if (!points.length) return;
    const s = this.clock.stamp();
    this.db.tx(() => {
      for (const p of points) {
        this.db.run('INSERT INTO track (run, t, lat, lng, acc, speed, heading, cb_wall, cb_mono) VALUES (?,?,?,?,?,?,?,?,?)', [
          s.run, p.t, p.lat, p.lng, p.acc ?? null, p.speed ?? null, p.heading ?? null, s.wall, s.mono,
        ]);
      }
    });
  }

  counts() {
    const [e] = this.db.all('SELECT COUNT(*) AS n FROM outbox', []);
    const [p] = this.db.all('SELECT COUNT(*) AS n FROM track', []);
    return { events: Number(e.n), points: Number(p.n) };
  }

  // The next request body. Events: the oldest first, all of them up to `maxEvents`. Points: the newest point
  // first (the live position after a blackout), then the oldest backlog of the same run.
  nextBatch({ maxEvents = 50, maxPoints = 300 } = {}) {
    const events = this.db.all('SELECT seq, body FROM outbox ORDER BY seq LIMIT ?', [maxEvents]);
    const newest = this.db.all('SELECT * FROM track ORDER BY seq DESC LIMIT 1', [])[0];
    let points = [];
    if (newest) {
      const backlog = this.db.all('SELECT * FROM track WHERE run = ? AND seq <> ? ORDER BY seq LIMIT ?', [
        newest.run, newest.seq, maxPoints - 1,
      ]);
      points = [...backlog, newest].sort((a, b) => a.seq - b.seq);
      // Older runs are sent in their own batches once the newest run is done.
      if (backlog.length === 0) {
        const older = this.db.all('SELECT * FROM track WHERE run <> ? ORDER BY seq LIMIT 1', [newest.run])[0];
        if (older) points = this.db.all('SELECT * FROM track WHERE run = ? ORDER BY seq LIMIT ?', [older.run, maxPoints]);
      }
    }
    if (!events.length && !points.length) return null;
    const run = points[0]?.run;
    return {
      eventSeqs: events.map((e) => Number(e.seq)),
      pointSeqs: points.map((p) => Number(p.seq)),
      body: {
        device: this.clock.stamp(),
        events: events.map((e) => JSON.parse(e.body)),
        points: points.length
          ? encodePoints(run, points.map((p) => ({ t: Number(p.t), lat: p.lat, lng: p.lng, acc: p.acc, speed: p.speed, heading: p.heading, cbWall: Number(p.cb_wall), cbMono: Number(p.cb_mono) })))
          : null,
      },
    };
  }

  // Apply the server's answer to a batch from nextBatch().
  settle(batch, answer) {
    const byId = new Map(answer.events.map((r) => [r.id, r]));
    this.db.tx(() => {
      for (const ev of batch.body.events) {
        const r = byId.get(ev.id);
        if (!r) throw new Error('answer is missing an event'); // the whole batch stays queued
        if (r.status === 'rejected' || r.status === 'flagged') {
          this.db.run('INSERT OR REPLACE INTO outcomes (id, status, reason, body) VALUES (?,?,?,?)', [ev.id, r.status, r.reason ?? null, JSON.stringify(ev)]);
        }
      }
      for (const seq of batch.eventSeqs) this.db.run('DELETE FROM outbox WHERE seq = ?', [seq]);
      for (const seq of batch.pointSeqs) this.db.run('DELETE FROM track WHERE seq = ?', [seq]);
    });
  }

  outcomes() {
    return this.db.all('SELECT id, status, reason FROM outcomes', []);
  }
}

// About 1.1 m is enough for a delivery and keeps payloads small.
function roundFix(f) {
  return { t: f.t, lat: Math.round(f.lat * 1e5) / 1e5, lng: Math.round(f.lng * 1e5) / 1e5, acc: Math.round(f.acc ?? 0) };
}

// One sync attempt loop: send batches until the queue is empty, a request fails, or `maxBatches` is reached.
// `send(body)` posts the body and resolves to the server's JSON answer, or throws. Returns what happened.
export async function drain(outbox, send, { maxBatches = 20, maxEvents, maxPoints } = {}) {
  let sent = 0;
  let bytes = 0;
  for (let i = 0; i < maxBatches; i++) {
    const batch = outbox.nextBatch({ maxEvents, maxPoints });
    if (!batch) return { ok: true, sent, bytes, empty: true };
    const json = JSON.stringify(batch.body);
    let answer;
    try {
      answer = await send(json);
    } catch (error) {
      return { ok: false, sent, bytes, error: String(error?.name === 'Error' ? error.message : (error?.name ?? error)) };
    }
    outbox.settle(batch, answer);
    sent++;
    bytes += json.length;
  }
  return { ok: true, sent, bytes, empty: !outbox.nextBatch() };
}
