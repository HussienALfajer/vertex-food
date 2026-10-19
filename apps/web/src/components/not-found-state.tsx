import Link from 'next/link';
import { i18n } from '../lib/i18n';

export function NotFoundState() {
  const { t } = i18n;
  return (
    <section className="state">
      <h1 className="state-title">{t('notFoundTitle')}</h1>
      <p className="state-description">{t('notFoundDescription')}</p>
      <Link href="/" className="button">
        {t('goHome')}
      </Link>
    </section>
  );
}
