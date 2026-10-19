import { Button } from '@vertex-food/ui';
import { i18n } from '../lib/i18n';
import { StateCard } from './state-card';

/**
 * The page of an unexpected error. It never shows or logs the error itself: its message may
 * carry restaurant or customer data (ADR 0016). Rendered by the error boundaries (client components).
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = i18n;
  return (
    <StateCard
      role="alert"
      title={t('errorTitle')}
      description={t('errorDescription')}
      action={<Button onClick={onRetry}>{t('retry')}</Button>}
    />
  );
}
