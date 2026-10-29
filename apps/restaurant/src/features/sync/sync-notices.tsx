import { Callout } from '@vertex-food/ui';
import { CircleArrowUpIcon, DatabaseIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SyncBridge } from '../../lib/sync';
import { useSyncStatus } from './queries';

/**
 * The notices of the sync on every screen of a PC (spec S04 screen 5 and "Abuse and failure
 * cases"): the corrupt local database, an update the server requires (blocking downloads, never
 * local work), a refused protocol, an update ready for the next start, and the hub's own notices
 * (rules 27, 29). None of them blocks the screen beneath.
 */
export function SyncNotices({
  bridge,
  corruptDatabase,
}: {
  bridge: SyncBridge | null;
  corruptDatabase: boolean;
}) {
  const { t } = useTranslation('sync');
  const status = useSyncStatus(bridge);
  const view = status.data;
  const notice = view?.hub?.status?.notice ?? null;
  return (
    <>
      {corruptDatabase && (
        <Callout
          role="alert"
          tone="danger"
          data-slot="corrupt-database"
          icon={<DatabaseIcon aria-hidden />}
          title={t('notices.corruptTitle')}
          description={t('notices.corrupt')}
        />
      )}
      {view?.sync.updateRequired && (
        <Callout
          role="alert"
          tone="danger"
          icon={<CircleArrowUpIcon aria-hidden />}
          title={t('notices.updateRequiredTitle')}
          description={t('notices.updateRequired')}
        />
      )}
      {view?.sync.protocolRefused && !view.sync.updateRequired && (
        <Callout
          role="alert"
          tone="danger"
          icon={<CircleArrowUpIcon aria-hidden />}
          title={t('notices.protocolRefusedTitle')}
          description={t('notices.protocolRefused')}
        />
      )}
      {notice === 'too_far_behind' && (
        <Callout
          role="status"
          tone="warning"
          icon={<TriangleAlertIcon aria-hidden />}
          title={t('notices.tooFarBehindTitle')}
          description={t('notices.tooFarBehind')}
        />
      )}
      {notice === 'needs_other_pc' && (
        <Callout
          role="status"
          tone="warning"
          icon={<TriangleAlertIcon aria-hidden />}
          title={t('notices.needsOtherPcTitle')}
          description={t('notices.needsOtherPc')}
        />
      )}
      {view?.updateReady && (
        <Callout
          role="status"
          tone="info"
          icon={<CircleArrowUpIcon aria-hidden />}
          title={t('notices.updateReadyTitle', { version: view.updateReady.version })}
          description={t('notices.updateReady')}
        />
      )}
    </>
  );
}
