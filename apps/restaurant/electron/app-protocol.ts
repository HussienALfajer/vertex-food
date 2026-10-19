import { extname, isAbsolute, join, relative, resolve } from 'node:path';

/** The privileged scheme the built renderer is served from: `app://restaurant/`. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'restaurant';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The content security policy of every renderer response: only the app's own files. The sync
 * service and API origins join `connect-src` with S04.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

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
