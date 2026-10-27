import { useTranslation } from 'react-i18next';
import { StateCard } from '../../components/state-card';

/** The first screen; it gives way to the POS and open orders in Phase 2 (S09). */
export function HomeScreen() {
  const { t } = useTranslation('restaurant');
  return <StateCard title={t('home.title')} description={t('home.description')} />;
}
