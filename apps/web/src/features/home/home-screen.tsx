import { i18n } from '../../lib/i18n';

/** The first page; QR menus, restaurant pages and web ordering arrive with S15 and S17. */
export function HomeScreen() {
  const t = i18n.getFixedT(null, 'web');
  return (
    <section className="state">
      <h1 className="state-title">{t('home.title')}</h1>
      <p className="state-description">{t('home.description')}</p>
    </section>
  );
}
