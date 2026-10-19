import { z } from 'zod';
import { type Coordinates, coordinatesSchema } from './primitives.js';

/**
 * Map pins (spec S01 rule 20, ADR 0021): a pasted `latitude, longitude` is read on the client; a
 * Google Maps or OpenStreetMap link is resolved by the server (`POST /api/maps/resolve-link`),
 * which follows short links on the allowed hosts only and reads the point from the final URL.
 */

export const resolveMapLinkSchema = z
  .object({ url: z.url({ protocol: /^https?$/ }).max(2048) })
  .meta({ id: 'ResolveMapLink' });

export type ResolveMapLink = z.infer<typeof resolveMapLinkSchema>;

export const resolvedMapLinkSchema = coordinatesSchema;

/** The hosts the resolver contacts, on the first request and on every redirect. */
export const mapLinkHosts = [
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'openstreetmap.org',
  'www.openstreetmap.org',
  'osm.org',
] as const;

export function isMapLinkHost(hostname: string): boolean {
  return (mapLinkHosts as readonly string[]).includes(hostname.toLowerCase());
}

const DEGREES = /^(-?)(\d{1,3})(?:\.(\d+))?$/;

/**
 * Degrees as typed (`36.5876`) to an integer × 10⁷, without floating point: digits past the seventh
 * decimal are rounded half away from zero.
 */
export function degreesToE7(text: string): number | undefined {
  const match = DEGREES.exec(text);
  if (!match) return undefined;
  const fraction = (match[3] ?? '').padEnd(8, '0');
  let units = Number(match[2]) * 10_000_000 + Number(fraction.slice(0, 7));
  if (Number(fraction[7]) >= 5) units += 1;
  return match[1] ? -units : units;
}

function point(latitude: string, longitude: string): Coordinates | undefined {
  const latitudeE7 = degreesToE7(latitude);
  const longitudeE7 = degreesToE7(longitude);
  if (latitudeE7 === undefined || longitudeE7 === undefined) return undefined;
  const parsed = coordinatesSchema.safeParse({ latitudeE7, longitudeE7 });
  return parsed.success ? parsed.data : undefined;
}

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits to Latin, and the Arabic decimal separator. */
function latin(text: string): string {
  return text
    .replace(/[٠-٩۰-۹]/g, (digit) => String((digit.charCodeAt(0) - 0x0660) % 0x0090))
    .replace(/٫/g, '.');
}

/** A pasted `latitude, longitude` (`36.5876, 37.0448`, also with `،` or spaces), or undefined. */
export function parseCoordinatesText(text: string): Coordinates | undefined {
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,،\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(latin(text));
  return match?.[1] && match[2] ? point(match[1], match[2]) : undefined;
}

const PAIR = '(-?\\d{1,3}(?:\\.\\d+)?),\\s*(-?\\d{1,3}(?:\\.\\d+)?)';

/**
 * The point a Google Maps or OpenStreetMap URL shows, or undefined: `!3d…!4d…` (a place),
 * `@lat,lng` (the view), `q=`, `query=`, `ll=`, `destination=` (Google), `mlat`/`mlon` and
 * `#map=zoom/lat/lng` (OpenStreetMap).
 */
export function coordinatesFromMapUrl(url: string): Coordinates | undefined {
  // Read without `URL`: the contracts load no DOM or Node types. The server parses the URL with
  // `URL` before it gets here and checks the host on every redirect.
  const parts = /^https?:\/\/([^/?#:@]+)(?::\d+)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(url);
  if (!parts?.[1] || !isMapLinkHost(parts[1])) return undefined;
  const path = decode(parts[2] ?? '');
  const params = new Map(
    (parts[3] ?? '')
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const [key = '', ...value] = pair.split('=');
        return [decode(key), decode(value.join('=').replace(/\+/g, ' '))] as const;
      }),
  );
  const hash = decode(parts[4] ?? '');
  const place = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(
    path + decode(parts[3] ?? ''),
  );
  if (place?.[1] && place[2]) return point(place[1], place[2]);
  for (const key of ['q', 'query', 'll', 'destination']) {
    const value = params.get(key);
    const match = value ? new RegExp(`^\\s*${PAIR}\\s*$`).exec(value) : null;
    if (match?.[1] && match[2]) return point(match[1], match[2]);
  }
  const mlat = params.get('mlat');
  const mlon = params.get('mlon');
  if (mlat && mlon) return point(mlat, mlon);
  const osm = /^map=\d{1,2}\/(-?\d{1,3}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/.exec(hash);
  if (osm?.[1] && osm[2]) return point(osm[1], osm[2]);
  const view = new RegExp(`@${PAIR}`).exec(path);
  if (view?.[1] && view[2]) return point(view[1], view[2]);
  return undefined;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Inside the box around Syria and Turkey, where V1 restaurants are; a point outside asks the
 * person to confirm it in the UI (it is not refused).
 */
export function isInServiceRegion({ latitudeE7, longitudeE7 }: Coordinates): boolean {
  return (
    latitudeE7 >= 320_000_000 &&
    latitudeE7 <= 423_000_000 &&
    longitudeE7 >= 255_000_000 &&
    longitudeE7 <= 450_000_000
  );
}
