import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  disconnectReasonSchema,
  type WhatsAppSessionEvent,
  whatsappAlertEventSchema,
  whatsappPauseReasonSchema,
} from '@vertex-food/contracts';
import { BackButton, Card, PageHeader } from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { holds, meQuery } from '../session/session';
import { LinkDialog, type LinkTarget } from './link-dialog';
import { whatsappSessionQuery } from './queries';
import { SessionCard } from './session-card';

/** The reason codes events carry: disconnect and pause reasons, and what an alert was about. */
const reasons = [
  ...disconnectReasonSchema.options,
  ...whatsappPauseReasonSchema.options,
  ...whatsappAlertEventSchema.options,
] as const;

type Reason = (typeof reasons)[number];

/** A reason the console has a text for; another code is left out rather than shown raw. */
function knownReason(reason: string | null): Reason | undefined {
  return reasons.find((known) => known === reason);
}

/**
 * `/whatsapp/$sessionId` (spec S03 screen 3): the number's card and its last 50 events with time,
 * type, reason and the admin who acted (the gateway otherwise). Unlinking it returns to the list.
 */
export function WhatsAppSessionScreen({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('console');
  const me = useQuery(meQuery);
  const reader = holds(me.data, 'console.messaging.read');
  const manager = holds(me.data, 'console.messaging.manage');
  const detail = useQuery({ ...whatsappSessionQuery(sessionId), enabled: reader });
  const online = useOnline();
  const navigate = useNavigate();
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
  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={detail.data?.session.label ?? t('whatsapp.title')}
        back={<BackButton render={<Link to="/whatsapp" />}>{t('whatsapp.detail.back')}</BackButton>}
      />
      <OfflineNotice />
      <QueryStates queries={[me, detail]}>
        {() =>
          detail.data && (
            <>
              <SessionCard
                session={detail.data.session}
                manager={manager}
                disabled={!online}
                onLink={setLinking}
                onUnlinked={() => void navigate({ to: '/whatsapp' })}
              />
              <Events events={detail.data.events} />
            </>
          )
        }
      </QueryStates>
      <LinkDialog target={linking} onClose={() => setLinking(null)} />
    </section>
  );
}

function Events({ events }: { events: WhatsAppSessionEvent[] }) {
  const { t } = useTranslation('console');
  return (
    <Card className="gap-3">
      <h2 className="text-lg font-semibold">{t('whatsapp.detail.eventsTitle')}</h2>
      {events.length ? (
        <ol
          aria-label={t('whatsapp.detail.eventsLabel')}
          className="flex flex-col divide-y divide-border"
        >
          {events.map((event) => {
            const reason = knownReason(event.reason);
            return (
              <li
                key={event.id}
                className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{t(`whatsapp.events.${event.type}`)}</span>
                  {reason && (
                    <span className="text-muted-foreground">{t(`whatsapp.reasons.${reason}`)}</span>
                  )}
                </span>
                <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span>{event.platformUserName ?? t('whatsapp.detail.gateway')}</span>
                  <span>{formatDateTime(event.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('whatsapp.detail.noEvents')}</p>
      )}
    </Card>
  );
}
