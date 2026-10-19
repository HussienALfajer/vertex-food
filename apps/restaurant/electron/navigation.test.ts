import { describe, expect, it } from 'vitest';
import { devServerUrl, isAllowedNavigation } from './navigation.js';

describe('isAllowedNavigation', () => {
  it('allows the renderer origin only', () => {
    expect(isAllowedNavigation('app://restaurant/orders', 'app://restaurant')).toBe(true);
    expect(isAllowedNavigation('https://example.com/', 'app://restaurant')).toBe(false);
    expect(isAllowedNavigation('app://other/', 'app://restaurant')).toBe(false);
    expect(isAllowedNavigation('file:///C:/Windows/', 'app://restaurant')).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', 'app://restaurant')).toBe(false);
    expect(isAllowedNavigation('nonsense', 'app://restaurant')).toBe(false);
  });

  it('allows the dev server origin in development', () => {
    expect(isAllowedNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });
});

describe('devServerUrl', () => {
  it('reads a loopback dev server from the arguments', () => {
    expect(devServerUrl(['electron', '.', '--dev-server=http://localhost:5173'], false)).toBe(
      'http://localhost:5173',
    );
    expect(devServerUrl(['--dev-server=http://127.0.0.1:5173/'], false)).toBe(
      'http://127.0.0.1:5173',
    );
  });

  it('is ignored by a packaged app', () => {
    expect(devServerUrl(['--dev-server=http://localhost:5173'], true)).toBeNull();
  });

  it('refuses any other host or scheme', () => {
    expect(devServerUrl(['--dev-server=http://example.com'], false)).toBeNull();
    expect(devServerUrl(['--dev-server=https://localhost:5173'], false)).toBeNull();
    expect(devServerUrl(['--dev-server=file:///C:/'], false)).toBeNull();
    expect(devServerUrl(['--dev-server=nonsense'], false)).toBeNull();
    expect(devServerUrl([], false)).toBeNull();
  });
});
