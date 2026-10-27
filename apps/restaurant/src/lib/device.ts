import type { DeviceBridge } from '../../electron/bridge';

declare global {
  interface Window {
    /** The preload's API (`electron/preload.cts`); absent in a browser. */
    vertexDevice?: DeviceBridge;
  }
}

/**
 * The PC's identity in the main process when the app runs in Electron (spec S02 rules 16–33), or
 * null in a browser, where the app is a personal device: back office only, online only (rule 34).
 */
export const deviceBridge: DeviceBridge | null = window.vertexDevice ?? null;

export type {
  BridgeResult,
  DeviceBridge,
  DeviceMemberView,
  DeviceStatus,
  LockReason,
} from '../../electron/bridge';
