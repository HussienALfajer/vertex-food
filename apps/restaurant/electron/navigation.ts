/**
 * Whether the window may navigate to `target`: only within the origin the renderer was loaded
 * from. Everything else (links to the web, injected redirects) is refused. Compared as scheme and
 * host because `URL.origin` is `"null"` for a custom scheme such as `app:`.
 */
export function isAllowedNavigation(target: string, rendererOrigin: string): boolean {
  try {
    const url = new URL(target);
    return `${url.protocol}//${url.host}` === rendererOrigin;
  } catch {
    return false;
  }
}

/**
 * The Vite dev server URL from `--dev-server=<url>`, accepted only for an unpackaged app and only
 * on the loopback interface over HTTP, or `null`.
 */
export function devServerUrl(argv: readonly string[], isPackaged: boolean): string | null {
  if (isPackaged) return null;
  const value = argv.find((arg) => arg.startsWith('--dev-server='))?.slice('--dev-server='.length);
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'http:' && loopback ? url.origin : null;
  } catch {
    return null;
  }
}
