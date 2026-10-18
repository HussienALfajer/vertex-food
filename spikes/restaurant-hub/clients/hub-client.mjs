// A hub client as a waiter phone or kitchen display would run it: pairing, commands with failover, live snapshots.
import { v7 as uuidv7 } from 'uuid';
import { lanFetch, lanEvents } from '../pc/lan-http.mjs';
import { fingerprint } from '../pc/tls.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pairing, from what the hub shows as a QR code: its address, the branch CA's fingerprint and a one-time code.
 * The CA is fetched over an unverified channel and accepted only if its fingerprint matches the QR code.
 */
export async function pair({ url, caFingerprint, code, kind, name }) {
  const ca = await lanFetch(`${url}/hub/ca`, { insecure: true });
  const caPem = ca.body?.raw;
  if (!caPem || fingerprint(caPem) !== caFingerprint) throw Object.assign(new Error('ca_fingerprint_mismatch'), { code: 'ca_fingerprint_mismatch' });
  const r = await lanFetch(`${url}/hub/pair`, { ca: caPem, method: 'POST', body: { code, kind, name } });
  if (r.status !== 200) throw Object.assign(new Error(`pair ${r.status}`), { status: r.status });
  return { caPem, token: r.body.token, clientId: r.body.client_id, peers: r.body.peers, mirrored: r.body.mirrored };
}

export function createHubClient({ caPem, token, clientId, peers, name, userId }) {
  const headers = { authorization: `Bearer ${token}` };
  const listeners = new Set();
  // Commands the hub acknowledged without a standby copy, re-sent after a failover (idempotent by id).
  const unmirrored = new Map();
  const c = { name, clientId, current: null, snapshot: null, failovers: 0, resent: 0, closed: false, hubsSeen: new Set() };

  async function findHub() {
    const found = [];
    await Promise.all(peers.map(async (p) => {
      try {
        const r = await lanFetch(`${p.url}/hub/hello`, { ca: caPem, timeout: 600 });
        if (r.status === 200 && r.body.role === 'hub') found.push({ ...p, epoch: r.body.epoch });
      } catch {
        // unreachable
      }
    }));
    return found.sort((a, b) => b.epoch - a.epoch)[0] ?? null;
  }

  async function hub() {
    if (!c.current) {
      const h = await findHub();
      if (h) {
        if (c.lastHubId && c.lastHubId !== h.device_id) c.failovers++;
        c.current = h;
        c.lastHubId = h.device_id;
        c.hubsSeen.add(h.name);
      }
    }
    return c.current;
  }

  c.command = (type, payload) => ({ id: uuidv7(), type, payload, user_id: userId, device_time: new Date().toISOString() });

  c.send = async (commands, { timeout = 20000 } = {}) => {
    const start = Date.now();
    for (;;) {
      const h = await hub();
      if (h) {
        const resend = [...unmirrored.values()].filter((u) => u.hub !== h.device_id);
        try {
          const r = await lanFetch(`${h.url}/hub/commands`, { ca: caPem, method: 'POST', body: { commands: [...resend.map((u) => u.command), ...commands] }, headers, timeout: 3000 });
          if (r.status === 200) {
            c.resent += resend.length;
            if (resend.length) c.lastResent = r.body.results.slice(0, resend.length);
            for (const u of resend) unmirrored.delete(u.command.id);
            const mine = r.body.results.slice(resend.length);
            for (const [i, x] of mine.entries()) {
              if (x.status !== 'applied') continue;
              // Mirroring is in order: a mirrored command means every earlier one reached the standby too.
              if (x.mirrored) {
                for (const [id, u] of unmirrored) {
                  if (u.hub === h.device_id) unmirrored.delete(id);
                }
              } else {
                // Keep the version this hub resolved (number, prices, tickets), so another hub applies it instead of resolving again.
                const resolved = { payload: x.payload, executed_by_device_id: x.executed_by_device_id };
                unmirrored.set(x.id, { command: { ...commands[i], resolved }, hub: h.device_id });
              }
            }
            return { results: mine, hub: h.name, ms: Date.now() - start };
          }
          c.lastError = `${h.name} ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
          c.current = null;
        } catch (e) {
          c.lastError = `${h.name} ${e.code ?? e.message}`;
          c.current = null;
        }
      } else c.lastError = 'no hub found';
      if (Date.now() - start > timeout) throw new Error(`${name}: no hub answered within ${timeout} ms (last: ${c.lastError})`);
      await sleep(150);
    }
  };

  c.subscribe = () => {
    (async () => {
      while (!c.closed) {
        const h = await hub();
        if (!h) {
          await sleep(150);
          continue;
        }
        await new Promise((resolve) => {
          c.stream = lanEvents(`${h.url}/hub/events`, {
            ca: caPem,
            headers,
            onEvent: (snap) => {
              snap.receivedAt = Date.now();
              c.snapshot = snap;
              for (const l of listeners) l(snap);
            },
            onClose: () => resolve(),
          });
        });
        if (c.closed) return;
        c.current = null;
        await sleep(150);
      }
    })();
  };

  /** Resolves with the first snapshot (current or future) for which pred is true, and when it arrived. */
  c.waitFor = (pred, { timeout = 10000, label = 'snapshot' } = {}) => new Promise((resolve, reject) => {
    const done = (snap) => {
      let v;
      try { v = pred(snap); } catch { v = false; }
      if (!v) return false;
      listeners.delete(done);
      clearTimeout(timer);
      resolve({ value: v, at: snap.receivedAt, snap });
      return true;
    };
    const timer = setTimeout(() => {
      listeners.delete(done);
      reject(new Error(`${name}: timed out waiting for ${label}`));
    }, timeout);
    listeners.add(done);
    if (c.snapshot) done(c.snapshot);
  });

  c.close = () => {
    c.closed = true;
    c.stream?.close();
  };
  return c;
}
