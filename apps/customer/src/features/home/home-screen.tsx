import { useTranslation } from 'react-i18next';
import { StateCard } from '../../components/state-card';

/** The first screen; it gives way to discovery, restaurants and orders in S16 and S17. */
export function HomeScreen() {
  const { t } = useTranslation('customer');
  return <StateCard title={t('home.title')} description={t('home.description')} />;
}
