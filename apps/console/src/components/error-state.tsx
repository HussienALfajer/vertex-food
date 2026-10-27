import { Button } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';
import { StateCard } from './state-card';

/**
 * The screen of an error. It never shows or logs the error itself: its message may carry customer
 * data (ADR 0016). `description` is the Arabic text of a refusal's code (`useErrorText`).
 */
export function ErrorState({
  onRetry,
  description,
}: {
  onRetry: () => void;
  description?: string;
}) {
  const { t } = useTranslation();
  return (
    <StateCard
      role="alert"
      title={t('errorTitle')}
      description={description ?? t('errorDescription')}
      action={<Button onClick={onRetry}>{t('retry')}</Button>}
    />
  );
}
