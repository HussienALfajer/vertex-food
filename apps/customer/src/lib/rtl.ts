import type { I18nManager } from 'react-native';

/**
 * Forces right to left at start (ADR 0003, 0018), whatever the device language. Installed builds
 * start in RTL through the app config (`extra.forcesRTL`); this keeps development clients in RTL
 * too, from their next reload.
 */
export function forceRightToLeft(manager: Pick<typeof I18nManager, 'allowRTL' | 'forceRTL'>): void {
  manager.allowRTL(true);
  manager.forceRTL(true);
}
