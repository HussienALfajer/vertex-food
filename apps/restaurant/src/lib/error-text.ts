import { useTranslation } from 'react-i18next';
import { apiErrorCode } from './api';

/**
 * The Arabic text of a refusal, from its code (ADR 0020); anything without a code gets the generic
 * text. Never the error's own message, which may carry customer data (ADR 0016).
 */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation(['errors', 'restaurant', 'common']);
  return (error) => {
    const code = apiErrorCode(error);
    if (code === 'NETWORK_ERROR') return t('restaurant:states.networkError');
    if (code) return t(`errors:${code}`);
    return t('common:errorDescription');
  };
}
