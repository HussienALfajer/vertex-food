import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, PageHeader } from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { useOnline } from '../../lib/online';
import { holds, meQuery } from '../session/session';
import { LinkDialog, type LinkTarget } from './link-dialog';
import { whatsappSessionsQuery } from './queries';
import { SessionCard } from './session-card';

/**
 * `/whatsapp` (spec S03 screen 1), for `console.messaging.read`: Vertex's platform numbers, a card
 * each. Admins (`console.messaging.manage`) add a number and act on each; support only reads.
 */
export function WhatsAppScreen() {
  const { t } = useTranslation('console');
  const me = useQuery(meQuery);
  const reader = holds(me.data, 'console.messaging.read');
  const manager = holds(me.data, 'console.messaging.manage');
  const sessions = useQuery({ ...whatsappSessionsQuery, enabled: reader });
  const online = useOnline();
  const [linking, setLinking] = useState<LinkTarget | null>(null);
  if (me.data && !reader) {
    return (
      <StateCard
        role="status"
        title={t('whatsapp.noAccessTitle')}
        description={t('whatsapp.noAccessDescription')}
      />
    );
  }
  const add = manager && (
    <Button disabled={!online} onClick={() => setLinking('new')}>
      {t('whatsapp.add')}
    </Button>
  );
  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('whatsapp.title')}
        description={t('whatsapp.description')}
        // An empty list holds the button itself.
        actions={sessions.data?.length === 0 ? undefined : add}
      />
      <OfflineNotice />
      <QueryStates queries={[me, sessions]}>
        {() =>
          sessions.data?.length ? (
            <ul aria-label={t('whatsapp.listLabel')} className="flex flex-col gap-4">
              {sessions.data.map((session) => (
                <li key={session.id} aria-label={session.label}>
                  <SessionCard
                    session={session}
                    manager={manager}
                    disabled={!online}
                    detailLink
                    onLink={setLinking}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t('whatsapp.empty.title')}
              description={
                manager ? t('whatsapp.empty.description') : t('whatsapp.empty.descriptionReadOnly')
              }
              action={add || undefined}
            />
          )
        }
      </QueryStates>
      <LinkDialog target={linking} onClose={() => setLinking(null)} />
    </section>
  );
}
