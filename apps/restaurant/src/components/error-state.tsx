import { useTranslation } from 'react-i18next';

/**
 * The screen of an unexpected error. It never shows or logs the error itself: its message may
 * carry customer data (ADR 0016).
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="state" role="alert">
      <h1 className="state-title">{t('errorTitle')}</h1>
      <p className="state-description">{t('errorDescription')}</p>
      <button type="button" className="button" onClick={onRetry}>
        {t('retry')}
      </button>
    </section>
  );
}
