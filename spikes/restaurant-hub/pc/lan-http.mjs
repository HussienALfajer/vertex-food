// HTTPS over the restaurant LAN, verified against the branch CA. Used by hub PCs (peer calls) and Node hub clients.
import https from 'node:https';

/**
 * @param {string} url
 * @param {{ ca?: string, insecure?: boolean, method?: string, body?: unknown, headers?: Record<string,string>, timeout?: number }} opts
 */
export function lanFetch(url, { ca, insecure = false, method = 'GET', body, headers = {}, timeout = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(url, {
      method,
      ca,
      rejectUnauthorized: !insecure,
      agent: false,
      timeout,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; });
      res.on('end', () => {
        let json = null;
        try { json = s ? JSON.parse(s) : null; } catch { json = { raw: s }; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

/** Server-sent events over HTTPS. Returns a handle whose close() ends the stream. */
export function lanEvents(url, { ca, headers = {}, onEvent, onClose }) {
  let closed = false;
  const req = https.request(url, { method: 'GET', ca, agent: false, headers: { accept: 'text/event-stream', ...headers } }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return finish(new Error(`events ${res.statusCode}`));
    }
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        if (data) onEvent(JSON.parse(data));
      }
    });
    res.on('close', () => finish(null));
    res.on('error', finish);
  });
  function finish(err) {
    if (closed) return;
    closed = true;
    onClose?.(err);
  }
  req.on('error', finish);
  req.end();
  return { close: () => { closed = true; req.destroy(); } };
}
