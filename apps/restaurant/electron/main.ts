import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, session } from 'electron';
import {
  APP_ORIGIN,
  APP_SCHEME,
  CONNECT_ORIGINS_FILE,
  contentSecurityPolicy,
  readConnectOrigins,
  resolveAppFile,
} from './app-protocol.js';
import { devServerUrl, isAllowedNavigation } from './navigation.js';
import { windowOptions } from './window-options.js';

// The main process will own the local database, the sync client, the branch hub server and printing
// (ADR 0008, 0022, 0023); the renderer reaches them only through IPC. Today it opens one
// locked-down window on the renderer.

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url));
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(windowOptions);

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
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });
}
