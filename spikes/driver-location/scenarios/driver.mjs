// A driver app in Node for the scenarios: the shared queue (core/outbox.js) on node:sqlite, a fetch transport
// with a timeout, a controllable clock and a synthetic route. The Expo app uses the same queue on expo-sqlite.
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Outbox, drain } from '../core/outbox.js';
import { backoffMs } from '../core/policy.js';
import { uuidv7 } from '../core/uuid7.js';

export function nodeDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  return {
    run: (sql, p) => db.prepare(sql).run(...p),
    all: (sql, p) => db.prepare(sql).all(...p),
    tx(fn) {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}

// A clock the scenario moves: `wall` may be wrong by `skewMs`, `mono` only moves forward.
export function testClock({ run = uuidv7(Date.now(), randomBytes), startWall = Date.now(), skewMs = 0 } = {}) {
  let elapsed = 0;
  let skew = skewMs;
  const c = {
    run,
    stamp: () => ({ wall: Math.round(startWall + elapsed + skew), mono: Math.round(elapsed), run }),
    advance(ms) {
      elapsed += ms;
    },
    // Move to real time: the scenario's virtual minutes are over and requests go out now.
    syncTo(realNow) {
      elapsed = Math.max(elapsed, realNow - startWall);
    },
    setSkew(ms) {
      skew = ms;
    },
    wallNow: () => Math.round(startWall + elapsed + skew),
  };
  return c;
}

export function makeDriver({ file, token, url, clock, timeoutMs = 15_000, log = () => {} }) {
  const db = nodeDb(file);
  const outbox = new Outbox(db, { clock, newId: (ms) => uuidv7(ms, randomBytes) });
  let requests = 0;
  const send = async (json) => {
    requests++;
    const r = await fetch(`${url}/driver/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: json,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return r.json();
  };
  return {
    outbox,
    clock,
    db,
    get requests() {
      return requests;
    },
    // Send until the queue is empty, backing off after each failure. `scale` shrinks the real backoff so the
    // scenarios run in seconds; the app uses scale 1 (2 s base, 60 s cap).
    async syncUntilEmpty({ maxAttempts = 50, scale = 0.02, opts } = {}) {
      let failures = 0;
      let attempts = 0;
      let bytes = 0;
      while (attempts < maxAttempts) {
        attempts++;
        const r = await drain(outbox, send, opts);
        bytes += r.bytes;
        if (r.ok && r.empty) return { ok: true, attempts, failures, bytes };
        if (!r.ok) {
          failures++;
          log(`sync failed attempt=${attempts} error=${r.error}`);
          await new Promise((res) => setTimeout(res, backoffMs(failures) * scale));
        }
      }
      return { ok: false, attempts, failures, bytes };
    },
    close: () => db.close(),
  };
}

// A synthetic route (no real place data matters here): a straight drive from a start point, `stepM` metres per
// fix, with a slow bend. Returns fixes [{ lat, lng, acc, speed, heading }].
export function route(n, { lat = 36.58, lng = 37.04, stepM = 60, heading = 40 } = {}) {
  const out = [];
  let la = lat;
  let lo = lng;
  let h = heading;
  for (let i = 0; i < n; i++) {
    h += 1.5;
    const r = (h * Math.PI) / 180;
    la += (stepM * Math.cos(r)) / 111_320;
    lo += (stepM * Math.sin(r)) / (111_320 * Math.cos((la * Math.PI) / 180));
    out.push({ lat: la, lng: lo, acc: 8 + (i % 5), speed: stepM / 15, heading: Math.round(h % 360) });
  }
  return out;
}
