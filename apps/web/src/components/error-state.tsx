import { i18n } from '../lib/i18n';

/**
 * The page of an unexpected error. It never shows or logs the error itself: its message may
 * carry restaurant or customer data (ADR 0016). Rendered by the error boundaries (client components).
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = i18n;
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
