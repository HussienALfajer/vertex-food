import type { Tenant } from '@vertex-food/contracts';
import { Callout } from '@vertex-food/ui';
import { CalendarClock, Hourglass, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import { statusBanner } from './tenant-status';

/**
 * Above every screen (S01): a scheduled suspension or closure with the time it takes effect;
 * suspended with its reason's category (never Vertex staff's note); closed with the owner's
 * remaining read days; a completed setup waiting for activation, in training mode.
 */
export function StatusBanner({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation('restaurant');
  const banner = statusBanner(tenant, new Date());
  if (!banner) return null;
  switch (banner.kind) {
    case 'scheduled':
      return (
        <Callout
          role="status"
          tone="warning"
          icon={<CalendarClock aria-hidden />}
          title={t(`status.scheduled.${banner.status}`, { time: formatDateTime(banner.at) })}
          description={`${t('status.scheduled.description')} ${t(`status.reason.${banner.reason}`)}`}
        />
      );
    case 'suspended':
      return (
        <Callout
          role="status"
          tone="danger"
          icon={<Lock aria-hidden />}
          title={t('status.suspended.title')}
          description={`${t('status.suspended.description')} ${t(`status.reason.${banner.reason}`)}`}
        />
      );
    case 'closed':
      return (
        <Callout
          role="status"
          tone="danger"
          icon={<Lock aria-hidden />}
          title={t('status.closed.title')}
          description={
            banner.days > 0
              ? t('status.closed.readDays', { count: banner.days })
              : t('status.closed.readEnded')
          }
        />
      );
    case 'awaiting-activation':
      return (
        <Callout
          role="status"
          tone="info"
          icon={<Hourglass aria-hidden />}
          title={t('status.awaiting.title')}
          description={t('status.awaiting.description')}
        />
      );
  }
}
