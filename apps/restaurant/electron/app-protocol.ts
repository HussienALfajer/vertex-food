import { extname, isAbsolute, join, relative, resolve } from 'node:path';

/** The privileged scheme the built renderer is served from: `app://restaurant/`. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'restaurant';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The content security policy of every renderer response: only the app's own files, plus the
 * origin of the API for the online-only screens (S01, ADR 0020). The sync service's origin joins
 * `connect-src` with S04.
 */
export function contentSecurityPolicy(connectOrigins: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The variable that holds the API's URL; Vite gives the renderer the same one at build. */
export const API_URL_VARIABLE = 'VITE_API_URL';

/** A DNS name or IPv4 address in ASCII (internationalized names arrive as punycode). */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * The origin of the configured API URL: HTTPS, or HTTP on the loopback interface for a local API.
 * Anything else is left out, and the online-only screens show their error state.
 */
export function connectOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  let url: URL;
  try {
    url = new URL(env[API_URL_VARIABLE] ?? '');
  } catch {
    return [];
  }
  // The URL parser accepts `*` and `;` in a host, which would widen or break the policy.
  if (url.username || url.password || !HOSTNAME.test(url.hostname)) return [];
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? [url.origin] : [];
}

/**
 * The file under `rootDir` that answers `requestUrl`, or `null` when the URL is not the app's or
 * would leave `rootDir`. A path without an extension is a client route and gets `index.html`.
 */
export function resolveAppFile(rootDir: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  const root = resolve(rootDir);
  const file = extname(pathname) === '' ? join(root, 'index.html') : resolve(root, `.${pathname}`);
  const inside = relative(root, file);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  return file;
}
