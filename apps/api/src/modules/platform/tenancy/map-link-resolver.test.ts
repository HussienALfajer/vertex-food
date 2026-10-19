import { describe, expect, it } from 'vitest';
import {
  type HopRequest,
  isPublicAddress,
  MapLinkResolver,
  type ResolvedAddress,
} from './map-link-resolver.js';

// Synthetic points; no request leaves the test: DNS and the hop request are fakes that record
// each call. The public address is one of Google's.

const point = { latitudeE7: 365_876_000, longitudeE7: 370_448_000 };
const publicAddress: ResolvedAddress = { address: '142.250.180.14', family: 4 };

type Dns = Record<string, ResolvedAddress[]>;

function fakeNetwork(redirects: Record<string, string>, dns: Dns = {}) {
  const calls: string[] = [];
  const pinned: string[] = [];
  const lookups: string[] = [];
  const request: HopRequest = async (url, address) => {
    calls.push(url.href);
    pinned.push(address.address);
    const location = redirects[url.href];
    return location ? { status: 302, location } : { status: 200, location: null };
  };
  const resolveHost = async (hostname: string) => {
    lookups.push(hostname);
    return dns[hostname] ?? [publicAddress];
  };
  return { request, resolveHost, calls, pinned, lookups };
}

const resolver = (network: Pick<ReturnType<typeof fakeNetwork>, 'request' | 'resolveHost'>) =>
  new MapLinkResolver({ ...network, timeoutMs: 5000, maxRedirects: 3 });

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, CGNAT, reserved and mapped forms', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:a9fe:a9fe',
      'fe80::1%eth0',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('142.250.180.14')).toBe(true);
    expect(isPublicAddress('2a00:1450:4001:82b::200e')).toBe(true);
    expect(isPublicAddress('::ffff:142.250.180.14')).toBe(true);
  });
});

describe('MapLinkResolver', () => {
  it('reads a full link without any request', async () => {
    const network = fakeNetwork({});
    await expect(
      resolver(network).resolve('https://www.google.com/maps/@36.5876,37.0448,17z'),
    ).resolves.toEqual(point);
    await expect(
      resolver(network).resolve('https://www.openstreetmap.org/?mlat=36.5876&mlon=37.0448'),
    ).resolves.toEqual(point);
    expect(network.calls).toEqual([]);
    expect(network.lookups).toEqual([]);
  });

  it('follows a short link over TLS to an allowed host, pinned to the checked address', async () => {
    const network = fakeNetwork({
      'https://maps.app.goo.gl/abc': 'https://www.google.com/maps?q=36.5876,37.0448',
    });
    await expect(resolver(network).resolve('http://maps.app.goo.gl/abc')).resolves.toEqual(point);
    expect(network.calls).toEqual(['https://maps.app.goo.gl/abc']);
    expect(network.lookups).toEqual(['maps.app.goo.gl']);
    expect(network.pinned).toEqual([publicAddress.address]);
  });

  it('never requests a host outside the allow list, even through a redirect', async () => {
    const network = fakeNetwork({
      'https://maps.app.goo.gl/abc': 'http://127.0.0.1/maps?q=36.5876,37.0448',
      'https://maps.app.goo.gl/meta': 'http://169.254.169.254/latest',
    });
    for (const link of [
      'https://maps.app.goo.gl/abc',
      'https://maps.app.goo.gl/meta',
      'https://evil.example/maps/@36.5,37.0',
      'https://user@maps.app.goo.gl/x',
    ]) {
      await expect(resolver(network).resolve(link)).rejects.toThrow('no coordinates');
    }
    expect(network.calls).toEqual(['https://maps.app.goo.gl/abc', 'https://maps.app.goo.gl/meta']);
  });

  it('refuses an allowed host whose name resolves to a non-public address, at any hop', async () => {
    const rebinding = fakeNetwork(
      { 'https://maps.app.goo.gl/1': 'https://goo.gl/2' },
      {
        'maps.app.goo.gl': [publicAddress],
        'goo.gl': [publicAddress, { address: '10.0.0.5', family: 4 }],
      },
    );
    await expect(resolver(rebinding).resolve('https://maps.app.goo.gl/1')).rejects.toThrow(
      'no coordinates',
    );
    // The first hop went out; the second never did, because one of its answers is private.
    expect(rebinding.calls).toEqual(['https://maps.app.goo.gl/1']);
    expect(rebinding.lookups).toEqual(['maps.app.goo.gl', 'goo.gl']);

    const loopback = fakeNetwork({}, { 'maps.app.goo.gl': [{ address: '::1', family: 6 }] });
    await expect(resolver(loopback).resolve('https://maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
    expect(loopback.calls).toEqual([]);

    const empty = fakeNetwork({}, { 'maps.app.goo.gl': [] });
    await expect(resolver(empty).resolve('https://maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
    expect(empty.calls).toEqual([]);
  });

  it('stops after three redirects', async () => {
    const network = fakeNetwork({
      'https://maps.app.goo.gl/1': 'https://maps.app.goo.gl/2',
      'https://maps.app.goo.gl/2': 'https://maps.app.goo.gl/3',
      'https://maps.app.goo.gl/3': 'https://maps.app.goo.gl/4',
      'https://maps.app.goo.gl/4': 'https://www.google.com/maps?q=36.5876,37.0448',
    });
    await expect(resolver(network).resolve('https://maps.app.goo.gl/1')).rejects.toThrow(
      'no coordinates',
    );
    expect(network.calls).toHaveLength(3);
  });

  it('gives up on a failed request, a failed lookup or a page without a redirect', async () => {
    const network = fakeNetwork({});
    const failingRequest: HopRequest = async () => {
      throw new Error('network');
    };
    await expect(
      resolver({ ...network, request: failingRequest }).resolve('https://maps.app.goo.gl/x'),
    ).rejects.toThrow('no coordinates');
    const failingDns = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      resolver({ ...network, resolveHost: failingDns }).resolve('https://maps.app.goo.gl/x'),
    ).rejects.toThrow('no coordinates');
    await expect(resolver(network).resolve('https://maps.app.goo.gl/x')).rejects.toThrow(
      'no coordinates',
    );
  });
});
