import { describe, expect, it } from 'vitest';
import { MapLinkResolver } from './map-link-resolver.js';

// Synthetic points; no request leaves the test: `fetch` is a fake that records each call.

const point = { latitudeE7: 365_876_000, longitudeE7: 370_448_000 };

function fakeFetch(redirects: Record<string, string>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(init?.redirect).toBe('manual');
    const location = redirects[url];
    return new Response(null, location ? { status: 302, headers: { location } } : { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const resolver = (fetch: typeof globalThis.fetch) =>
  new MapLinkResolver({ fetch, timeoutMs: 5000, maxRedirects: 3 });

describe('MapLinkResolver', () => {
  it('reads a full link without any request', async () => {
    const { fetch, calls } = fakeFetch({});
    await expect(
      resolver(fetch).resolve('https://www.google.com/maps/@36.5876,37.0448,17z'),
    ).resolves.toEqual(point);
    await expect(
      resolver(fetch).resolve('https://www.openstreetmap.org/?mlat=36.5876&mlon=37.0448'),
    ).resolves.toEqual(point);
    expect(calls).toEqual([]);
  });

  it('follows a short link over TLS to an allowed host', async () => {
    const { fetch, calls } = fakeFetch({
      'https://maps.app.goo.gl/abc': 'https://www.google.com/maps?q=36.5876,37.0448',
    });
    await expect(resolver(fetch).resolve('http://maps.app.goo.gl/abc')).resolves.toEqual(point);
    expect(calls).toEqual(['https://maps.app.goo.gl/abc']);
  });

  it('never requests a host outside the allow list, even through a redirect', async () => {
    const { fetch, calls } = fakeFetch({
      'https://maps.app.goo.gl/abc': 'http://127.0.0.1/maps?q=36.5876,37.0448',
      'https://maps.app.goo.gl/meta': 'http://169.254.169.254/latest',
    });
    await expect(resolver(fetch).resolve('https://maps.app.goo.gl/abc')).rejects.toThrow(
      'no coordinates',
    );
    await expect(resolver(fetch).resolve('https://maps.app.goo.gl/meta')).rejects.toThrow(
      'no coordinates',
    );
    await expect(resolver(fetch).resolve('https://evil.example/maps/@36.5,37.0')).rejects.toThrow(
      'no coordinates',
    );
    await expect(resolver(fetch).resolve('https://user@maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
    expect(calls).toEqual(['https://maps.app.goo.gl/abc', 'https://maps.app.goo.gl/meta']);
  });

  it('stops after three redirects', async () => {
    const { fetch, calls } = fakeFetch({
      'https://maps.app.goo.gl/1': 'https://maps.app.goo.gl/2',
      'https://maps.app.goo.gl/2': 'https://maps.app.goo.gl/3',
      'https://maps.app.goo.gl/3': 'https://maps.app.goo.gl/4',
      'https://maps.app.goo.gl/4': 'https://www.google.com/maps?q=36.5876,37.0448',
    });
    await expect(resolver(fetch).resolve('https://maps.app.goo.gl/1')).rejects.toThrow(
      'no coordinates',
    );
    expect(calls).toHaveLength(3);
  });

  it('gives up on a failed request or a page without a redirect', async () => {
    const failing = (async () => {
      throw new Error('network');
    }) as typeof globalThis.fetch;
    await expect(resolver(failing).resolve('https://maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
    const { fetch } = fakeFetch({});
    await expect(resolver(fetch).resolve('https://maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
  });
});
