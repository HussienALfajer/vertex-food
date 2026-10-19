import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectOrigins, contentSecurityPolicy, resolveAppFile } from './app-protocol.js';

const root = resolve('/renderer');

describe('resolveAppFile', () => {
  it('serves a file of the renderer', () => {
    expect(resolveAppFile(root, 'app://restaurant/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js'),
    );
  });

  it('serves index.html for the root and for client routes', () => {
    expect(resolveAppFile(root, 'app://restaurant/')).toBe(join(root, 'index.html'));
    expect(resolveAppFile(root, 'app://restaurant/orders/123')).toBe(join(root, 'index.html'));
  });

  it('refuses paths that leave the renderer', () => {
    expect(resolveAppFile(root, 'app://restaurant/..%2F..%2Fsecret.txt')).toBeNull();
    expect(resolveAppFile(root, 'app://restaurant/..%5C..%5Csecret.txt')).toBeNull();
    expect(resolveAppFile(root, 'app://restaurant/assets%00.js')).toBeNull();
  });

  it('keeps dot segments inside the renderer, as the URL parser resolves them', () => {
    expect(resolveAppFile(root, 'app://restaurant/%2e%2e/%2e%2e/secret.txt')).toBe(
      join(root, 'secret.txt'),
    );
  });

  it('refuses other hosts, schemes and malformed URLs', () => {
    expect(resolveAppFile(root, 'app://other/index.html')).toBeNull();
    expect(resolveAppFile(root, 'file:///renderer/index.html')).toBeNull();
    expect(resolveAppFile(root, 'app://restaurant/%E0%A4%A.js')).toBeNull();
    expect(resolveAppFile(root, 'not a url')).toBeNull();
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only the app itself without an API', () => {
    const policy = contentSecurityPolicy([]);
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toContain('unsafe');
    expect(policy).not.toContain('blob:');
  });

  it('adds the API origin to connect-src only', () => {
    const policy = contentSecurityPolicy(['https://api.example.test']);
    expect(policy).toContain("connect-src 'self' https://api.example.test;");
    expect(policy.match(/api\.example\.test/g)).toHaveLength(1);
  });
});

describe('connectOrigins', () => {
  it('takes the API origin, without its path', () => {
    expect(connectOrigins({ VITE_API_URL: 'https://api.example.test/v1/' })).toEqual([
      'https://api.example.test',
    ]);
    expect(connectOrigins({ VITE_API_URL: 'http://127.0.0.1:3000' })).toEqual([
      'http://127.0.0.1:3000',
    ]);
    expect(connectOrigins({ VITE_API_URL: 'http://localhost:3000' })).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('allows plain HTTP on the loopback interface only', () => {
    expect(connectOrigins({ VITE_API_URL: 'http://api.example.test' })).toEqual([]);
  });

  it('leaves out anything unset, malformed or able to widen the policy', () => {
    expect(connectOrigins({})).toEqual([]);
    expect(connectOrigins({ VITE_API_URL: 'not a url' })).toEqual([]);
    expect(connectOrigins({ VITE_API_URL: 'https://user:secret@api.example.test' })).toEqual([]);
    expect(connectOrigins({ VITE_API_URL: 'https://*.example.test' })).toEqual([]);
    expect(connectOrigins({ VITE_API_URL: "https://a.test;script-src 'unsafe-inline'" })).toEqual(
      [],
    );
    expect(connectOrigins({ VITE_API_URL: 'file:///etc/passwd' })).toEqual([]);
  });
});
