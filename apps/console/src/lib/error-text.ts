import { useTranslation } from 'react-i18next';
import { apiErrorCode } from './api';

/**
 * The Arabic text of a refusal, from its code (ADR 0020); anything without a code gets the generic
 * text. Never the error's own message (ADR 0016). The end of a session and the re-authentication
 * (a TOTP here, a password in the restaurant app) have the console's own text.
 */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation(['errors', 'console', 'common']);
  return (error) => {
    const code = apiErrorCode(error);
    if (code === 'NETWORK_ERROR') return t('console:states.networkError');
    if (code === 'UNAUTHENTICATED' || code === 'SESSION_ENDED') return t('console:session.ended');
    if (code === 'REAUTH_REQUIRED') return t('console:reauth.required');
    if (code) return t(`errors:${code}`);
    return t('common:errorDescription');
  };
}
