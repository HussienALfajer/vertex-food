// A TCP proxy that behaves like a weak mobile link between the driver app and the server.
// Per direction: one-way latency with jitter and a bandwidth cap (chunks leave in order). Faults:
// - `offline`: connections are refused at once (the phone knows it has no network);
// - `blackhole`: connections are accepted and nothing ever passes (weak signal, a dead cell);
// - `resetProb`: the connection is cut as a request starts, before it reaches the server;
// - `answerLossProb`: the request reaches the server, and the connection is cut when the answer starts back
//   (the server applied the batch; the phone never hears it);
// - `onRequestForwarded`: called once the first request bytes reached the server;
// - `onAnswer`: called when an answer starts back; returning 'drop' cuts it (the kill test).
// Profiles are assumptions about Azaz, not measurements (docs/spikes/C-driver-location.md).
import net from 'node:net';

export const PROFILES = {
  lan: { latencyMs: 1, jitterMs: 0, upBps: Infinity, downBps: Infinity },
  // EDGE/2G at the edge of a cell: slow and long round trips.
  edge: { latencyMs: 300, jitterMs: 150, upBps: 6_000, downBps: 12_000 },
  // Poor 3G or a busy 4G cell.
  poor3g: { latencyMs: 120, jitterMs: 80, upBps: 25_000, downBps: 60_000 },
};

export async function weakNet({ targetPort, targetHost = '127.0.0.1', profile = PROFILES.lan, port = 0, random = Math.random }) {
  let cfg = { ...profile };
  const stats = { connections: 0, refused: 0, resets: 0, answersLost: 0, upBytes: 0, downBytes: 0, requestLines: [] };
  const sockets = new Set();

  // Faults apply per request and per answer, not per connection: phones and fetch keep connections alive.
  const pipe = (from, to, dir) => {
    let lastDeparture = 0;
    from.on('data', (chunk) => {
      if (cfg.blackhole) return;
      const head = chunk.toString('latin1', 0, Math.min(chunk.length, 200)).split('\r\n')[0];
      const startsRequest = dir === 'up' && /^(GET|POST|PUT|DELETE|PATCH) /.test(head);
      const startsAnswer = dir === 'down' && head.startsWith('HTTP/');
      if (startsRequest) {
        stats.requestLines.push(head);
        if (cfg.resetProb && random() < cfg.resetProb) {
          stats.resets++;
          from.destroy();
          to.destroy();
          return;
        }
      }
      if (dir === 'up') stats.upBytes += chunk.length;
      else stats.downBytes += chunk.length;
      const bps = dir === 'up' ? cfg.upBps : cfg.downBps;
      const now = Date.now();
      const latency = cfg.latencyMs + (cfg.jitterMs ? random() * cfg.jitterMs : 0);
      const departure = Math.max(now + latency, lastDeparture + (Number.isFinite(bps) ? (chunk.length / bps) * 1000 : 0));
      lastDeparture = departure;
      setTimeout(() => {
        if (to.destroyed) return;
        if (startsAnswer) {
          const hook = cfg.onAnswer?.();
          if (hook === 'drop' || (cfg.answerLossProb && random() < cfg.answerLossProb)) {
            stats.answersLost++;
            from.destroy();
            to.destroy();
            return;
          }
        }
        to.write(chunk);
        if (startsRequest) cfg.onRequestForwarded?.();
      }, departure - now);
    });
    from.on('error', () => to.destroy());
    from.on('close', () => setTimeout(() => to.destroy(), Math.max(0, lastDeparture - Date.now())));
  };

  const server = net.createServer((client) => {
    stats.connections++;
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    if (cfg.offline) {
      stats.refused++;
      client.resetAndDestroy();
      return;
    }
    const upstream = net.connect(targetPort, targetHost);
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    pipe(client, upstream, 'up');
    pipe(upstream, client, 'down');
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port,
    stats,
    // Going offline also drops the connections that are open, as a phone losing its network does.
    set(next) {
      cfg = { ...next };
      if (cfg.offline) for (const s of sockets) s.destroy();
    },
    patch(p) {
      cfg = { ...cfg, ...p };
    },
    // Cut every open connection (a cell handover or the link dropping).
    cutAll() {
      for (const s of sockets) s.destroy();
    },
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
