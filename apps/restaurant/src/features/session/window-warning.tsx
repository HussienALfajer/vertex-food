import { Callout } from '@vertex-food/ui';
import { ClockAlertIcon, WifiOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeviceStatus } from '../../lib/device';

type Registered = Extract<DeviceStatus, { state: 'registered' }>;

/**
 * The offline window's warnings (spec S02 rules 30, 31): from day 5 without a connection, and on
 * every screen once the window has closed; the clock warning when the PC's clock is behind the
 * highest time it has seen.
 */
export function WindowWarning({ window }: { window: Registered['window'] }) {
  const { t } = useTranslation('restaurant');
  return (
    <>
      {window.warn && (
        <Callout
          role="status"
          tone={window.open ? 'warning' : 'danger'}
          icon={<WifiOffIcon aria-hidden />}
          title={t('offlineWindow.days', { count: window.daysSinceSync })}
          description={window.open ? t('offlineWindow.soon') : t('offlineWindow.expired')}
        />
      )}
      {window.clockBehind && (
        <Callout
          role="status"
          tone="warning"
          icon={<ClockAlertIcon aria-hidden />}
          title={t('offlineWindow.clock')}
        />
      )}
    </>
  );
}
