// A TCP proxy per PC and upstream (copied from Vertex Shifa's Spike A). cut() drops every open connection and
// refuses new ones, which is closer to a real internet loss than calling disconnect() on the SDK.
import net from 'node:net';

export async function createProxy(targetPort) {
  const sockets = new Set();
  let online = true;
  const server = net.createServer((client) => {
    if (!online) return client.destroy();
    const upstream = net.connect(targetPort, '127.0.0.1');
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => {});
    }
    client.pipe(upstream).pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    get online() {
      return online;
    },
    cut() {
      online = false;
      for (const s of sockets) s.destroy();
    },
    restore() {
      online = true;
    },
  };
}
