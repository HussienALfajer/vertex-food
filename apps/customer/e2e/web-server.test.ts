import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { candidates, e2eWebServer } from './web-server.js';

const server = e2eWebServer();
let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** The status of a raw request path (sent as is, without the client re-encoding it). */
function status(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
}

describe('E2E web server', () => {
  it('answers a malformed path with 400 and keeps serving', async () => {
    expect(await status('/%ZZ')).toBe(400);
    expect(await status('/%E0%A4%A')).toBe(400);
    expect(await status('/no-such-screen')).toBe(404);
  });

  it('never leaves the export folder', () => {
    expect(candidates('/../package.json')).toEqual(['package.json']);
    expect(candidates('/%2E%2E/%2E%2E/secret')).toEqual([
      'secret.html',
      join('secret', 'index.html'),
    ]);
    expect(candidates('/')).toEqual(['index.html']);
    expect(candidates('/%ZZ')).toBeUndefined();
  });
});
