import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Whether the device is online, as TanStack Query sees it (the browser's `online` and `offline`
 * events). Online-only screens are read-only while it is false (S01).
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}
