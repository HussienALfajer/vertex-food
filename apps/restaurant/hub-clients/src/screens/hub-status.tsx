import { Badge } from '@vertex-food/ui';
import { ServerIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionState } from '../connection';

const standbyTone = { in_sync: 'success', not_in_sync: 'warning', none: 'neutral' } as const;

/**
 * The hub the page is talking to: its address and epoch, from discovery, and the standby and
 * internet state from the live snapshot. A branch with one PC has no standby: information, not a
 * warning (edge case 15).
 */
export function HubStatus({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation('hubClients');
  const { t: sync } = useTranslation('sync');
  const { hub, live } = connection;
  if (!hub) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="hub">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ServerIcon aria-hidden className="size-4 shrink-0" />
        <span dir="auto">{t('connection.hub', { address: hub.address, epoch: hub.epoch })}</span>
      </p>
      {live && (
        <div className="flex flex-wrap gap-2">
          <Badge tone={standbyTone[live.hub.standby]}>
            {t(`connection.standby.${live.hub.standby}`)}
          </Badge>
          <Badge tone={live.hub.connectivity === 'online' ? 'success' : 'neutral'}>
            {t('connection.internet', { state: sync(`connectivity.${live.hub.connectivity}`) })}
          </Badge>
        </div>
      )}
    </div>
  );
}
