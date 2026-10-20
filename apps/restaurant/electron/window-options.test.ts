import { describe, expect, it } from 'vitest';
import { windowOptions } from './window-options.js';

describe('windowOptions', () => {
  it('lets the window shrink to the 360 px phone layout', () => {
    expect(windowOptions.minWidth).toBe(360);
    expect(windowOptions.minHeight).toBeLessThanOrEqual(480);
    expect(windowOptions.width).toBeGreaterThanOrEqual(windowOptions.minWidth);
    expect(windowOptions.height).toBeGreaterThanOrEqual(windowOptions.minHeight);
  });

  it('keeps the renderer locked down', () => {
    expect(windowOptions.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
  });
});
