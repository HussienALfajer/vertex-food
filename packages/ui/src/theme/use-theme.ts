'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { systemDarkQuery, type Theme, themeStorageKey } from './theme';

const listeners = new Set<() => void>();
/** The choice made on this page, kept even when storage cannot save it. */
let pageChoice: Theme | undefined;
let systemMedia: MediaQueryList | undefined;

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function savedTheme(): Theme | undefined {
  try {
    const saved = localStorage.getItem(themeStorageKey);
    return saved === 'light' || saved === 'dark' ? saved : undefined;
  } catch {
    return undefined;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** While nothing is chosen, the theme follows the system as it changes. */
function onSystemChange(event: MediaQueryListEvent): void {
  if (pageChoice ?? savedTheme()) return;
  document.documentElement.classList.toggle('dark', event.matches);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    try {
      systemMedia = matchMedia(systemDarkQuery);
      systemMedia.addEventListener('change', onSystemChange);
    } catch {
      systemMedia = undefined;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      systemMedia?.removeEventListener('change', onSystemChange);
      systemMedia = undefined;
    }
  };
}

/** Applies a theme now and keeps it for the next start of the app on this device. */
export function setTheme(next: Theme): void {
  pageChoice = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  notify();
}

/**
 * Light or dark theme: follows the system until the user picks one, then remembers the choice.
 * The server render (apps/web) assumes light; the client then reads what `theme-init.js` applied.
 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as const);
  const toggle = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, setTheme, toggle };
}
