import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, Callout } from '@vertex-food/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messagingHealthQuery } from './queries';

/**
 * Screen 4: on every page for `console.messaging.read`, read every 30 s. Danger when no platform
 * number is healthy (OTPs stop), warning when only one is (no failover); nothing otherwise, nor
 * while the health is unknown.
 */
export function MessagingHealthBanner() {
  const { t } = useTranslation('console');
  const health = useQuery(messagingHealthQuery);
  if (!health.data || health.data.healthy > 1) return null;
  const none = health.data.healthy === 0;
  return (
    <Callout
      role={none ? 'alert' : 'status'}
      tone={none ? 'danger' : 'warning'}
      icon={<TriangleAlertIcon />}
      title={none ? t('messagingHealth.none') : t('messagingHealth.one')}
      description={none ? t('messagingHealth.noneDescription') : undefined}
      action={
        <Button variant="outline" size="sm" render={<Link to="/whatsapp" />}>
          {t('messagingHealth.open')}
        </Button>
      }
      className="mb-6 max-w-4xl"
    />
  );
}
