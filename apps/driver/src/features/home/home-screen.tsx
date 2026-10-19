import { useTranslation } from 'react-i18next';
import { StateCard } from '../../components/state-card';

/** The first screen; it gives way to duty, jobs and cash on hand in S19. */
export function HomeScreen() {
  const { t } = useTranslation('driver');
  return <StateCard title={t('home.title')} description={t('home.description')} />;
}
