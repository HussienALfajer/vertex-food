import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
import { deviceChannels, syncChannels } from './bridge.js';
import { DeviceClient } from './device-client.js';
import { deviceHandlers } from './device-ipc.js';
import { generateDeviceKey, signWithDeviceKey } from './device-key.js';
import { DeviceService } from './device-service.js';
import { DeviceStore, type Registration } from './device-store.js';
import { HubRuntime } from './hub-runtime.js';
import { generateDatabaseKey } from './local-db.js';
import { LocalStore } from './local-store.js';
import { devServerUrl, isAllowedNavigation } from './navigation.js';
import { CachedCertificates, CertificateStore, privateLanAddresses } from './pc-certificate.js';
import { pendingCounts } from './pending-work.js';
import { uploadQuarantine } from './quarantine-upload.js';
import { SyncControl, syncHandlers } from './sync-ipc.js';
import { SyncService } from './sync-service.js';
import { UpdateGate } from './update-gate.js';
import { windowOptions } from './window-options.js';

// The main process owns the PC's identity (S02), its encrypted local database and sync client (S04),
// and will own the branch hub server and printing (ADR 0008, 0022, 0023); the renderer reaches them only
// through the preload's IPC API (`bridge.ts`). It opens one locked-down window on the renderer.

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url));
// The hub client pages the LAN server serves (screens 6–9), built beside the renderer.
const hubClientsDir = fileURLToPath(new URL('../hub-clients/', import.meta.url));
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

const userData = (): string => app.getPath('userData');

function notifyWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(deviceChannels.changed);
  }
}

/** Sync and hub changes come in bursts (an upload, a stress run): one notice per 200 ms. */
let syncNotice: ReturnType<typeof setTimeout> | null = null;
function notifySync(): void {
  if (syncNotice) return;
  syncNotice = setTimeout(() => {
    syncNotice = null;
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(syncChannels.changed);
    }
  }, 200);
}

/** The API answered a heartbeat lately: the PC is online (spec S04 rule 29). */
const ONLINE_WITHIN_MS = 45_000;

function handle(handlers: Record<string, (input: unknown) => Promise<unknown>>): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, input: unknown) => {
      // Only the app's own page may call: never a frame from anywhere else.
      if (!isAllowedNavigation(event.senderFrame?.url ?? '', rendererOrigin)) {
        throw new Error('Refused');
      }
      return handler(input);
    });
  }
}

/** Rule 46: the feed's HTTPS URL, from the environment until the deploy skeleton (Q1) sets it. */
function updateFeedUrl(): string | null {
  const value = process.env.UPDATE_FEED_URL;
  return value?.startsWith('https://') ? value : null;
}

/**
 * Starts the downloaded installer apart from the app, which then quits; false when it could not
 * start (a blocked or missing file), and the old version opens.
 */
