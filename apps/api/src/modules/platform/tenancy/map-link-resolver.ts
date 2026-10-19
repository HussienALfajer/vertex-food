import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import {
  type Coordinates,
  coordinatesFromMapUrl,
  DomainError,
  isMapLinkHost,
} from '@vertex-food/contracts';

/** One checked hop: the status and `Location` of a bodiless `GET`, which never follows redirects. */
export type HopResponse = { status: number; location: string | null };

/**
 * Requests one URL over TLS from `address`, the already-checked IP, while TLS verifies the
 * certificate against the URL's host name.
 */
export type HopRequest = (
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
) => Promise<HopResponse>;

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type MapLinkResolverOptions = {
  /** Every address a host name resolves to; `dns.lookup` with `all: true` in production. */
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>;
  /** `httpsHop` in production; tests pass a fake. */
  request: HopRequest;
  timeoutMs: number;
  maxRedirects: number;
};

const unrecognized = () =>
  new DomainError('MAP_LINK_UNRECOGNIZED', 'The map link gives no coordinates');

/**
 * Addresses that are not public unicast: loopback, private, link-local, carrier-grade NAT,
 * multicast, reserved and documentation ranges. Two lists, because a `BlockList` also matches an
 * IPv4 address against IPv4-mapped IPv6 rules; mapped forms are checked as the IPv4 they carry.
 */
const nonPublicV4 = new BlockList();
const nonPublicV6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublicV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  nonPublicV6.addSubnet(network, prefix, 'ipv6');
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address, in any spelling: the WHATWG URL parser
 * writes every one canonically as `::ffff:hhhh:hhhh`.
 */
function mappedIpv4(address: string): string | undefined {
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname;
  } catch {
    return undefined;
  }
  const hex = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(canonical);
  if (!hex?.[1] || !hex[2]) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Whether an address is public unicast; anything unparsable is not. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicV4.check(address, 'ipv4');
  if (family === 6) {
    const mapped = mappedIpv4(address);
    if (mapped) return isPublicAddress(mapped);
    return !nonPublicV6.check(address, 'ipv6');
  }
  return false;
}

/** The link as a URL on an allowed map host, or undefined: no other host is ever requested. */
function allowed(text: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username || url.password || url.port) return undefined;
  return isMapLinkHost(url.hostname) ? url : undefined;
}

/** `dns.lookup` for every address of a name, in the shape the resolver checks. */
export async function lookupAll(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
}

/**
 * One bodiless `GET` over TLS to the pinned address. The socket connects to `address` only (the
 * `lookup` hook never asks DNS again), while `servername` and the certificate check use the URL's
 * host name, so TLS verification is unchanged.
 */
export const httpsHop: HopRequest = (url, pinned, signal) =>
  new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    const req = httpsRequest(
      url,
      { method: 'GET', lookup, signal, servername: url.hostname },
      (res) => {
        const location = res.headers.location ?? null;
        res.destroy();
        resolve({ status: res.statusCode ?? 0, location });
      },
    );
    req.on('error', reject);
    req.end();
  });

/**
 * Turns a pasted Google Maps or OpenStreetMap link into coordinates (spec S01 rule 20, ADR 0021).
 * A link that names a point is read without a request. A short link (`maps.app.goo.gl`) is
 * followed with bodiless `GET`s that never follow redirects themselves, up to `maxRedirects` hops,
 * all under one timeout; no page is read. Every hop is checked twice before it is requested: its
 * host must be on the allow list, and every address its name resolves to must be public. The
 * request then connects to the checked address only (pinned), so a DNS answer that changes
 * between the check and the connection cannot reach a private address. Anything else is
 * `MAP_LINK_UNRECOGNIZED`, and the owner sets the pin on the map. Adapted from Vertex Shifa.
 */
export class MapLinkResolver {
  constructor(private readonly options: MapLinkResolverOptions) {}

  async resolve(link: string): Promise<Coordinates> {
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    let current = allowed(link);
    for (let hop = 0; current; hop++) {
      const coordinates = coordinatesFromMapUrl(current.href);
      if (coordinates) return coordinates;
      if (hop >= this.options.maxRedirects) break;
      // Never in plain text (ADR 0016): an `http` link or redirect goes over TLS.
      current.protocol = 'https:';
      current = allowed(await this.redirectOf(current, signal));
    }
    throw unrecognized();
  }

  /** The one address a hop may connect to: every answer for its name must be public. */
  private async pinnedAddress(hostname: string): Promise<ResolvedAddress> {
    let answers: ResolvedAddress[];
    try {
      answers = await this.options.resolveHost(hostname);
    } catch {
      throw unrecognized();
    }
    const [first] = answers;
    if (!first || !answers.every(({ address }) => isPublicAddress(address))) throw unrecognized();
    return first;
  }

  /** Where a link redirects to, as an absolute URL. */
  private async redirectOf(url: URL, signal: AbortSignal): Promise<string> {
    const address = await this.pinnedAddress(url.hostname);
    let response: HopResponse;
    try {
      response = await this.options.request(url, address, signal);
    } catch {
      throw unrecognized();
    }
    const { status, location } = response;
    if (status < 300 || status > 399 || !location) throw unrecognized();
    try {
      return new URL(location, url).href;
    } catch {
      throw unrecognized();
    }
  }
}
