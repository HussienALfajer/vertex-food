// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../components/theme-toggle';
import { themeInitScript, themeStorageKey } from './theme';

const labels = { toDark: 'to dark', toLight: 'to light' };
const root = document.documentElement;
const runInitScript = () => new Function(themeInitScript)();

/** Stubs the system setting; `change` flips it as the OS would, telling the page's listeners. */
function systemPrefersDark(dark: boolean) {
  const changeListeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      changeListeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      changeListeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', (query: string) => ({ ...media, media: query }));
  return {
    change(next: boolean) {
      media.matches = next;
      for (const listener of changeListeners) listener({ matches: next });
    },
  };
}

function storageThrows() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
}

/** A fresh `use-theme` module: a choice made on the page lives in it. */
async function freshToggle() {
  vi.resetModules();
  return (await import('../components/theme-toggle')).ThemeToggle;
}

beforeEach(() => {
  localStorage.clear();
  root.classList.remove('dark');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme-init.js', () => {
  it('follows the system until the device chose a theme', () => {
    systemPrefersDark(true);
    runInitScript();
    expect(root.classList.contains('dark')).toBe(true);
    systemPrefersDark(false);
    runInitScript();
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('applies the saved choice over the system', () => {
    systemPrefersDark(true);
    localStorage.setItem(themeStorageKey, 'light');
    runInitScript();
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('follows the system when storage is unavailable', () => {
    systemPrefersDark(true);
    storageThrows();
    runInitScript();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('takes only light or dark as a saved choice', () => {
    systemPrefersDark(true);
    localStorage.setItem(themeStorageKey, 'blue');
    runInitScript();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('stays light when neither storage nor the system can be read', () => {
    storageThrows();
    vi.stubGlobal('matchMedia', () => {
      throw new Error('unsupported');
    });
    root.classList.add('dark');
    runInitScript();
    expect(root.classList.contains('dark')).toBe(false);
  });
});

describe('useTheme', () => {
  it('follows system changes while nothing is chosen', async () => {
    const system = systemPrefersDark(false);
    runInitScript();
    const Toggle = await freshToggle();
    render(<Toggle labels={labels} />);

    act(() => system.change(true));
    expect(root.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: 'to light' })).toBeTruthy();
    act(() => system.change(false));
    expect(screen.getByRole('button', { name: 'to dark' })).toBeTruthy();
  });

  it('keeps the choice over later system changes, even when storage cannot save it', async () => {
    const system = systemPrefersDark(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    runInitScript();
    const Toggle = await freshToggle();
    render(<Toggle labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'to dark' }));
    act(() => system.change(false));
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('keeps a saved choice over system changes', async () => {
    const system = systemPrefersDark(false);
    localStorage.setItem(themeStorageKey, 'light');
    runInitScript();
    const Toggle = await freshToggle();
    render(<Toggle labels={labels} />);

    act(() => system.change(true));
    expect(root.classList.contains('dark')).toBe(false);
  });
});

describe('ThemeToggle', () => {
  it('switches between light and dark, names what it switches to, and keeps the choice', () => {
    systemPrefersDark(false);
    runInitScript();
    render(<ThemeToggle labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'to dark' }));
    expect(root.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(themeStorageKey)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'to light' }));
    expect(root.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(themeStorageKey)).toBe('light');
  });
});
