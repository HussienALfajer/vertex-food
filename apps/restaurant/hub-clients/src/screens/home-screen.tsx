import type { HubSession } from '@vertex-food/contracts';
import { Button } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';
import { Screen } from '../components/page-shell';
import type { ConnectionState } from '../connection';
import { navigate } from '../router';
import { HubStatus } from './hub-status';
import { ReconnectingNotice } from './reconnecting';

/** A station pairing (rule 34): S04 gives it no command; S11 puts the kitchen display here. */
export function StationScreen({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation('hubClients');
  return (
    <Screen heading={t('station.heading')} description={t('station.description')}>
      {connection.hub ? <HubStatus connection={connection} /> : <ReconnectingNotice />}
    </Screen>
  );
}

/** A signed-in member without the network check: S12 puts the waiter app here. */
export function HomeScreen({
  connection,
  session,
}: {
  connection: ConnectionState;
  session: HubSession;
}) {
  const { t } = useTranslation('hubClients');
  return (
    <Screen heading={t('home.heading')} description={t('home.description')}>
      <p>{t('session.signedInAs', { name: session.name })}</p>
      {connection.hub ? <HubStatus connection={connection} /> : <ReconnectingNotice />}
      {session.permissions.includes('hub.manage') && (
        <Button variant="outline" onClick={() => navigate('/check')}>
          {t('home.check')}
        </Button>
      )}
    </Screen>
  );
}
