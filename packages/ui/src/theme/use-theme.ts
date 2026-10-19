'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { type Theme, themeStorageKey } from './theme';

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies a theme now and keeps it for the next start of the app on this device. */
export function setTheme(next: Theme): void {
  document.documentElement.classList.toggle('dark', next === 'dark');
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const listener of listeners) listener();
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
