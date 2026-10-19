import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <section className="state">
      <h1 className="state-title">{t('notFoundTitle')}</h1>
      <p className="state-description">{t('notFoundDescription')}</p>
      <Link to="/" className="button">
        {t('goHome')}
      </Link>
    </section>
  );
}
