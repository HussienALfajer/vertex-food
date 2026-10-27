import { readFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { memberListRefreshSeconds } from '@vertex-food/contracts';
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from 'electron';
import { argon2Verify } from 'hash-wasm';
import {
  APP_ORIGIN,
  APP_SCHEME,
  CONNECT_ORIGINS_FILE,
  connectOrigins,
  contentSecurityPolicy,
  readConnectOrigins,
  resolveAppFile,
} from './app-protocol.js';
import { deviceChannels } from './bridge.js';
import { DeviceClient } from './device-client.js';
import { deviceHandlers } from './device-ipc.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import { DeviceStore } from './device-store.js';
import { devServerUrl, isAllowedNavigation } from './navigation.js';
import { windowOptions } from './window-options.js';

// The main process owns the PC's identity (S02) and will own the local database, the sync client,
// the branch hub server and printing (ADR 0008, 0022, 0023); the renderer reaches them only
// through the preload's IPC API (`bridge.ts`). It opens one locked-down window on the renderer.

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url));
const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const devServer = devServerUrl(process.argv, app.isPackaged);
const rendererOrigin = devServer ?? APP_ORIGIN;
// The API's origin is the one the renderer was built with, written next to it by the build.
function builtConnectOrigins(): string[] {
  try {
    return readConnectOrigins(readFileSync(join(rendererDir, CONNECT_ORIGINS_FILE), 'utf8'));
  } catch {
    return [];
  }
}
const contentSecurity = contentSecurityPolicy(builtConnectOrigins());

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveRenderer(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(rendererDir, request.url);
    if (!file) return new Response(null, { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (!response?.ok) return new Response(null, { status: 404 });
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', contentSecurity);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: 200, headers });
  });
}

function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/**
 * The PC's identity (spec S02): the sealed record in the user's data folder, device routes on the
 * API the renderer was built with, the PIN check by Argon2id in WASM (Electron's BoringSSL has no
 * Argon2). The member list is fetched every 60 seconds (rule 28).
 */
function startDeviceService(): DeviceService {
  const service = new DeviceService({
    store: new DeviceStore(join(app.getPath('userData'), 'device.bin'), safeStorage),
    // Development on the Vite server may run before any build: the variable's own origin then.
    client: new DeviceClient(builtConnectOrigins()[0] ?? connectOrigins(process.env)[0] ?? ''),
    verifyPin: (pin, verifier) => argon2Verify({ password: pin, hash: verifier }),
    generateKey: generateDeviceKey,
    sign: signWithDeviceKey,
    now: () => new Date(),
    elapsed: () => performance.now(),
    os: `${platform()} ${release()}`,
    appVersion: app.getVersion(),
    onChange: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(deviceChannels.changed);
      }
    },
  });
  for (const [channel, handler] of Object.entries(deviceHandlers(service))) {
    ipcMain.handle(channel, (event, input: unknown) => {
      // Only the app's own page may call: never a frame from anywhere else.
      if (!isAllowedNavigation(event.senderFrame?.url ?? '', rendererOrigin)) {
        throw new Error('Refused');
      }
      return handler(input);
    });
  }
  void service.refresh();
  setInterval(() => void service.refresh(), memberListRefreshSeconds * 1000);
  return service;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...windowOptions,
    webPreferences: { ...windowOptions.webPreferences, preload: preloadPath },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererOrigin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, rendererOrigin)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  void window.loadURL(`${rendererOrigin}/`);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    lockDownSession();
    serveRenderer();
    startDeviceService();
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });
}
