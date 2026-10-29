import { useSyncExternalStore } from 'react';

// The pages' four paths (spec S04 screens 6–9), on the History API: the hub serves `index.html`
// for any path without an extension, so a reload stays on its page.

export type PagePath = '/' | '/pair' | '/sign-in' | '/check';

const paths: readonly PagePath[] = ['/', '/pair', '/sign-in', '/check'];

const listeners = new Set<() => void>();

function current(): PagePath {
  const path = window.location.pathname;
  return paths.find((p) => p === path) ?? '/';
}

window.addEventListener('popstate', () => {
  for (const listener of listeners) listener();
});

export function usePath(): PagePath {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
  );
}

/** Goes to `path`; `replace` for a redirect, so Back never returns to the page that redirected. */
export function navigate(path: PagePath, replace = false): void {
  if (window.location.pathname === path && !window.location.hash) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}
