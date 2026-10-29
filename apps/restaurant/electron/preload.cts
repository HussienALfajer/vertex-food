import electron = require('electron');

import type { DeviceBridge, SyncBridge } from './bridge.js' with { 'resolution-mode': 'import' };

// The renderer's only way into the main process (spec S02 rule 29): a sandboxed preload, so it
// is CommonJS and requires nothing but `electron`. The channel names are `deviceChannels` in
// `bridge.ts` (a test checks they match).

const bridge: DeviceBridge = {
  status: () => electron.ipcRenderer.invoke('device:status'),
  register: (input) => electron.ipcRenderer.invoke('device:register', input),
  signIn: (input) => electron.ipcRenderer.invoke('device:sign-in', input),
  signInByPassword: (input) => electron.ipcRenderer.invoke('device:sign-in-by-password', input),
  lock: (reason) => electron.ipcRenderer.invoke('device:lock', reason),
  accessToken: () => electron.ipcRenderer.invoke('device:access-token'),
  refresh: () => electron.ipcRenderer.invoke('device:refresh'),
  approve: (input) => electron.ipcRenderer.invoke('device:approve', input),
  reenablePin: (input) => electron.ipcRenderer.invoke('device:reenable-pin', input),
  dismissWipe: () => electron.ipcRenderer.invoke('device:dismiss-wipe'),
  onChange: (listener) => {
    const handler = () => listener();
    electron.ipcRenderer.on('device:changed', handler);
    return () => {
      electron.ipcRenderer.removeListener('device:changed', handler);
    };
  },
};

electron.contextBridge.exposeInMainWorld('vertexDevice', bridge);

// Spec S04: the sync status, the branch network and this PC's results; S05: the branch's
// entitlements (`syncChannels`).
const sync: SyncBridge = {
  status: () => electron.ipcRenderer.invoke('sync:status'),
  network: () => electron.ipcRenderer.invoke('sync:network'),
  openPairing: (input) => electron.ipcRenderer.invoke('sync:open-pairing', input),
  closePairing: () => electron.ipcRenderer.invoke('sync:close-pairing'),
  revokePairing: (pairingId) => electron.ipcRenderer.invoke('sync:revoke-pairing', pairingId),
  promotionPreview: () => electron.ipcRenderer.invoke('sync:promotion-preview'),
  promote: (input) => electron.ipcRenderer.invoke('sync:promote', input),
  sendNetworkCheck: (input) => electron.ipcRenderer.invoke('sync:send-network-check', input),
  results: () => electron.ipcRenderer.invoke('sync:results'),
  entitlements: () => electron.ipcRenderer.invoke('sync:entitlements'),
  onChange: (listener) => {
    const handler = () => listener();
    electron.ipcRenderer.on('sync:changed', handler);
    return () => {
      electron.ipcRenderer.removeListener('sync:changed', handler);
    };
  },
};

electron.contextBridge.exposeInMainWorld('vertexSync', sync);
