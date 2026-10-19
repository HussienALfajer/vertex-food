import {
  type Coordinates,
  coordinatesFromMapUrl,
  DomainError,
  isMapLinkHost,
} from '@vertex-food/contracts';

export type MapLinkResolverOptions = {
  /** `globalThis.fetch` in production; tests pass a fake. */
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  maxRedirects: number;
};

const unrecognized = () =>
  new DomainError('MAP_LINK_UNRECOGNIZED', 'The map link gives no coordinates');

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

/**
 * Turns a pasted Google Maps or OpenStreetMap link into coordinates (spec S01 rule 20, ADR 0021).
 * A link that names a point is read without a request. A short link (`maps.app.goo.gl`) is
 * followed with bodiless `GET`s that never follow redirects themselves: each `Location` is checked
 * against the host allow list before it is requested, up to `maxRedirects` hops, all under one
 * timeout; no page is read. The allow list names public hosts only, so no private address is ever
 * requested. Anything else is `MAP_LINK_UNRECOGNIZED`, and the owner sets the pin on the map.
 * Adapted from Vertex Shifa.
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
      current = allowed(await this.redirectOf(current.href, signal));
    }
    throw unrecognized();
  }

  /** Where a link redirects to, as an absolute URL. */
  private async redirectOf(url: string, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await this.options.fetch(url, { method: 'GET', redirect: 'manual', signal });
    } catch {
      throw unrecognized();
    }
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (response.status < 300 || response.status > 399 || !location) throw unrecognized();
    try {
      return new URL(location, url).href;
    } catch {
      throw unrecognized();
    }
  }
}
