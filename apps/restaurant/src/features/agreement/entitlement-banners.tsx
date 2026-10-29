import { Callout } from '@vertex-food/ui';
import { CalendarClockIcon, CloudOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import type { SyncBridge } from '../../lib/sync';
import { scheduledRemovals } from './agreement-view';
import { useBranchEntitlements } from './queries';

/**
 * The back office's entitlement banners on a PC, for owners and managers (spec S05 screen 2): each
 * scheduled removal from the branch's copy, and the expired lease (rule 26). Neither blocks
 * anything: the hub keeps applying the last copy.
 */
export function EntitlementBanners({ bridge }: { bridge: SyncBridge }) {
  const { t } = useTranslation('agreement');
  const entitlements = useBranchEntitlements(bridge);
  const view = entitlements.data;
  if (!view) return null;
  return (
    <>
      {scheduledRemovals(view.copy, new Date()).map((removal) => (
        <Callout
          key={removal.key}
          role="status"
          tone="warning"
          data-slot="entitlement-removal"
          icon={<CalendarClockIcon aria-hidden />}
          title={t('banners.removal', {
            feature: t(`features.${removal.key}`),
            date: formatDateTime(removal.until),
          })}
        />
      ))}
      {view.leaseExpired && (
        <Callout
          role="status"
          tone="warning"
          data-slot="entitlement-lease"
          icon={<CloudOffIcon aria-hidden />}
          title={t('banners.lease')}
        />
      )}
    </>
  );
}
