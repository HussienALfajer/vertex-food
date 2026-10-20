import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * The renderer's window: it opens at a desktop size and may shrink to a phone's width (360 px),
 * which the responsive layout supports, so a small screen, a portrait tablet or a snapped window
 * fits. The renderer gets no Node.js and stays sandboxed.
 */
export const windowOptions = {
  width: 1280,
  height: 800,
  minWidth: 360,
  minHeight: 480,
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  },
} as const satisfies BrowserWindowConstructorOptions;
