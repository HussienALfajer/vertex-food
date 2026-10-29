import type { SyncBridge } from '../../electron/bridge';

declare global {
  interface Window {
    /** The preload's sync API (`electron/preload.cts`, spec S04); absent in a browser. */
    vertexSync?: SyncBridge;
  }
}

/**
 * The sync client and branch hub in the main process (spec S04 screens 1–5), or null in a browser,
 * where nothing syncs: a personal device reads the API only.
 */
export const syncBridge: SyncBridge | null =
  typeof window === 'undefined' ? null : (window.vertexSync ?? null);

export type {
  BranchEntitlementsView,
  BranchNetworkView,
  CommandResultView,
  HubView,
  OpenedPairing,
  SyncBridge,
  SyncStatusView,
} from '../../electron/bridge';