function runInstaller(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, [], { detached: true, stdio: 'ignore' });
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
      child.once('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * The PC's identity (spec S02) and its local data and sync (spec S04): the sealed record in the
 * user's data folder, the encrypted local database beside it, device routes on the API the
 * renderer was built with, the PIN check by Argon2id in WASM (Electron's BoringSSL has no Argon2).
 * The member list is fetched every 60 seconds (rule 28). At start, before the window opens, the
 * update gate installs a downloaded update when nothing is pending (rule 46); the sync client
 * starts after it, so the count it reads is the one the queue had at start.
 */
async function startDeviceService(): Promise<'started' | 'updating'> {
  // Development on the Vite server may run before any build: the variable's own origin then.
  const client = new DeviceClient(builtConnectOrigins()[0] ?? connectOrigins(process.env)[0] ?? '');
  const certificates = new CachedCertificates(
    new CertificateStore(join(userData(), 'certificate.bin'), safeStorage),
  );
  const updates = new UpdateGate({
    feedUrl: updateFeedUrl(),
    appVersion: app.getVersion(),
    directory: join(userData(), 'updates'),
    install: runInstaller,
    onChange: notifyWindows,
  });
  let device: DeviceService | null = null;
  let sync: SyncService | null = null;
  let hub: HubRuntime | null = null;
  const control = new SyncControl({
    updateReady: () => {
      const ready = updates.ready();
      return ready ? { version: ready.version } : null;
    },
    lanAddresses: () => privateLanAddresses(),
  });
  // The database a start opened, held until the update gate has decided.
  const atStart: { registration: Registration; local: LocalStore }[] = [];
  const startSync = (registration: Registration, local: LocalStore) => {
    const service = device;
    if (!service) return;
    const verifyPin = (pin: string, verifier: string) =>
      argon2Verify({ password: pin, hash: verifier });
    const syncService: SyncService = new SyncService({
      registration,
      local: local.opened,
      client,
      deviceCall: (call) => service.deviceCall(call),
      recordServerTime: (serverTime, offsetMs) => service.recordServerTime(serverTime, offsetMs),
      clockOffsetMs: () => service.clock()?.offsetMs ?? null,
      now: () => new Date(),
      elapsed: () => performance.now(),
      appVersion: app.getVersion(),
      lanAddresses: () => privateLanAddresses(),
      certificates,
      live: async () => runtime.live(),
      onChange: notifySync,
    });
    // The hub runs beside the sync client (ADR 0022): its live role goes into each heartbeat.
    const runtime: HubRuntime = new HubRuntime({
      registration,
      local: local.opened,
      device: service,
      verifyPin,
      certificate: () => certificates.read(),
      connectivity: () => syncService.status().connectivity,
      online: () => {
        const last = syncService.status().lastHeartbeatAt;
        return last !== null && Date.now() - Date.parse(last) < ONLINE_WITHIN_MS;
      },
      appVersion: app.getVersion(),
      pagesDirectory: existsSync(join(hubClientsDir, 'index.html')) ? hubClientsDir : null,
      onChange: notifySync,
      onRoleChange: () => void syncService.roleChanged().catch(() => undefined),
    });
    sync = syncService;
    hub = runtime;
    control.parts = { sync: syncService, hub: runtime, reads: local.opened.reads };
    syncService.start();
    void runtime.start().catch(() => undefined);
  };
  device = await DeviceService.open({
    store: new DeviceStore(join(userData(), 'device.bin'), safeStorage),
    client,
    verifyPin: (pin, verifier) => argon2Verify({ password: pin, hash: verifier }),
    generateKey: generateDeviceKey,
    sign: signWithDeviceKey,
    now: () => new Date(),
    elapsed: () => performance.now(),
    os: `${platform()} ${release()}`,
    appVersion: app.getVersion(),
    onChange: notifyWindows,
    openData: (deviceId, databaseKey) =>
      LocalStore.open(join(userData(), 'data', deviceId), databaseKey),
    generateDatabaseKey,
    // Rule 40: the sync stops, the pending work goes to the quarantine, then the certificate goes
    // with the database the device service deletes next.
    quarantine: async (registration, data) => {
      if (!(data instanceof LocalStore)) throw new Error('Unknown local data');
      control.parts = null;
      await hub?.stop();
      hub = null;
      await sync?.stop();
      sync = null;
      await uploadQuarantine({
        reads: data.opened.reads,
        registration,
        client,
        sign: signWithDeviceKey,
      });
      certificates.remove();
    },
    onData: (registration, data) => {
      if (!(data instanceof LocalStore)) return;
      // At start the gate decides first; a registration later starts the sync at once.
      if (device) startSync(registration, data);
      else atStart.push({ registration, local: data });
    },
  });
  const [opened] = atStart;
  // A queue that cannot be counted is pending work; a gate that fails (a full disk) installs
  // nothing, and the old version starts.
  const pending = opened
    ? await pendingCounts(opened.local.opened.reads).catch(() => null)
    : { uploads: 0, unsettled: 0 };
  const decision = pending
    ? await updates.installAtStart(pending).catch(() => 'failed' as const)
    : 'waiting';
  if (decision === 'installed') return 'updating';
  if (opened) startSync(opened.registration, opened.local);
  updates.start();
  const service = device;
  handle(deviceHandlers(service));
  handle(syncHandlers(control));
  void service.refresh();
  setInterval(() => void service.refresh(), memberListRefreshSeconds * 1000);
  return 'started';
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

  void app.whenReady().then(async () => {
    lockDownSession();
    serveRenderer();
    // A failure here still opens the window: the renderer shows its error state.
    const started = await startDeviceService().catch(() => 'failed' as const);
    if (started === 'updating') {
      app.quit();
      return;
    }
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });
}
