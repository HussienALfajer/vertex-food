// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../components/theme-toggle';
import { themeInitScript, themeStorageKey } from './theme';

const labels = { toDark: 'to dark', toLight: 'to light' };
const root = document.documentElement;
const runInitScript = () => new Function(themeInitScript)();

function systemPrefersDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark, media: query }));
}

beforeEach(() => {
  localStorage.clear();
  root.classList.remove('dark');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
