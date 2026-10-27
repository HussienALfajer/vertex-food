import electron = require('electron');

import type { DeviceBridge } from './bridge.js' with { 'resolution-mode': 'import' };

// The renderer's only way into the main process (spec S02 rule 29): a sandboxed preload, so it
// is CommonJS and requires nothing but `electron`. The channel names are `deviceChannels` in
// `bridge.ts` (a test checks they match).

const bridge: DeviceBridge = {
  status: () => electron.ipcRenderer.invoke('device:status'),
  register: (input) => electron.ipcRenderer.invoke('device:register', input),
  signIn: (input) => electron.ipcRenderer.invoke('device:sign-in', input),
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
