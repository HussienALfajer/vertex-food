import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serves the web export (dist/) for the E2E tests only: the app ships to the stores, never to a web
// host (ADR 0003). `expo serve` answers an unknown path with a bare "Not Found"; this serves the
// exported +not-found.html with a 404, as the router's not-found route expects.

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const port = 4276;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
};

/** The files a URL path may name, in order: the file itself, then the exported route's page. */
function candidates(urlPath: string): string[] {
  const path = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) return [];
  if (path === '' || path === '.') return ['index.html'];
  return extname(path) ? [path] : [`${path}.html`, join(path, 'index.html')];
}

async function firstFile(paths: string[]): Promise<[string, Buffer] | undefined> {
  for (const path of paths) {
    try {
      return [path, await readFile(join(dist, path))];
    } catch {}
  }
  return undefined;
}

createServer(async (request, response) => {
  const found = await firstFile(candidates(new URL(request.url ?? '/', 'http://e2e').pathname));
  const [path, body] = found ?? (await firstFile(['+not-found.html'])) ?? ['', Buffer.from('')];
  response.writeHead(found ? 200 : 404, {
    'content-type': types[extname(path)] ?? 'application/octet-stream',
  });
  response.end(body);
}).listen(port, () => process.stdout.write(`E2E web server on http://localhost:${port}\n`));
