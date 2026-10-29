import { Callout } from '@vertex-food/ui';
import { WifiOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Screen } from '../components/page-shell';

/** No PC answers as the hub (rule 30): the page keeps asking both, and says so. */
export function ReconnectingNotice() {
  const { t } = useTranslation('hubClients');
  return (
    <Callout
      tone="warning"
      icon={<WifiOffIcon />}
      title={t('connection.reconnecting')}
      description={t('connection.reconnectingHint')}
    />
  );
}

/** A page that needs the hub before it can show anything. */
export function Reconnecting({ heading }: { heading: string }) {
  return (
    <Screen heading={heading}>
      <ReconnectingNotice />
    </Screen>
  );
}
