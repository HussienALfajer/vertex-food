import { useTranslation } from 'react-i18next';

/** The first screen; it gives way to the POS and open orders in Phase 2 (S09). */
export function HomeScreen() {
  const { t } = useTranslation('restaurant');
  return (
    <section className="state">
      <h1 className="state-title">{t('home.title')}</h1>
      <p className="state-description">{t('home.description')}</p>
    </section>
  );
}
