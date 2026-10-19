import { StateCard } from '../../components/state-card';
import { i18n } from '../../lib/i18n';

/** The first page; QR menus, restaurant pages and web ordering arrive with S15 and S17. */
export function HomeScreen() {
  const t = i18n.getFixedT(null, 'web');
  return <StateCard title={t('home.title')} description={t('home.description')} />;
}
