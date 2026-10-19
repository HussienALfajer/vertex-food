import { Callout } from '@vertex-food/ui';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '../lib/online';

/**
 * Shown on an online-only screen while offline: the last loaded values stay, read-only; saving is
 * disabled and nothing is queued (S01).
 */
export function OfflineNotice() {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  if (online) return null;
  return (
    <Callout
      role="status"
      tone="warning"
      icon={<WifiOff aria-hidden />}
      title={t('states.offlineTitle')}
      description={t('states.offlineNotice')}
    />
  );
}
